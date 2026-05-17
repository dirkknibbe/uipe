# Component Index — Design

**Date:** 2026-05-12
**Status:** Draft — pending user review
**Roadmap entry:** [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) — sub-project #4 (despite the legacy name "Design system / route graph indexer"; route graphing belongs to #5)
**Architecture source:** [`docs/architecture.md`](../../architecture.md) §"Techniques to borrow, ranked by impact" #4 (HD map prior — design systems as maps)

## Goal

Index every styled-as-a-unit region of a target app's DOM by its structural signature, classify each signature once, and reuse the classification on subsequent observations. The cost-reduction payoff: on a familiar app, most observed components resolve via index lookup instead of paying a VLM call for "what is this UI element."

The architecture-doc analogy: Waymo carries pre-built HD maps so it does not re-derive lane geometry from raw pixels. UIPE's equivalent is an indexed design-system / component-library prior.

## Primary consumer

**The agent acting through MCP tools.** When the scene graph carries `component: { name: 'Button' }` on a node, an agent can act ("click the Submit button") without reasoning from raw DOM or invoking the visual tier. The cost reduction is measurable: `indexHitRate` (observations resolved via cached classification ÷ total observations) is the load-bearing metric.

Secondary consumer: the developer running UIPE against a new target app. `get_component_index` exposes what the perception layer has learned — useful for debugging, sanity-checking, and (in v2) for sharing curated indices across projects.

## Non-goals (v1)

- **Storybook seeding adapter.** The `IndexedComponent.source` field reserves `'storybook'` as a valid value so the file format extends without breaking; the adapter itself is v2 work.
- **Route graph indexing.** Despite the roadmap entry's literal name, route graphing belongs in #5 (SLAM for SPA routes). v1 is design system / component library only.
- **Embedding-based fingerprinting.** Captured as the endgame option (D) in brainstorming. v1 uses DOM-structure hashing — cheap, deterministic, sufficient for the "is this a Button" use case.
- **Cross-origin index sharing.** One file per origin in v1. Future: shared design-system index across subdomains, or a "common library" index (shadcn defaults, MUI defaults) reusable across unrelated apps.
- **Index garbage collection / migration.** Entries stay forever; schema is `version: 1`. Migrations come if we change the shape.
- **Agent corrections.** No `correct_component_classification` tool; the trust model for crowdsourced corrections is unclear and out of scope.
- **OmniParser tier as a third classifier** (between rules and VLM). Real possibility — OmniParser already labels visible regions — but skipped for v1 to keep the classification flow simple. Likely follow-up after measuring VLM rate in practice.
- **Pre-existing AnimationCollector bug** (from #3) — unrelated, separate ticket.

## Architecture

```
   structural/dom-extractor.ts ────► DOM tree
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│  ComponentIndexer (new pipeline stage)                                │
│  src/pipelines/component-index/indexer.ts                             │
│                                                                       │
│  walk DOM →                                                           │
│    for each node:                                                     │
│      if heuristic.qualifies(node):                                    │
│        sig = fingerprint(node)                                        │
│        hit = matcher.lookup(sig)                                      │
│        if hit:                                                        │
│          map[nodeId] = {name, source, signature}                      │
│        else:                                                          │
│          cls = classifier.rules(node)                                 │
│          if cls:                                                      │
│            store.persist(sig, cls, 'rules')                           │
│            map[nodeId] = {name: cls, source: 'rules', signature: sig} │
│          else:                                                        │
│            queue.enqueue(sig, node, screenshot-crop-fn)               │
│            map[nodeId] = {name: null, status: 'pending', sig}         │
│                                                                       │
│  returns: Map<nodeId, ComponentInfo>                                  │
└─────────────────────────────┬─────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  fusion/serializer.ts (existing — extended)                           │
│  Consumes the DOM tree AND the indexer's Map. For each emitted        │
│  scene-graph node, looks up its nodeId in the map and (if present)    │
│  copies the ComponentInfo onto the node's `component` field.          │
│  No mutation of upstream parsed DOM.                                  │
└───────────────────────────────────────────────────────────────────────┘

Parallel side effect: VLM classification queue drains on MCP idle and
persists results to the store. Subsequent scene captures pick up the
classification on next traversal via the matcher's cache hit path.
```

**Pipeline integration point:** The indexer fires as a new stage between `structural/` (DOM extraction) and `fusion/` (scene-graph serialization). Its output (`Map<nodeId, ComponentInfo>`) is an input to the fusion serializer alongside the existing DOM tree and visual-pipeline output. **No mutation** of parsed DOM nodes — the `component` field appears only on the emitted scene-graph node.

**Module-boundary rationale:**
- Pure functions (`fingerprint`, `heuristic`, `classifier.rules`) carry math + decisions; testable as plain TS
- `store.ts` is the only file that touches disk; mockable behind a small interface
- `matcher.ts` is the read path; `indexer.ts` is the orchestrator
- VLM classification fires out-of-band from the hot path; the architecture doc's "frame loop (~16ms)" budget never pays for a VLM call

## Data shapes

### Signature

```typescript
function computeSignature(el: ParsedDomNode): string;
// Inputs (joined with '|'):
//   tag                 — e.g. 'button'
//   classes sorted      — class list deduped + sorted, joined with ','
//   childTagSequence    — direct children's tags in DOM order
//   childCount          — number of direct children
//   role                — aria-role if present
// Hash: sha256 → first 16 hex chars (64 bits).
```

**Why these inputs:**
- `tag` is the structural primary key
- sorting `classes` makes the hash order-stable
- `childTagSequence` distinguishes a Card (`<h3>+<p>`) from a Modal (`<header>+<main>+<footer>`)
- `childCount` is mildly redundant with sequence but cheap and conservative
- `role` catches `<div role="button">` and similar accessibility-styled patterns

### Index entry

```typescript
interface IndexedComponent {
  signature: string;                // hex, 16 chars
  classification: string;           // e.g. "Button", "Card", "Unknown"
  classificationSource: 'rules' | 'vlm';
  firstSeen: string;                // ISO timestamp
  lastSeen: string;
  occurrences: number;
  domSample: string;                // outerHTML truncated to ~500 chars (debug)
  source: 'first-traversal';        // 'storybook' is the v2 value; forward-compat
}
```

### Index file

```typescript
interface ComponentIndex {
  version: 1;
  origin: string;                   // e.g. "https://app.example.com"
  entries: Record<string, IndexedComponent>;   // keyed by signature
}
```

### Scene-graph extension

The fusion serializer adds an optional `component` field on each node:

```typescript
interface SceneGraphNode {
  // ... existing fields ...
  component?:
    | { name: string; source: 'rules' | 'vlm' | 'storybook'; signature: string }
    | { name: null; status: 'pending'; signature: string };
}
```

**Backwards-compatible:** existing consumers that ignore unknown fields are unaffected.

## Container heuristic (`heuristic.ts`)

A DOM node "qualifies as a component" if **any** of:

1. **Semantic tag** in `{button, input, textarea, select, form, dialog, nav, article, header, footer, main, section, a[href]}`
2. **Multi-child styled unit**: has a non-empty `classList` AND ≥1 child AND bbox area ≥ 40×40 px
3. **Explicit role** in `{button, dialog, navigation, article, form}`

Exclude:
- Text-only nodes
- Elements with no class list AND no semantic tag
- Elements smaller than 40×40 px (likely icons, dividers, decorations)

The heuristic is intentionally permissive — better to over-index a few layout containers than miss real components. Real-world testing will tell us where to tune.

## Classification

### Tier 1 — rules (synchronous, free)

`classifier.rules(node) → string | null`. Pure function over the parsed DOM node. Rule entries (~16 total, evaluated in order, first match wins):

| Condition | Classification |
|---|---|
| `tag === 'button'` OR `role === 'button'` | `Button` |
| `tag === 'a'` AND `attrs.href` | `Link` |
| `tag === 'input'`, `type === 'text'` | `TextInput` |
| `tag === 'input'`, `type === 'password'` | `PasswordInput` |
| `tag === 'input'`, `type === 'checkbox'` | `Checkbox` |
| `tag === 'input'`, `type === 'radio'` | `RadioButton` |
| `tag === 'textarea'` | `TextArea` |
| `tag === 'select'` | `Select` |
| `tag === 'form'` | `Form` |
| `tag === 'dialog'` OR `role === 'dialog'` | `Modal` |
| `tag === 'nav'` OR `role === 'navigation'` | `Nav` |
| `tag === 'article'` OR `role === 'article'` | `Card` |
| `tag === 'header'` | `Header` |
| `tag === 'footer'` | `Footer` |
| `tag === 'main'` | `Main` |
| `tag === 'section'` | `Section` |
| _(no match)_ | `null` → escalate to VLM |

### Tier 2 — VLM (deferred, expensive)

When rules return `null`, the matcher enqueues `(signature, node, screenshot-crop-fn)` on a background classification queue. The MCP server drains the queue when idle (no in-flight agent request). When classification completes, the entry persists; subsequent observations of the same signature hit the cached entry.

VLM call shape:
- Send the outerHTML (truncated to ~500 chars) + a screenshot crop of the node's bbox
- Existing visual tier infrastructure (Claude Vision via `analyze_visual`'s path)
- Prompt: "Reply with a single PascalCase component name. Prefer common names (Button, Card, Modal, TextInput). For custom design-system components, use the most descriptive name (e.g., 'ProductCard', 'PrimaryButton'). One word, PascalCase, no explanation."
- On failure (timeout, malformed reply): persist with `classification: 'Unknown'`. Don't retry automatically; future re-traversals will still re-queue if the entry was a stub, but `'Unknown'` is a terminal classification.

### Cold-path persistence semantics

- Misses queued for VLM result in a `pending` field on the node for the current observation only.
- The store does **not** persist a stub entry on miss. Persistence happens after classification completes.
- The next scene capture after classification arrival will read the cached entry and report the proper classification.

## Storage (`store.ts`)

- **Path:** `~/.uipe/component-index/<origin-slug>.json`
- **Slug:** origin with `://`, `.`, `/`, `:` replaced by `-` (e.g., `https://app.example.com:3000/` → `https-app-example-com-3000`)
- **Override:** env var `UIPE_COMPONENT_INDEX_DIR` overrides the default base directory; useful for testing and containerized deploys.
- **Missing file:** treat as empty index (`{ version: 1, origin, entries: {} }`)
- **Concurrency:** simple read-then-write; single MCP server process is the writer. If multi-process write contention becomes a real concern, switch to atomic write via temp-file rename.

## MCP tool

**`get_component_index(origin?: string)`** — new tool.

Returns:

```typescript
interface ComponentIndexResponse {
  origin: string;
  entries: IndexedComponent[];
  stats: {
    totalEntries: number;
    classifiedByRules: number;
    classifiedByVlm: number;
    pendingVlm: number;
    totalObservations: number;       // Σ occurrences
    indexHitRate: number;            // (totalObservations − unique entries on first encounter) / totalObservations
  };
}
```

`indexHitRate` is the load-bearing cost-reduction metric. On a fresh index, it starts near zero (first encounters all "miss"). After repeat traversals it should approach 1.0.

## Edge cases

| Case | Behavior |
|---|---|
| Element has no class list and no semantic tag | Doesn't qualify per heuristic; no `component` field on the scene-graph node. |
| Element is < 40×40 px even though it has a semantic tag (tiny `<button>` icon) | Still qualifies — semantic tag overrides the size threshold. The threshold only gates the multi-child styled-unit branch. |
| Same signature observed twice with different bboxes (same component rendered in two places) | Both observations attach the same `component.name`; the `occurrences` count increments to 2. Bbox is not part of the signature. |
| Web component / Shadow DOM | Out of v1 scope. The structural pipeline's DOM extractor's current behavior governs what gets visible. If shadow-DOM components surface as opaque nodes, they'll fingerprint by their host element's structure. |
| Element's outerHTML exceeds 500 chars | Truncate `domSample` at 500 chars with `…` suffix. Truncation is debug-only; doesn't affect the signature (which is computed before serialization to `domSample`). |
| Origin is `null` or unusual (e.g., `data:` URI, `file://`) | Slugify the same way (replace `:`, `/`, `.`). `data:`-scheme pages will share a single index file; rare enough to not matter. |
| Index file is corrupt JSON | Log a warning, treat as empty, overwrite on next persist. Don't crash. |
| VLM returns garbage (multi-word, lowercase, empty, error string) | Validate: must match `/^[A-Z][A-Za-z0-9]*$/` and be ≤ 40 chars. On validation failure, persist `'Unknown'`. |
| Concurrent MCP requests on the same origin | Reads are concurrent-safe (read-only file open). Writes are serialized via an in-memory `Map<origin, Promise<void>>` lock — at most one write per origin in flight at a time. |
| Disk write fails | Log the error, drop the entry. Future re-traversal will retry. Don't crash the MCP server. |

## Testing

### Pure unit tests in `tests/unit/pipelines/component-index/`

| File | Coverage |
|---|---|
| `fingerprint.test.ts` | Signature stability (same input → same hash); class-order insensitivity; role + tag both contribute; hash truncates to 16 hex chars; distinct inputs → distinct hashes (cardinality test on a small fixture). |
| `heuristic.test.ts` | Semantic tag qualifies; multi-child styled div ≥ 40×40 qualifies; tiny span doesn't; layout-only div (no classes, no semantic tag) doesn't; role-only qualifies. |
| `classifier.test.ts` | One hit case per rule entry; fall-through returns null; rule order (first match wins). |
| `store.test.ts` | Round-trip via temp dir; per-origin file path computation; env-var override; missing-file returns empty; corrupt-JSON returns empty + warning; concurrent-write lock prevents race. |
| `matcher.test.ts` | Mocked store + classifier: cached hit returns classification; rules-classifiable miss persists synchronously and returns rules-classified result; non-rules miss returns `{ name: null, status: 'pending' }` and enqueues. |

### Integration tests in `tests/integration/component-index/`

Each test uses a static HTML fixture under `tests/integration/component-index/fixtures/`.

| Scenario | Asserts |
|---|---|
| First pass — 5 named components (button, input, link, custom-div-A, custom-div-B) | Index gains ≥ 3 rules-classified entries; 2 entries pending VLM; scene graph nodes carry `component` fields. |
| Second pass after VLM mock returns classifications | 100% of components hit synchronously via cached entries; `pendingVlm === 0`. |
| Cost-reduction demo on a 10-component fixture | First pass: high miss rate; second pass: `indexHitRate ≥ 0.95`. |
| `get_component_index` MCP tool returns stats consistent with the index file | `classifiedByRules + classifiedByVlm + pendingVlm === totalEntries`; `indexHitRate` math is right. |

### E2E test in `tests/integration/component-index/component-index-e2e.test.ts`

One scenario, Playwright + real Chromium (same pattern as #3's integration test):

- Mount a static HTML fixture with 5 named components via `page.setContent()`
- Attach the existing structural pipeline + the new indexer
- Run two passes
- Assert: second pass observes near-100% cache hits

### Performance budget

- `fingerprint` should run in < 100µs per node on a typical 50-element scene graph (it's pure hashing of a tiny string)
- `store.read` should complete in < 5ms on a 1000-entry index (JSON parse of ~250KB)
- `matcher.lookup` should be O(1) (Map access on the parsed index)
- VLM classification has no budget — runs out-of-band

If `fingerprint` ever exceeds 1ms per call, that's a regression worth fixing — likely indicates we accidentally started serializing recursive child trees.

## Implementation phasing (rough — full task breakdown in subsequent plan)

1. Types + scene-graph extension
2. Pure: `fingerprint.ts`
3. Pure: `heuristic.ts`
4. Pure: `classifier.ts` rules path
5. `store.ts` with temp-dir tests
6. `matcher.ts` orchestration
7. `indexer.ts` DOM walk
8. VLM classification queue + classifier integration
9. MCP tool `get_component_index`
10. Fusion serializer integration (adds `component` field on emitted nodes)
11. E2E test fixture + integration test
12. Docs + roadmap update

## Open questions / follow-ups

- **Heuristic tuning.** The 40×40 px threshold is a guess. Real-world testing will tell us if it's too permissive (over-indexing layouts) or too strict (missing small components).
- **VLM rate-limit / backpressure.** Idle drain is simple; under sustained traffic the queue could grow unboundedly. If a real test surfaces this, add a queue cap (oldest dropped) or a concurrency limit (max 2 in-flight VLM calls).
- **Storybook adapter (v2).** When this lands, decide whether Storybook-seeded entries override first-traversal classifications or vice versa.
- **OmniParser tier as classifier-1.5.** If VLM rate is too high, slot OmniParser's existing labels (button, input, image, icon, text) as a free intermediate tier.
- **Cross-origin sharing.** A "common library" index (shadcn, MUI defaults) reusable across apps could massively reduce cold-start cost. Design surface: how does the indexer know which library defaults apply to which app?

## References

- [`docs/architecture.md`](../../architecture.md) §"HD map prior — design systems as maps"
- [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) sub-project #4
- [`src/pipelines/structural/dom-extractor.ts`](../../../src/pipelines/structural/dom-extractor.ts) — existing DOM extraction the indexer consumes
- [`src/pipelines/fusion/serializer.ts`](../../../src/pipelines/fusion/serializer.ts) — where the new `component` field gets attached to scene-graph nodes
- [Brainstorming for #3](2026-05-11-animation-predictive-verification-design.md) — the most recent reference for spec/plan style and pure-helpers + orchestrator pattern this design borrows from
