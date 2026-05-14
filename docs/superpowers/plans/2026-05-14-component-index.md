# Component Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index every styled-as-a-unit DOM region by its structural signature, classify each signature once (rules synchronously, VLM out-of-band), and reuse the classification on subsequent observations so that on a familiar app most components resolve via index lookup instead of paying a VLM call.

**Architecture:** A new pipeline stage `src/pipelines/component-index/` runs between structural extraction and fusion. Pure helpers (`fingerprint`, `heuristic`, `classifier`) carry math + decisions. `store.ts` is the only file that touches disk. `matcher.ts` is the read path; `indexer.ts` orchestrates the DOM walk. A separate `vlm-classifier.ts` wraps Claude Vision for component naming; a `queue.ts` defers those calls. The fusion serializer is extended to accept an optional `Map<nodeId, ComponentField>` and copies entries onto emitted scene-graph nodes without mutating upstream parsed DOM. A new MCP tool `get_component_index` exposes the index for inspection.

**Tech Stack:** TypeScript (ESM with `.js` import extensions), Playwright, Vitest, pnpm, `sharp` (already a dep, used for bbox cropping), Anthropic SDK (already used by `ClaudeVisionProvider`).

**Spec:** [`docs/superpowers/specs/2026-05-12-component-index-design.md`](../specs/2026-05-12-component-index-design.md).

---

## File Structure

**New files (production):**

```
src/pipelines/component-index/
├── types.ts             IndexedComponent, ComponentIndex, ComponentField, ClassificationSource
├── fingerprint.ts       computeSignature() — sha256(tag|classes|childTags|childCount|role) → 16 hex
├── heuristic.ts         qualifies(node, nodeMap) — semantic tag / multi-child styled / role
├── classifier.ts        classifyByRules(node) — 16 ordered rules → string | null
├── store.ts             loadIndex / saveIndex / slugifyOrigin; ~/.uipe/component-index/ with env override
├── vlm-classifier.ts    classifyByVlm(html, screenshotCrop) — Claude Vision call + PascalCase validation
├── queue.ts             ClassificationQueue — enqueue + drainOnce(classifier, screenshotProvider, store)
├── matcher.ts           Matcher.lookup() — orchestrates store + rules + queue
└── indexer.ts           Indexer.run(structural, context) → Map<nodeId, ComponentField>
```

**New files (tests):**

```
tests/unit/pipelines/component-index/
├── types.test.ts
├── fingerprint.test.ts
├── heuristic.test.ts
├── classifier.test.ts
├── store.test.ts
├── vlm-classifier.test.ts
├── queue.test.ts
├── matcher.test.ts
└── indexer.test.ts

tests/integration/component-index/
├── fixtures/
│   └── five-components.html        Static HTML with 5 named components
└── component-index-e2e.test.ts     Playwright + real Chromium two-pass demo
```

**New files (MCP):**

```
src/mcp/tools/get-component-index.ts
```

**Modified files:**

```
src/types/scene-graph.ts                          # Add `component?: ComponentField` to SceneNode
src/pipelines/fusion/index.ts                     # FusionEngine.fuse() accepts optional componentMap
src/pipelines/fusion/node-builder.ts              # buildSceneNode attaches `component` if id in map
src/mcp/server.ts                                 # Instantiate Indexer; pass map to fuse(); drain queue after handlers; register tool
tests/unit/pipelines/fusion/                      # Extend node-builder/fusion tests to cover the new field
/Users/dirkknibbe/uipe/docs/architecture.md       # Flip sub-project #4 row in "Current implementation" table
/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md  # Flip #4 status from ▶ to ✅
```

**Module-boundary rationale (recap from spec):** Pure helpers are plain-TS testable without browser or disk. `store.ts` is the only disk-touching file (mockable via the env-var override). `vlm-classifier.ts` is the only Anthropic-SDK-touching file (mockable). `queue.ts` defers VLM work out-of-band so the architecture-doc "frame loop ~16ms" budget never pays for it. `matcher.ts` is the read path; `indexer.ts` is the DOM-walking orchestrator. Fusion is extended (4th optional arg + lookup-and-attach) — not split.

**Fusion integration risk check (verified during planning):** `FusionEngine.fuse(visual, structural, context)` lives in `src/pipelines/fusion/index.ts:16`. Adding a 4th optional `componentMap?: ReadonlyMap<string, ComponentField>` parameter and threading it through `buildSceneNode` (`src/pipelines/fusion/node-builder.ts:14`) is a ~3-line change. The structural node id (`StructuralNode.id`) is preserved as `SceneNode.id` (`node-builder.ts:17`), so the map keys line up directly. No major surgery required.

**On-disk location check (verified during planning):** `~/.uipe/` does not exist on this machine today; no UIPE-managed dotdir on disk. `~/.uipe/component-index/` is safe to create.

---

## Common commands

All commands run from the `ui-perception-engine/` directory.

- Run all tests: `pnpm exec vitest run --reporter=verbose`
- Run a single test file: `pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/fingerprint.test.ts`
- Run all component-index unit tests: `pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/`
- Typecheck: `pnpm exec tsc --noEmit`
- Lint: `pnpm exec eslint src tests --ext .ts`

After every task: typecheck must pass, all existing tests must still pass, then commit.

**Note on full-suite runs:** The optical-flow integration tests (`tests/integration/optical-flow-pipeline.test.ts`) are slow. If the full suite times out on a given task, scope tests to `tests/unit/` and the new `tests/integration/component-index/` directory and run `pnpm exec tsc --noEmit` separately as the type-safety ground truth.

---

## Task 1: Types + `SceneNode` extension

**Files:**
- Create: `src/pipelines/component-index/types.ts`
- Modify: `src/types/scene-graph.ts`
- Create: `tests/unit/pipelines/component-index/types.test.ts`

This task is types-only. It compiles to nothing at runtime, but the type-construction assertions in the test file lock in the contract.

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/types.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import type {
  IndexedComponent,
  ComponentIndex,
  ComponentField,
  ClassificationSource,
} from '../../../../src/pipelines/component-index/types.js';
import type { SceneNode } from '../../../../src/types/index.js';

describe('IndexedComponent', () => {
  it('accepts a rules-classified entry', () => {
    const entry: IndexedComponent = {
      signature: '0123456789abcdef',
      classification: 'Button',
      classificationSource: 'rules',
      firstSeen: '2026-05-14T00:00:00Z',
      lastSeen: '2026-05-14T00:00:00Z',
      occurrences: 1,
      domSample: '<button class="primary">Click</button>',
      source: 'first-traversal',
    };
    expect(entry.classificationSource).toBe('rules');
  });

  it('accepts a vlm-classified entry', () => {
    const entry: IndexedComponent = {
      signature: 'abcdef0123456789',
      classification: 'ProductCard',
      classificationSource: 'vlm',
      firstSeen: '2026-05-14T00:00:00Z',
      lastSeen: '2026-05-14T00:00:00Z',
      occurrences: 7,
      domSample: '<div class="card product">…</div>',
      source: 'first-traversal',
    };
    expect(entry.classification).toBe('ProductCard');
  });
});

describe('ComponentIndex', () => {
  it('keys entries by signature', () => {
    const index: ComponentIndex = {
      version: 1,
      origin: 'https://app.example.com',
      entries: {
        '0123456789abcdef': {
          signature: '0123456789abcdef',
          classification: 'Button',
          classificationSource: 'rules',
          firstSeen: '2026-05-14T00:00:00Z',
          lastSeen: '2026-05-14T00:00:00Z',
          occurrences: 1,
          domSample: '',
          source: 'first-traversal',
        },
      },
    };
    expect(index.entries['0123456789abcdef'].classification).toBe('Button');
  });
});

describe('ComponentField', () => {
  it('accepts a resolved variant', () => {
    const f: ComponentField = { name: 'Button', source: 'rules', signature: '0123456789abcdef' };
    expect(f.name).toBe('Button');
  });

  it('accepts a pending variant', () => {
    const f: ComponentField = { name: null, status: 'pending', signature: '0123456789abcdef' };
    expect(f.status).toBe('pending');
  });

  it('source covers rules | vlm | storybook', () => {
    const a: ClassificationSource = 'rules';
    const b: ClassificationSource = 'vlm';
    const c: ClassificationSource = 'storybook';
    expect([a, b, c]).toEqual(['rules', 'vlm', 'storybook']);
  });
});

describe('SceneNode.component', () => {
  it('accepts a SceneNode with a component field', () => {
    const n: Pick<SceneNode, 'id' | 'component'> = {
      id: 'dom-1',
      component: { name: 'Button', source: 'rules', signature: '0123456789abcdef' },
    };
    expect(n.component?.name).toBe('Button');
  });

  it('accepts a SceneNode without a component field', () => {
    const n: Pick<SceneNode, 'id' | 'component'> = { id: 'dom-2' };
    expect(n.component).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run typecheck — should FAIL because types don't exist yet**

```bash
pnpm exec tsc --noEmit
```
Expected: errors about `IndexedComponent`, `ComponentIndex`, `ComponentField`, `ClassificationSource` not being exported from `component-index/types.ts`, and `component` not being a property of `SceneNode`.

- [ ] **Step 3: Create `src/pipelines/component-index/types.ts`**

```typescript
export type ClassificationSource = 'rules' | 'vlm' | 'storybook';

export interface IndexedComponent {
  signature: string;                       // 16 hex chars
  classification: string;                  // e.g. "Button", "ProductCard", "Unknown"
  classificationSource: 'rules' | 'vlm';
  firstSeen: string;                       // ISO timestamp
  lastSeen: string;
  occurrences: number;
  domSample: string;                       // outerHTML truncated to ~500 chars
  source: 'first-traversal' | 'storybook'; // 'storybook' is forward-compat (v2)
}

export interface ComponentIndex {
  version: 1;
  origin: string;
  entries: Record<string, IndexedComponent>;
}

export type ComponentField =
  | { name: string; source: ClassificationSource; signature: string }
  | { name: null; status: 'pending'; signature: string };
```

- [ ] **Step 4: Modify `src/types/scene-graph.ts` to add the optional `component` field**

Find:
```typescript
  // Source confidence
  visualConfidence: number;
  structuralConfidence: number;
  fusionMethod: FusionMethod;
}
```

Replace with:
```typescript
  // Source confidence
  visualConfidence: number;
  structuralConfidence: number;
  fusionMethod: FusionMethod;

  // Component classification (sub-project #4)
  component?:
    | { name: string; source: 'rules' | 'vlm' | 'storybook'; signature: string }
    | { name: null; status: 'pending'; signature: string };
}
```

We re-declare the shape inline (rather than importing `ComponentField`) to keep `src/types/` free of dependencies on `src/pipelines/`. The pipeline's `ComponentField` type is structurally identical and assignable to this field.

- [ ] **Step 5: Run typecheck and the new tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/types.test.ts
```
Expected: typecheck passes, all 7 test cases pass.

- [ ] **Step 6: Run the full unit suite to confirm nothing else broke**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/
```
Expected: previously-passing unit tests all still pass, plus the 7 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/pipelines/component-index/types.ts src/types/scene-graph.ts tests/unit/pipelines/component-index/types.test.ts
git commit -m "feat(component-index): types + SceneNode.component field"
```

---

## Task 2: Pure helper — `fingerprint.ts`

**Files:**
- Create: `src/pipelines/component-index/fingerprint.ts`
- Create: `tests/unit/pipelines/component-index/fingerprint.test.ts`

Computes a structural signature for a `StructuralNode`. The signature is sha256 of `tag|sortedDedupedClasses|childTagSequence|childCount|role`, truncated to the first 16 hex chars (64 bits — plenty of cardinality for component indexing).

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/fingerprint.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { computeSignature } from '../../../../src/pipelines/component-index/fingerprint.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(partial: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: partial.id,
    tag: partial.tag,
    role: partial.role,
    name: undefined,
    text: undefined,
    boundingBox: partial.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: {
      display: 'block', visibility: 'visible', opacity: 1,
      position: 'static', zIndex: 0, overflow: 'visible',
      pointerEvents: 'auto', cursor: 'auto',
    },
    attributes: partial.attributes ?? {},
    states: {
      isVisible: true, isInteractable: false, isDisabled: false,
      isFocused: false, isEditable: false,
    },
    children: partial.children ?? [],
    parent: undefined,
  };
}

describe('computeSignature', () => {
  it('produces a 16-hex-character string', () => {
    const node = mkNode({ id: 'a', tag: 'button' });
    const sig = computeSignature(node, new Map());
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns the same signature for the same input', () => {
    const node = mkNode({ id: 'a', tag: 'button', attributes: { class: 'primary large' } });
    const map = new Map();
    expect(computeSignature(node, map)).toBe(computeSignature(node, map));
  });

  it('is insensitive to class order', () => {
    const a = mkNode({ id: 'a', tag: 'div', attributes: { class: 'primary large' } });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: 'large primary' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });

  it('deduplicates classes', () => {
    const a = mkNode({ id: 'a', tag: 'div', attributes: { class: 'foo foo bar' } });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: 'foo bar' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });

  it('changes when tag changes', () => {
    const a = mkNode({ id: 'a', tag: 'button' });
    const b = mkNode({ id: 'b', tag: 'a' });
    expect(computeSignature(a, new Map())).not.toBe(computeSignature(b, new Map()));
  });

  it('changes when role changes', () => {
    const a = mkNode({ id: 'a', tag: 'div' });
    const b = mkNode({ id: 'b', tag: 'div', role: 'button' });
    expect(computeSignature(a, new Map())).not.toBe(computeSignature(b, new Map()));
  });

  it('incorporates childTagSequence (Card vs Modal)', () => {
    const card = mkNode({ id: 'a', tag: 'div', children: ['h1', 'p'] });
    const modal = mkNode({ id: 'b', tag: 'div', children: ['hdr', 'mn', 'ft'] });
    const map = new Map<string, StructuralNode>([
      ['h1', mkNode({ id: 'h1', tag: 'h3' })],
      ['p',  mkNode({ id: 'p',  tag: 'p'  })],
      ['hdr', mkNode({ id: 'hdr', tag: 'header' })],
      ['mn',  mkNode({ id: 'mn',  tag: 'main' })],
      ['ft',  mkNode({ id: 'ft',  tag: 'footer' })],
    ]);
    expect(computeSignature(card, map)).not.toBe(computeSignature(modal, map));
  });

  it('child tag order is part of the signature (a different sequence → different hash)', () => {
    const a = mkNode({ id: 'a', tag: 'div', children: ['x', 'y'] });
    const b = mkNode({ id: 'b', tag: 'div', children: ['y', 'x'] });
    const map = new Map<string, StructuralNode>([
      ['x', mkNode({ id: 'x', tag: 'span' })],
      ['y', mkNode({ id: 'y', tag: 'p' })],
    ]);
    expect(computeSignature(a, map)).not.toBe(computeSignature(b, map));
  });

  it('produces distinct signatures across a small fixture (cardinality smoke)', () => {
    const sigs = new Set<string>();
    const cases: Array<Partial<StructuralNode> & { id: string; tag: string }> = [
      { id: '1', tag: 'button' },
      { id: '2', tag: 'a',     attributes: { href: '/x' } },
      { id: '3', tag: 'input', attributes: { type: 'text' } },
      { id: '4', tag: 'div',   attributes: { class: 'card' } },
      { id: '5', tag: 'div',   attributes: { class: 'card primary' } },
      { id: '6', tag: 'div',   role: 'button' },
    ];
    for (const c of cases) {
      sigs.add(computeSignature(mkNode(c), new Map()));
    }
    expect(sigs.size).toBe(cases.length);
  });

  it('treats missing class attribute as empty class list', () => {
    const a = mkNode({ id: 'a', tag: 'div' });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: '' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });
});
```

- [ ] **Step 2: Run the test — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/fingerprint.test.ts
```
Expected: module-not-found errors.

- [ ] **Step 3: Create `src/pipelines/component-index/fingerprint.ts`**

```typescript
import { createHash } from 'node:crypto';
import type { StructuralNode } from '../../types/index.js';

/**
 * Compute a 16-hex-char structural signature for a DOM node. Inputs joined
 * with '|':
 *   tag | sortedDedupedClasses | childTagSequence | childCount | role
 * Hash: sha256, truncated to first 16 hex chars (64 bits — ample cardinality).
 */
export function computeSignature(node: StructuralNode, nodeMap: ReadonlyMap<string, StructuralNode>): string {
  const tag = node.tag;
  const classes = extractSortedClasses(node);
  const childTags = node.children
    .map((id) => nodeMap.get(id)?.tag ?? '?')
    .join(',');
  const childCount = String(node.children.length);
  const role = node.role ?? '';

  const input = [tag, classes, childTags, childCount, role].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function extractSortedClasses(node: StructuralNode): string {
  const raw = node.attributes['class'];
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter((c) => c.length > 0);
  const deduped = Array.from(new Set(parts));
  deduped.sort();
  return deduped.join(',');
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/fingerprint.test.ts
```
Expected: 10 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/component-index/fingerprint.ts tests/unit/pipelines/component-index/fingerprint.test.ts
git commit -m "feat(component-index): computeSignature — sha256(tag|classes|childTags|childCount|role)"
```

---

## Task 3: Pure helper — `heuristic.ts`

**Files:**
- Create: `src/pipelines/component-index/heuristic.ts`
- Create: `tests/unit/pipelines/component-index/heuristic.test.ts`

`qualifies(node)` returns true if the node "is component-shaped enough to fingerprint." The spec's three branches:

1. **Semantic tag** in `{button, input, textarea, select, form, dialog, nav, article, header, footer, main, section, a[href]}`
2. **Multi-child styled unit**: non-empty `classList` AND ≥1 child AND bbox area ≥ 40×40
3. **Explicit role** in `{button, dialog, navigation, article, form}`

Exclusion: text-only nodes, elements with no classes AND no semantic tag, elements smaller than 40×40 px on the multi-child branch only (semantic tag overrides the size threshold per spec edge case "tiny `<button>` icon").

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/heuristic.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { qualifies } from '../../../../src/pipelines/component-index/heuristic.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: {
      display: 'block', visibility: 'visible', opacity: 1,
      position: 'static', zIndex: 0, overflow: 'visible',
      pointerEvents: 'auto', cursor: 'auto',
    },
    attributes: p.attributes ?? {},
    states: {
      isVisible: true, isInteractable: false, isDisabled: false,
      isFocused: false, isEditable: false,
    },
    children: p.children ?? [],
    parent: undefined,
  };
}

describe('qualifies', () => {
  it('semantic <button> qualifies even when tiny (10×10)', () => {
    expect(qualifies(mkNode({
      id: 'b', tag: 'button', boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    }))).toBe(true);
  });

  it('<input>, <textarea>, <select>, <form>, <dialog>, <nav>, <article>, <header>, <footer>, <main>, <section> all qualify', () => {
    for (const tag of ['input', 'textarea', 'select', 'form', 'dialog', 'nav', 'article', 'header', 'footer', 'main', 'section']) {
      expect(qualifies(mkNode({ id: tag, tag }))).toBe(true);
    }
  });

  it('<a> with href qualifies; <a> without href does not (unless multi-child styled)', () => {
    expect(qualifies(mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }))).toBe(true);
    expect(qualifies(mkNode({ id: 'a2', tag: 'a' }))).toBe(false);
  });

  it('multi-child styled div with bbox ≥ 40×40 qualifies', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'card' },
      children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(true);
  });

  it('multi-child styled div below 40×40 does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'card' },
      children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 30, height: 30 },
    }))).toBe(false);
  });

  it('div with class but no children does NOT qualify (multi-child branch wants ≥1 child)', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'wrapper' },
      children: [],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(false);
  });

  it('layout-only div (no class, no semantic tag, no role) does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div', children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(false);
  });

  it('role-only qualifies (e.g. <div role="button">)', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div', role: 'button',
    }))).toBe(true);
  });

  it('role="navigation", "dialog", "article", "form" qualify', () => {
    for (const role of ['navigation', 'dialog', 'article', 'form']) {
      expect(qualifies(mkNode({ id: role, tag: 'div', role }))).toBe(true);
    }
  });

  it('text-only node (no tag-class-role match) does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 's', tag: 'span', text: 'hello',
    }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/heuristic.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/heuristic.ts`**

```typescript
import type { StructuralNode } from '../../types/index.js';

const SEMANTIC_TAGS = new Set([
  'button', 'input', 'textarea', 'select', 'form',
  'dialog', 'nav', 'article', 'header', 'footer',
  'main', 'section',
]);

const QUALIFYING_ROLES = new Set([
  'button', 'dialog', 'navigation', 'article', 'form',
]);

const MIN_DIMENSION = 40;

/**
 * Returns true if the node is "component-shaped enough to fingerprint and
 * classify." Three branches, any one is sufficient:
 *
 *   1. Semantic tag (button, input, dialog, nav, article, ...; <a> requires href)
 *   2. Multi-child styled unit: ≥1 class && ≥1 child && bbox ≥ 40×40
 *   3. Explicit role (button, dialog, navigation, article, form)
 */
export function qualifies(node: StructuralNode): boolean {
  if (hasSemanticTag(node)) return true;
  if (hasQualifyingRole(node)) return true;
  if (isMultiChildStyledUnit(node)) return true;
  return false;
}

function hasSemanticTag(node: StructuralNode): boolean {
  if (node.tag === 'a') return typeof node.attributes['href'] === 'string';
  return SEMANTIC_TAGS.has(node.tag);
}

function hasQualifyingRole(node: StructuralNode): boolean {
  return typeof node.role === 'string' && QUALIFYING_ROLES.has(node.role);
}

function isMultiChildStyledUnit(node: StructuralNode): boolean {
  const cls = node.attributes['class'];
  if (!cls || cls.trim().length === 0) return false;
  if (node.children.length === 0) return false;
  const { width, height } = node.boundingBox;
  return width >= MIN_DIMENSION && height >= MIN_DIMENSION;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/heuristic.test.ts
```
Expected: 10 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/heuristic.ts tests/unit/pipelines/component-index/heuristic.test.ts
git commit -m "feat(component-index): qualifies() — semantic-tag / role / multi-child styled heuristic"
```

---

## Task 4: Pure helper — `classifier.ts` (rules tier)

**Files:**
- Create: `src/pipelines/component-index/classifier.ts`
- Create: `tests/unit/pipelines/component-index/classifier.test.ts`

`classifyByRules(node)` returns a classification string or `null` (signals "escalate to VLM"). 16 ordered rules, first match wins, per spec table.

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/classifier.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyByRules } from '../../../../src/pipelines/component-index/classifier.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: {
      display: 'block', visibility: 'visible', opacity: 1,
      position: 'static', zIndex: 0, overflow: 'visible',
      pointerEvents: 'auto', cursor: 'auto',
    },
    attributes: p.attributes ?? {},
    states: {
      isVisible: true, isInteractable: false, isDisabled: false,
      isFocused: false, isEditable: false,
    },
    children: [],
    parent: undefined,
  };
}

describe('classifyByRules', () => {
  it('tag=button → Button', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'button' }))).toBe('Button');
  });

  it('role=button → Button (even on a div)', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'div', role: 'button' }))).toBe('Button');
  });

  it('tag=a with href → Link', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'a', attributes: { href: '/x' } }))).toBe('Link');
  });

  it('tag=a without href → null (no rule matches)', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'a' }))).toBeNull();
  });

  it('input[type=text] → TextInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'text' } }))).toBe('TextInput');
  });

  it('input[type=password] → PasswordInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'password' } }))).toBe('PasswordInput');
  });

  it('input[type=checkbox] → Checkbox', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'checkbox' } }))).toBe('Checkbox');
  });

  it('input[type=radio] → RadioButton', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'radio' } }))).toBe('RadioButton');
  });

  it('input with no type defaults to text → TextInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input' }))).toBe('TextInput');
  });

  it('tag=textarea → TextArea', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'textarea' }))).toBe('TextArea');
  });

  it('tag=select → Select', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'select' }))).toBe('Select');
  });

  it('tag=form → Form', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'form' }))).toBe('Form');
  });

  it('tag=dialog OR role=dialog → Modal', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'dialog' }))).toBe('Modal');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'dialog' }))).toBe('Modal');
  });

  it('tag=nav OR role=navigation → Nav', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'nav' }))).toBe('Nav');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'navigation' }))).toBe('Nav');
  });

  it('tag=article OR role=article → Card', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'article' }))).toBe('Card');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'article' }))).toBe('Card');
  });

  it('tag=header → Header', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'header' }))).toBe('Header');
  });

  it('tag=footer → Footer', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'footer' }))).toBe('Footer');
  });

  it('tag=main → Main', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'main' }))).toBe('Main');
  });

  it('tag=section → Section', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'section' }))).toBe('Section');
  });

  it('unknown div → null', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'div', attributes: { class: 'foo' } }))).toBeNull();
  });

  it('first-match-wins: tag=button beats no role', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'button', role: 'dialog' }))).toBe('Button');
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/classifier.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/classifier.ts`**

```typescript
import type { StructuralNode } from '../../types/index.js';

/**
 * Tier-1 (synchronous, free) classifier. Returns a PascalCase classification
 * string or null. Null signals "no rule matched — escalate to VLM."
 *
 * Rules are evaluated in declaration order; first match wins.
 */
export function classifyByRules(node: StructuralNode): string | null {
  if (node.tag === 'button' || node.role === 'button') return 'Button';
  if (node.tag === 'a' && typeof node.attributes['href'] === 'string') return 'Link';
  if (node.tag === 'input') {
    // <input> defaults to type=text per HTML spec.
    const type = node.attributes['type'] ?? 'text';
    if (type === 'text') return 'TextInput';
    if (type === 'password') return 'PasswordInput';
    if (type === 'checkbox') return 'Checkbox';
    if (type === 'radio') return 'RadioButton';
    // Other input types (email, number, date, ...) fall through to VLM.
    return null;
  }
  if (node.tag === 'textarea') return 'TextArea';
  if (node.tag === 'select') return 'Select';
  if (node.tag === 'form') return 'Form';
  if (node.tag === 'dialog' || node.role === 'dialog') return 'Modal';
  if (node.tag === 'nav' || node.role === 'navigation') return 'Nav';
  if (node.tag === 'article' || node.role === 'article') return 'Card';
  if (node.tag === 'header') return 'Header';
  if (node.tag === 'footer') return 'Footer';
  if (node.tag === 'main') return 'Main';
  if (node.tag === 'section') return 'Section';
  return null;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/classifier.test.ts
```
Expected: 21 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/classifier.ts tests/unit/pipelines/component-index/classifier.test.ts
git commit -m "feat(component-index): tier-1 rules-based classifier (16 rules)"
```

---

## Task 5: `store.ts` — disk-backed component index

**Files:**
- Create: `src/pipelines/component-index/store.ts`
- Create: `tests/unit/pipelines/component-index/store.test.ts`

The only file in the pipeline that touches disk. Provides `loadIndex(origin)`, `saveIndex(origin, index)`, and `slugifyOrigin(origin)`. Location: `~/.uipe/component-index/<slug>.json`, overridable via `UIPE_COMPONENT_INDEX_DIR` env var (useful for testing and containerized deploys). Missing file → empty index. Corrupt JSON → log warning + empty index. Writes are serialized per-origin via an in-memory `Map<origin, Promise<void>>` lock.

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/store.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentIndexStore, slugifyOrigin } from '../../../../src/pipelines/component-index/store.js';
import type { ComponentIndex, IndexedComponent } from '../../../../src/pipelines/component-index/types.js';

function mkEntry(sig: string, classification = 'Button'): IndexedComponent {
  return {
    signature: sig,
    classification,
    classificationSource: 'rules',
    firstSeen: '2026-05-14T00:00:00Z',
    lastSeen: '2026-05-14T00:00:00Z',
    occurrences: 1,
    domSample: '<button>x</button>',
    source: 'first-traversal',
  };
}

describe('slugifyOrigin', () => {
  it('replaces :, /, . with -', () => {
    expect(slugifyOrigin('https://app.example.com')).toBe('https---app-example-com');
  });

  it('handles ports', () => {
    expect(slugifyOrigin('https://app.example.com:3000/')).toBe('https---app-example-com-3000-');
  });

  it('handles data: URIs', () => {
    expect(slugifyOrigin('data:text/html,foo')).toBe('data-text-html,foo');
  });
});

describe('ComponentIndexStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses UIPE_COMPONENT_INDEX_DIR env var when set', () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    expect(store.pathFor('https://app.example.com')).toBe(join(tmpDir, 'https---app-example-com.json'));
  });

  it('returns empty index when file is missing', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const index = await store.load('https://app.example.com');
    expect(index).toEqual({ version: 1, origin: 'https://app.example.com', entries: {} });
  });

  it('returns empty index and logs when file is corrupt JSON', async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, 'https---app-example-com.json'), 'not-json{');
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const index = await store.load('https://app.example.com');
    expect(index.entries).toEqual({});
  });

  it('round-trips: save then load', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const initial: ComponentIndex = {
      version: 1,
      origin: 'https://app.example.com',
      entries: { '01234567': mkEntry('01234567') },
    };
    await store.save('https://app.example.com', initial);
    const reloaded = await store.load('https://app.example.com');
    expect(reloaded).toEqual(initial);
  });

  it('serializes concurrent writes per origin (no lost updates)', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const origin = 'https://app.example.com';

    // Two concurrent writers; each reads-then-writes. With the per-origin
    // lock, the second waits for the first.
    async function writer(sig: string) {
      const current = await store.load(origin);
      current.entries[sig] = mkEntry(sig);
      await store.save(origin, current);
    }

    await Promise.all([writer('aaaa1111'), writer('bbbb2222')]);
    const final = await store.load(origin);
    expect(Object.keys(final.entries).sort()).toEqual(['aaaa1111', 'bbbb2222']);
  });

  it('creates the base directory if it does not exist', async () => {
    const nested = join(tmpDir, 'a', 'b', 'c');
    const store = new ComponentIndexStore({ baseDir: nested });
    await store.save('https://x', { version: 1, origin: 'https://x', entries: {} });
    const written = await readFile(join(nested, 'https---x.json'), 'utf8');
    expect(JSON.parse(written).version).toBe(1);
  });

  it('does not crash on disk write failure (returns false)', async () => {
    // Point at a path inside a file (impossible to mkdir over) to force EEXIST.
    const fakeFile = join(tmpDir, 'block');
    await writeFile(fakeFile, 'i am a file');
    const store = new ComponentIndexStore({ baseDir: join(fakeFile, 'sub') });
    const ok = await store.save('https://x', { version: 1, origin: 'https://x', entries: {} });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/store.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/store.ts`**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createLogger } from '../../utils/logger.js';
import type { ComponentIndex } from './types.js';

const logger = createLogger('ComponentIndexStore');

export function slugifyOrigin(origin: string): string {
  return origin.replace(/[:./]/g, '-');
}

function defaultBaseDir(): string {
  if (process.env.UIPE_COMPONENT_INDEX_DIR) return process.env.UIPE_COMPONENT_INDEX_DIR;
  return join(homedir(), '.uipe', 'component-index');
}

export interface ComponentIndexStoreOptions {
  baseDir?: string;
}

export class ComponentIndexStore {
  private baseDir: string;
  private locks = new Map<string, Promise<void>>();

  constructor(opts: ComponentIndexStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
  }

  pathFor(origin: string): string {
    return join(this.baseDir, `${slugifyOrigin(origin)}.json`);
  }

  async load(origin: string): Promise<ComponentIndex> {
    const path = this.pathFor(origin);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as ComponentIndex;
      if (parsed.version !== 1 || typeof parsed.origin !== 'string' || typeof parsed.entries !== 'object') {
        logger.warn('Component index has unexpected shape, treating as empty', { path });
        return { version: 1, origin, entries: {} };
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { version: 1, origin, entries: {} };
      }
      logger.warn('Failed to load component index, treating as empty', { path, error: String(err) });
      return { version: 1, origin, entries: {} };
    }
  }

  /**
   * Persist the index. Returns true on success, false on failure (caller can
   * decide to drop the entry; future re-traversal will retry).
   * Serializes concurrent writes for the same origin.
   */
  async save(origin: string, index: ComponentIndex): Promise<boolean> {
    const previous = this.locks.get(origin) ?? Promise.resolve();
    const next = previous.then(() => this.writeNow(origin, index));
    // Store the chain so subsequent callers queue behind it. We swallow
    // failures in the chained promise to avoid poisoning the lock.
    this.locks.set(origin, next.then(() => undefined, () => undefined));
    return next;
  }

  private async writeNow(origin: string, index: ComponentIndex): Promise<boolean> {
    const path = this.pathFor(origin);
    try {
      await mkdir(this.baseDir, { recursive: true });
      await writeFile(path, JSON.stringify(index, null, 2), 'utf8');
      return true;
    } catch (err) {
      logger.warn('Failed to write component index', { path, error: String(err) });
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/store.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/store.ts tests/unit/pipelines/component-index/store.test.ts
git commit -m "feat(component-index): disk-backed store with per-origin write lock and env-var override"
```

---

## Task 6: VLM classifier + classification queue

**Files:**
- Create: `src/pipelines/component-index/vlm-classifier.ts`
- Create: `src/pipelines/component-index/queue.ts`
- Create: `tests/unit/pipelines/component-index/vlm-classifier.test.ts`
- Create: `tests/unit/pipelines/component-index/queue.test.ts`

`vlm-classifier.ts` wraps the Anthropic SDK to ask "what component is this?" given an outerHTML snippet + a screenshot crop. Validates the response is a single PascalCase token ≤ 40 chars; falls back to `'Unknown'` on garbage or network failure.

`queue.ts` defines `ClassificationQueue` which holds pending (signature, html, bbox) triples and drains them on demand. The MCP server triggers a drain after each tool handler completes (no proactive timer in v1 — simple "idle" approximation).

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/vlm-classifier.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { classifyByVlm } from '../../../../src/pipelines/component-index/vlm-classifier.js';

function mkClient(textResponse: string | Error) {
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        if (textResponse instanceof Error) throw textResponse;
        return { content: [{ type: 'text', text: textResponse }] };
      }),
    },
  };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('classifyByVlm', () => {
  it('returns a clean PascalCase classification on happy path', async () => {
    const client = mkClient('ProductCard');
    const result = await classifyByVlm({ html: '<div/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('ProductCard');
  });

  it('trims whitespace around the response', async () => {
    const client = mkClient('  PrimaryButton \n');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('PrimaryButton');
  });

  it('returns Unknown when response is lowercase / non-PascalCase', async () => {
    const client = mkClient('button');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response has spaces (multi-word)', async () => {
    const client = mkClient('Primary Button');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response is empty', async () => {
    const client = mkClient('');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response is > 40 chars', async () => {
    const client = mkClient('A'.repeat(41));
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown on network error', async () => {
    const client = mkClient(new Error('network'));
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('truncates outerHTML in the request to ~500 chars', async () => {
    const client = mkClient('Button');
    const longHtml = 'a'.repeat(2000);
    await classifyByVlm({ html: longHtml, screenshotCrop: PNG, client: client as any });
    const call = client.messages.create.mock.calls[0][0];
    const textPart = call.messages[0].content.find((p: any) => p.type === 'text');
    expect(textPart.text.length).toBeLessThan(1000);
    expect(textPart.text).toContain('a'.repeat(100)); // still has a useful chunk
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/vlm-classifier.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/vlm-classifier.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ComponentVlmClassifier');

const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const MAX_NAME_LENGTH = 40;
const HTML_TRUNCATE_AT = 500;

const PROMPT = (html: string) => `You are classifying a single UI component. Below is its outerHTML and a cropped screenshot of where it renders on the page.

HTML:
${html}

Reply with a single PascalCase component name. Prefer common names (Button, Card, Modal, TextInput). For custom design-system components, use the most descriptive name (e.g., 'ProductCard', 'PrimaryButton'). One word, PascalCase, no explanation.`;

export interface ClassifyByVlmOptions {
  html: string;
  screenshotCrop: Buffer;
  client?: Anthropic;
  model?: string;
}

/**
 * Asks Claude Vision for a PascalCase component name. Returns the validated
 * name on success, or 'Unknown' on validation failure, malformed response,
 * or network error. Never throws.
 */
export async function classifyByVlm(opts: ClassifyByVlmOptions): Promise<string> {
  const client = opts.client ?? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const model = opts.model ?? 'claude-opus-4-6';
  const html = opts.html.length > HTML_TRUNCATE_AT ? `${opts.html.slice(0, HTML_TRUNCATE_AT)}…` : opts.html;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 32,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshotCrop.toString('base64') } },
          { type: 'text', text: PROMPT(html) },
        ],
      }],
    });

    const block = response.content[0];
    const raw = block && block.type === 'text' ? block.text : '';
    const trimmed = raw.trim();
    if (!trimmed) return 'Unknown';
    if (trimmed.length > MAX_NAME_LENGTH) return 'Unknown';
    if (!NAME_RE.test(trimmed)) return 'Unknown';
    return trimmed;
  } catch (err) {
    logger.warn('VLM classification failed, returning Unknown', { error: String(err) });
    return 'Unknown';
  }
}
```

- [ ] **Step 4: Write `tests/unit/pipelines/component-index/queue.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import type { ComponentIndex } from '../../../../src/pipelines/component-index/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mkStore(initial: ComponentIndex) {
  const state = { value: structuredClone(initial) };
  return {
    state,
    load: vi.fn(async () => structuredClone(state.value)),
    save: vi.fn(async (_: string, idx: ComponentIndex) => { state.value = structuredClone(idx); return true; }),
  };
}

describe('ClassificationQueue', () => {
  it('enqueue stores pending work keyed by signature', () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 10, h: 10 } });
    expect(q.size()).toBe(1);
  });

  it('enqueue deduplicates the same signature for the same origin', () => {
    const q = new ClassificationQueue();
    const item = { origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 10, h: 10 } };
    q.enqueue(item);
    q.enqueue(item);
    expect(q.size()).toBe(1);
  });

  it('drainOnce classifies each pending item and persists via store', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<button/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'CustomButton');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({
      classifier,
      screenshotProvider: screenshot,
      store: store as any,
    });

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedIndex: ComponentIndex = store.save.mock.calls[0][1];
    expect(savedIndex.entries['aaaa']?.classification).toBe('CustomButton');
    expect(savedIndex.entries['aaaa']?.classificationSource).toBe('vlm');
    expect(q.size()).toBe(0);
  });

  it('drainOnce persists Unknown when classifier returns Unknown (terminal)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'Unknown');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][1].entries['aaaa']?.classification).toBe('Unknown');
  });

  it('drainOnce groups multiple items by origin (one load+save per origin)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<a/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });
    q.enqueue({ origin: 'https://x', signature: 'bbbb', html: '<b/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'Tag');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(classifier).toHaveBeenCalledTimes(2);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('drainOnce is idempotent when there is no pending work', async () => {
    const q = new ClassificationQueue();
    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'X');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });
    expect(classifier).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('drainOnce continues past a classifier error (logs and skips)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<a/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });
    q.enqueue({ origin: 'https://x', signature: 'bbbb', html: '<b/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => 'GoodOne');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(classifier).toHaveBeenCalledTimes(2);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['bbbb']?.classification).toBe('GoodOne');
    expect(saved.entries['aaaa']).toBeUndefined();
  });
});
```

- [ ] **Step 5: Create `src/pipelines/component-index/queue.ts`**

```typescript
import sharp from 'sharp';
import { createLogger } from '../../utils/logger.js';
import type { ComponentIndexStore } from './store.js';
import type { IndexedComponent } from './types.js';

const logger = createLogger('ComponentClassificationQueue');

export interface PendingClassification {
  origin: string;
  signature: string;
  html: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export type VlmClassifierFn = (args: { html: string; screenshotCrop: Buffer }) => Promise<string>;

export interface DrainOptions {
  classifier: VlmClassifierFn;
  screenshotProvider: () => Promise<Buffer | null>;
  store: ComponentIndexStore;
}

export class ClassificationQueue {
  private pending = new Map<string, PendingClassification>();

  size(): number {
    return this.pending.size;
  }

  enqueue(item: PendingClassification): void {
    const key = `${item.origin}|${item.signature}`;
    if (!this.pending.has(key)) this.pending.set(key, item);
  }

  /**
   * Drain all pending classifications. For each item: fetch the page
   * screenshot, crop to the bbox, classify via VLM, persist to the store
   * grouped by origin (one load+save per origin).
   *
   * Never throws. Per-item errors are logged and skipped.
   */
  async drainOnce(opts: DrainOptions): Promise<void> {
    if (this.pending.size === 0) return;

    const items = Array.from(this.pending.values());
    this.pending.clear();

    // Group by origin so we do one load+save per origin.
    const byOrigin = new Map<string, PendingClassification[]>();
    for (const item of items) {
      const list = byOrigin.get(item.origin);
      if (list) list.push(item);
      else byOrigin.set(item.origin, [item]);
    }

    const screenshot = await opts.screenshotProvider().catch((err) => {
      logger.warn('Screenshot provider failed during drain', { error: String(err) });
      return null;
    });
    if (!screenshot) return;

    for (const [origin, originItems] of byOrigin) {
      const index = await opts.store.load(origin);
      const now = new Date().toISOString();
      let mutated = false;

      for (const item of originItems) {
        try {
          const crop = await cropToBbox(screenshot, item.bbox);
          const classification = await opts.classifier({ html: item.html, screenshotCrop: crop });
          const existing = index.entries[item.signature];
          const entry: IndexedComponent = existing ?? {
            signature: item.signature,
            classification,
            classificationSource: 'vlm',
            firstSeen: now,
            lastSeen: now,
            occurrences: 1,
            domSample: item.html.slice(0, 500),
            source: 'first-traversal',
          };
          if (existing) {
            entry.classification = classification;
            entry.classificationSource = 'vlm';
            entry.lastSeen = now;
          }
          index.entries[item.signature] = entry;
          mutated = true;
        } catch (err) {
          logger.warn('Per-item classification failed, skipping', { signature: item.signature, error: String(err) });
        }
      }

      if (mutated) await opts.store.save(origin, index);
    }
  }
}

async function cropToBbox(png: Buffer, bbox: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  // sharp wants non-negative integer coordinates and width/height ≥ 1.
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.max(1, Math.round(bbox.w));
  const height = Math.max(1, Math.round(bbox.h));
  return sharp(png).extract({ left, top, width, height }).png().toBuffer();
}
```

- [ ] **Step 6: Run both test files — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/vlm-classifier.test.ts tests/unit/pipelines/component-index/queue.test.ts
```
Expected: 8 + 7 = 15 passing.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/vlm-classifier.ts src/pipelines/component-index/queue.ts tests/unit/pipelines/component-index/vlm-classifier.test.ts tests/unit/pipelines/component-index/queue.test.ts
git commit -m "feat(component-index): VLM classifier + classification queue with idle drain"
```

---

## Task 7: `matcher.ts` — orchestrate cache + rules + queue

**Files:**
- Create: `src/pipelines/component-index/matcher.ts`
- Create: `tests/unit/pipelines/component-index/matcher.test.ts`

`Matcher.lookup(...)` is the read path that combines all three tiers:

1. If the signature is in the cached index → return the cached classification
2. Else run `classifyByRules(node)`:
   - On hit: persist immediately, return `{name: cls, source: 'rules', signature}`
   - On miss: enqueue VLM work, return `{name: null, status: 'pending', signature}`

The matcher loads the index once per `run()` (cached in-memory across the loop) and persists rule hits via the same write lock the store provides.

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/matcher.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Matcher } from '../../../../src/pipelines/component-index/matcher.js';
import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import type { ComponentIndex, IndexedComponent } from '../../../../src/pipelines/component-index/types.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: p.attributes ?? {},
    states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    children: p.children ?? [],
    parent: undefined,
  };
}

function mkEntry(sig: string, classification: string, source: 'rules' | 'vlm' = 'rules'): IndexedComponent {
  return {
    signature: sig, classification, classificationSource: source,
    firstSeen: '2026-05-14T00:00:00Z', lastSeen: '2026-05-14T00:00:00Z',
    occurrences: 1, domSample: '', source: 'first-traversal',
  };
}

function mkStore(initial: ComponentIndex) {
  const state = { value: structuredClone(initial) };
  return {
    state,
    load: vi.fn(async () => structuredClone(state.value)),
    save: vi.fn(async (_: string, idx: ComponentIndex) => { state.value = structuredClone(idx); return true; }),
    pathFor: vi.fn(() => '/tmp/x.json'),
  };
}

describe('Matcher.lookup', () => {
  const origin = 'https://app.example.com';

  it('returns cached classification on hit', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': mkEntry('01234567', 'Button') } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'button' }),
      signature: '01234567',
      origin,
    });
    expect(result).toEqual({ name: 'Button', source: 'rules', signature: '01234567' });
    expect(queue.size()).toBe(0);
  });

  it('rules-classifiable miss queues a persist and returns rules result', async () => {
    const store = mkStore({ version: 1, origin, entries: {} });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'button' }),
      signature: '01234567',
      origin,
    });
    expect(result).toEqual({ name: 'Button', source: 'rules', signature: '01234567' });
    await m.endRun(origin);
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['01234567'].classification).toBe('Button');
    expect(saved.entries['01234567'].classificationSource).toBe('rules');
    expect(queue.size()).toBe(0);
  });

  it('non-rules miss returns pending and enqueues to VLM', async () => {
    const store = mkStore({ version: 1, origin, entries: {} });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'div', attributes: { class: 'mystery' }, children: ['x'] }),
      signature: 'aaaa1111',
      origin,
    });
    expect(result).toEqual({ name: null, status: 'pending', signature: 'aaaa1111' });
    expect(queue.size()).toBe(1);
    await m.endRun(origin);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('increments occurrences + lastSeen on cache hits during endRun', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': { ...mkEntry('01234567', 'Button'), occurrences: 1, lastSeen: '2020-01-01T00:00:00Z' } } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    m.lookup({ node: mkNode({ id: 'a', tag: 'button' }), signature: '01234567', origin });
    m.lookup({ node: mkNode({ id: 'b', tag: 'button' }), signature: '01234567', origin });
    await m.endRun(origin);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['01234567'].occurrences).toBe(3);
    expect(saved.entries['01234567'].lastSeen).not.toBe('2020-01-01T00:00:00Z');
  });

  it('hit/miss counters track index hit rate for the current run', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': mkEntry('01234567', 'Button') } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    m.lookup({ node: mkNode({ id: 'a', tag: 'button' }), signature: '01234567', origin });        // hit
    m.lookup({ node: mkNode({ id: 'b', tag: 'button' }), signature: 'newnewxx', origin });         // miss (rules)
    m.lookup({ node: mkNode({ id: 'c', tag: 'div', attributes: { class: 'x' }, children: ['z'] }), signature: 'unknownx', origin }); // miss (vlm)
    expect(m.runStats()).toEqual({ hits: 1, misses: 2 });
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/matcher.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/matcher.ts`**

```typescript
import { classifyByRules } from './classifier.js';
import type { ClassificationQueue } from './queue.js';
import type { ComponentIndexStore } from './store.js';
import type { ComponentField, ComponentIndex, IndexedComponent } from './types.js';
import type { StructuralNode } from '../../types/index.js';

export interface MatcherOptions {
  store: ComponentIndexStore;
  queue: ClassificationQueue;
}

export interface LookupArgs {
  node: StructuralNode;
  signature: string;
  origin: string;
}

interface RunState {
  origin: string;
  index: ComponentIndex;
  dirty: boolean;
  hits: number;
  misses: number;
}

/**
 * Read path for the component index.
 *
 * Lifecycle: caller invokes beginRun(origin) once per traversal, calls
 * lookup(...) for every qualifying node, then endRun(origin) to flush any
 * mutations to disk. Stats (hits/misses) are exposed via runStats() between
 * begin/end.
 */
export class Matcher {
  private store: ComponentIndexStore;
  private queue: ClassificationQueue;
  private run: RunState | null = null;

  constructor(opts: MatcherOptions) {
    this.store = opts.store;
    this.queue = opts.queue;
  }

  async beginRun(origin: string): Promise<void> {
    const index = await this.store.load(origin);
    this.run = { origin, index, dirty: false, hits: 0, misses: 0 };
  }

  lookup(args: LookupArgs): ComponentField {
    if (!this.run) throw new Error('Matcher.lookup called outside of beginRun/endRun');
    const { node, signature, origin } = args;
    if (this.run.origin !== origin) throw new Error(`Matcher origin mismatch: run=${this.run.origin}, lookup=${origin}`);

    const now = new Date().toISOString();
    const cached = this.run.index.entries[signature];

    if (cached) {
      cached.lastSeen = now;
      cached.occurrences += 1;
      this.run.dirty = true;
      this.run.hits += 1;
      return { name: cached.classification, source: classificationSourceToField(cached.classificationSource), signature };
    }

    this.run.misses += 1;

    const ruleHit = classifyByRules(node);
    if (ruleHit !== null) {
      const entry: IndexedComponent = {
        signature,
        classification: ruleHit,
        classificationSource: 'rules',
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
        domSample: '', // domSample is rules-tier; left empty (no outerHTML serializer in the structural pipeline today)
        source: 'first-traversal',
      };
      this.run.index.entries[signature] = entry;
      this.run.dirty = true;
      return { name: ruleHit, source: 'rules', signature };
    }

    // VLM tier: enqueue for out-of-band classification. No store mutation now.
    this.queue.enqueue({
      origin,
      signature,
      html: '', // outerHTML not yet plumbed from the structural extractor; queue holds an empty html (acceptable — the VLM gets the screenshot crop, which carries the visual)
      bbox: { x: node.boundingBox.x, y: node.boundingBox.y, w: node.boundingBox.width, h: node.boundingBox.height },
    });
    return { name: null, status: 'pending', signature };
  }

  runStats(): { hits: number; misses: number } {
    if (!this.run) return { hits: 0, misses: 0 };
    return { hits: this.run.hits, misses: this.run.misses };
  }

  async endRun(origin: string): Promise<void> {
    if (!this.run) return;
    if (this.run.origin !== origin) throw new Error(`Matcher origin mismatch on endRun`);
    const { dirty, index } = this.run;
    this.run = null;
    if (dirty) await this.store.save(origin, index);
  }
}

function classificationSourceToField(s: IndexedComponent['classificationSource']): 'rules' | 'vlm' {
  return s;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/matcher.test.ts
```
Expected: 5 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/matcher.ts tests/unit/pipelines/component-index/matcher.test.ts
git commit -m "feat(component-index): Matcher — cache + rules + queue orchestration"
```

---

## Task 8: `indexer.ts` — DOM walk producing the component map

**Files:**
- Create: `src/pipelines/component-index/indexer.ts`
- Create: `tests/unit/pipelines/component-index/indexer.test.ts`

`Indexer.run(structural, context)` walks the structural-pipeline output, asks the matcher for each qualifying node, and returns `Map<nodeId, ComponentField>` ready for the fusion engine to attach.

- [ ] **Step 1: Write `tests/unit/pipelines/component-index/indexer.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer } from '../../../../src/pipelines/component-index/indexer.js';
import { Matcher } from '../../../../src/pipelines/component-index/matcher.js';
import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import { ComponentIndexStore } from '../../../../src/pipelines/component-index/store.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id, tag: p.tag, role: p.role,
    name: undefined, text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: p.attributes ?? {},
    states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    children: p.children ?? [],
    parent: undefined,
  };
}

describe('Indexer.run', () => {
  it('produces a component map keyed by node id', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      const nodes: StructuralNode[] = [
        mkNode({ id: 'b1', tag: 'button' }),
        mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }),
        mkNode({ id: 'span1', tag: 'span', text: 'hi' }), // does not qualify
      ];

      const map = await indexer.run(nodes, { origin: 'https://x' });

      expect(map.size).toBe(2);
      expect(map.get('b1')).toEqual({ name: 'Button', source: 'rules', signature: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(map.get('a1')).toEqual({ name: 'Link', source: 'rules', signature: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(map.get('span1')).toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('attaches pending field for non-rules misses and enqueues VLM work', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      const nodes: StructuralNode[] = [
        mkNode({ id: 'card', tag: 'div', attributes: { class: 'mystery' }, children: ['inner'], boundingBox: { x: 0, y: 0, width: 200, height: 200 } }),
        mkNode({ id: 'inner', tag: 'p', text: 'content' }),
      ];

      const map = await indexer.run(nodes, { origin: 'https://x' });

      const entry = map.get('card');
      expect(entry).toBeDefined();
      expect(entry!.name).toBeNull();
      expect((entry as any).status).toBe('pending');
      expect(queue.size()).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('exposes runStats() (hits, misses) after a run', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      // Seed the index by running once
      await indexer.run([mkNode({ id: 'b1', tag: 'button' })], { origin: 'https://x' });

      // Re-run — should hit the cache for the same signature
      const stats = await indexer.runAndGetStats([
        mkNode({ id: 'b2', tag: 'button' }),
        mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }),
      ], { origin: 'https://x' });

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('persists rules-tier classifications after a run', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      await indexer.run([mkNode({ id: 'b1', tag: 'button' })], { origin: 'https://x' });

      const reloaded = await store.load('https://x');
      const entries = Object.values(reloaded.entries);
      expect(entries).toHaveLength(1);
      expect(entries[0].classification).toBe('Button');
      expect(entries[0].classificationSource).toBe('rules');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/indexer.test.ts
```

- [ ] **Step 3: Create `src/pipelines/component-index/indexer.ts`**

```typescript
import { computeSignature } from './fingerprint.js';
import { qualifies } from './heuristic.js';
import type { Matcher } from './matcher.js';
import type { ComponentField } from './types.js';
import type { StructuralNode } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ComponentIndexer');

export interface IndexerOptions {
  matcher: Matcher;
}

export interface IndexerRunContext {
  origin: string;
}

export class Indexer {
  private matcher: Matcher;

  constructor(opts: IndexerOptions) {
    this.matcher = opts.matcher;
  }

  /**
   * Walk the structural-pipeline output. For each qualifying node, compute
   * its signature and consult the matcher. Returns a Map<nodeId, ComponentField>
   * the fusion serializer can attach onto SceneNode entries.
   */
  async run(nodes: StructuralNode[], context: IndexerRunContext): Promise<Map<string, ComponentField>> {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const result = new Map<string, ComponentField>();

    await this.matcher.beginRun(context.origin);
    try {
      for (const node of nodes) {
        if (!qualifies(node)) continue;
        const signature = computeSignature(node, nodeMap);
        const field = this.matcher.lookup({ node, signature, origin: context.origin });
        result.set(node.id, field);
      }
    } finally {
      await this.matcher.endRun(context.origin);
    }

    logger.info('Component-index run complete', {
      origin: context.origin,
      totalNodes: nodes.length,
      qualified: result.size,
    });
    return result;
  }

  async runAndGetStats(nodes: StructuralNode[], context: IndexerRunContext): Promise<{ map: Map<string, ComponentField>; hits: number; misses: number }> {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const map = new Map<string, ComponentField>();
    await this.matcher.beginRun(context.origin);
    try {
      for (const node of nodes) {
        if (!qualifies(node)) continue;
        const signature = computeSignature(node, nodeMap);
        const field = this.matcher.lookup({ node, signature, origin: context.origin });
        map.set(node.id, field);
      }
      const stats = this.matcher.runStats();
      return { map, ...stats };
    } finally {
      await this.matcher.endRun(context.origin);
    }
  }
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/component-index/indexer.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/pipelines/component-index/indexer.ts tests/unit/pipelines/component-index/indexer.test.ts
git commit -m "feat(component-index): Indexer — DOM walk + matcher orchestration"
```

---

## Task 9: Fusion integration — attach `component` on emitted scene-graph nodes

**Files:**
- Modify: `src/pipelines/fusion/index.ts`
- Modify: `src/pipelines/fusion/node-builder.ts`
- Modify: `tests/unit/pipelines/fusion/node-builder.test.ts` (or whichever existing fusion test file covers buildSceneNode — create new test file if none exists)

Extend `FusionEngine.fuse()` to accept an optional `componentMap`. Thread it through to `buildSceneNode`, which attaches the field on the emitted `SceneNode` if a matching entry exists. No mutation of upstream `StructuralNode`s.

- [ ] **Step 1: Check what fusion unit tests already exist**

```bash
ls tests/unit/pipelines/fusion/
```
Expected: at least one `.test.ts` file. If `node-builder.test.ts` exists, modify it. If only `fusion.test.ts` exists, modify that. If neither covers `buildSceneNode`, create `tests/unit/pipelines/fusion/component-attachment.test.ts` with the new assertions only.

- [ ] **Step 2: Write or extend the test for `component` field attachment**

Add the following describe block to the chosen file (paths assume `tests/unit/pipelines/fusion/component-attachment.test.ts` — adjust imports if you placed it elsewhere):

```typescript
import { describe, it, expect } from 'vitest';
import { FusionEngine } from '../../../../src/pipelines/fusion/index.js';
import type { StructuralNode, VisualElement } from '../../../../src/types/index.js';
import type { ComponentField } from '../../../../src/pipelines/component-index/types.js';

function mkStructural(id: string, tag: string): StructuralNode {
  return {
    id, tag, role: undefined, name: undefined, text: undefined,
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: {},
    states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
    children: [], parent: undefined,
  };
}

const context = {
  url: 'https://x',
  viewport: { width: 1280, height: 720 },
  scrollPosition: { x: 0, y: 0 },
};

describe('FusionEngine.fuse with componentMap', () => {
  it('attaches component field when map has an entry for the structural id', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const visual: VisualElement[] = [];
    const map = new Map<string, ComponentField>([
      ['dom-1', { name: 'Button', source: 'rules', signature: '0123456789abcdef' }],
    ]);
    const graph = fusion.fuse(visual, structural, context, map);
    expect(graph.nodes[0].component).toEqual({ name: 'Button', source: 'rules', signature: '0123456789abcdef' });
  });

  it('attaches pending variant', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'div')];
    const map = new Map<string, ComponentField>([
      ['dom-1', { name: null, status: 'pending', signature: 'aaaaaaaaaaaaaaaa' }],
    ]);
    const graph = fusion.fuse([], structural, context, map);
    expect(graph.nodes[0].component).toEqual({ name: null, status: 'pending', signature: 'aaaaaaaaaaaaaaaa' });
  });

  it('omits component field when map has no entry for the id', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const graph = fusion.fuse([], structural, context, new Map());
    expect(graph.nodes[0].component).toBeUndefined();
  });

  it('works when componentMap is omitted entirely (backwards-compatible)', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const graph = fusion.fuse([], structural, context);
    expect(graph.nodes[0].component).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests — should FAIL (`fuse` doesn't accept 4th arg yet)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/fusion/
```
Expected: type errors or "Expected 3 arguments, got 4."

- [ ] **Step 4: Modify `src/pipelines/fusion/index.ts`**

Find:
```typescript
import { matchElements } from './matcher.js';
import { buildSceneNode } from './node-builder.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FusionEngine');

export interface FusionContext {
  url: string;
  viewport: Viewport;
  scrollPosition: ScrollPosition;
}

export class FusionEngine {
  fuse(
    visual: VisualElement[],
    structural: StructuralNode[],
    context: FusionContext,
  ): SceneGraph {
    logger.info('Fusing visual + structural', { visual: visual.length, structural: structural.length });

    const pairs = matchElements(visual, structural);
    const nodes = pairs.map(pair => buildSceneNode(pair, context.viewport));
```

Replace with:
```typescript
import { matchElements } from './matcher.js';
import { buildSceneNode } from './node-builder.js';
import { createLogger } from '../../utils/logger.js';
import type { ComponentField } from '../component-index/types.js';

const logger = createLogger('FusionEngine');

export interface FusionContext {
  url: string;
  viewport: Viewport;
  scrollPosition: ScrollPosition;
}

export class FusionEngine {
  fuse(
    visual: VisualElement[],
    structural: StructuralNode[],
    context: FusionContext,
    componentMap?: ReadonlyMap<string, ComponentField>,
  ): SceneGraph {
    logger.info('Fusing visual + structural', { visual: visual.length, structural: structural.length, components: componentMap?.size ?? 0 });

    const pairs = matchElements(visual, structural);
    const nodes = pairs.map(pair => buildSceneNode(pair, context.viewport, componentMap));
```

- [ ] **Step 5: Modify `src/pipelines/fusion/node-builder.ts`**

Find the imports + function signature:
```typescript
import type {
  SceneNode, VisualElement, StructuralNode,
  InteractionType, ViewportPosition, Viewport, BoundingBox,
} from '../../types/index.js';
import type { MatchPair } from './matcher.js';
```

Add after the existing imports:
```typescript
import type { ComponentField } from '../component-index/types.js';
```

Find:
```typescript
export function buildSceneNode(pair: MatchPair, viewport: Viewport): SceneNode {
  const { visualElement: v, structuralNode: s, fusionMethod } = pair;
  const bb = s?.boundingBox ?? v!.boundingBox;
  const id = s?.id ?? v!.id;

  return {
```

Replace with:
```typescript
export function buildSceneNode(
  pair: MatchPair,
  viewport: Viewport,
  componentMap?: ReadonlyMap<string, ComponentField>,
): SceneNode {
  const { visualElement: v, structuralNode: s, fusionMethod } = pair;
  const bb = s?.boundingBox ?? v!.boundingBox;
  const id = s?.id ?? v!.id;
  const component = componentMap?.get(id);

  return {
```

And in the returned object literal, find the last field:
```typescript
    fusionMethod,
  };
}
```

Replace with:
```typescript
    fusionMethod,
    ...(component ? { component } : {}),
  };
}
```

- [ ] **Step 6: Run fusion tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/fusion/
```
Expected: previously-passing fusion tests still pass + 4 new ones.

- [ ] **Step 7: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/pipelines/fusion/index.ts src/pipelines/fusion/node-builder.ts tests/unit/pipelines/fusion/
git commit -m "feat(fusion): accept optional componentMap and attach SceneNode.component"
```

---

## Task 10: MCP wiring — `get_component_index` tool + server integration

**Files:**
- Create: `src/mcp/tools/get-component-index.ts`
- Modify: `src/mcp/server.ts`

Two things in this task:

1. **`get_component_index` MCP tool** — loads the index for an origin and returns stats + entries
2. **Wire the indexer + queue into the MCP server's capture loop** — instantiate `Indexer`, `Matcher`, `Queue`, `Store` at server construction; in `captureGraph`, run the indexer between `extractStructure` and `fuse`; pass the resulting map to `fuse`; after each request handler returns, drain the queue once (fire-and-forget) using the runtime's screenshot capability

- [ ] **Step 1: Write the new tool file `src/mcp/tools/get-component-index.ts`**

```typescript
import type { ComponentIndexStore } from '../../pipelines/component-index/store.js';
import type { IndexedComponent } from '../../pipelines/component-index/types.js';

export interface ComponentIndexStats {
  totalEntries: number;
  classifiedByRules: number;
  classifiedByVlm: number;
  pendingVlm: number;
  totalObservations: number;
  indexHitRate: number;
}

export interface ComponentIndexResponse {
  origin: string;
  entries: IndexedComponent[];
  stats: ComponentIndexStats;
}

export interface GetComponentIndexArgs {
  origin?: string;
}

export interface GetComponentIndexTool {
  readonly name: 'get_component_index';
  readonly description: string;
  readonly inputSchema: {
    type: 'object';
    properties: { origin: { type: 'string'; description: string } };
    required: never[];
  };
  handler(args: GetComponentIndexArgs): Promise<ComponentIndexResponse>;
}

export interface MakeGetComponentIndexToolOptions {
  store: ComponentIndexStore;
  currentOrigin: () => string;
}

export const makeGetComponentIndexTool = (opts: MakeGetComponentIndexToolOptions): GetComponentIndexTool => ({
  name: 'get_component_index',
  description:
    'Returns the cached component index for the given origin (defaults to the current page origin). Each entry maps a structural signature to a classification (e.g. "Button", "ProductCard") with provenance ("rules" or "vlm"). Use the stats.indexHitRate to track cost reduction: on a familiar app it should approach 1.0.',
  inputSchema: {
    type: 'object',
    properties: { origin: { type: 'string', description: 'Origin URL (defaults to the current page origin)' } },
    required: [],
  },
  async handler(args) {
    const origin = args.origin ?? opts.currentOrigin();
    const index = await opts.store.load(origin);
    const entries = Object.values(index.entries);
    const stats = computeStats(entries);
    return { origin, entries, stats };
  },
});

function computeStats(entries: IndexedComponent[]): ComponentIndexStats {
  let classifiedByRules = 0;
  let classifiedByVlm = 0;
  let totalObservations = 0;
  for (const e of entries) {
    if (e.classificationSource === 'rules') classifiedByRules += 1;
    else if (e.classificationSource === 'vlm') classifiedByVlm += 1;
    totalObservations += e.occurrences;
  }
  const totalEntries = entries.length;
  // pendingVlm represents pending-this-instant — the store does not persist
  // pending stubs (per spec "cold-path persistence semantics"), so it is
  // always 0 in the persisted index. The field is kept for forward compat.
  const pendingVlm = 0;
  // indexHitRate: observations beyond the first per signature divided by total.
  // First-encounter = 1 observation per signature is a "miss" for hit-rate
  // accounting; subsequent observations of the same signature are "hits."
  const indexHitRate = totalObservations === 0
    ? 0
    : Math.max(0, totalObservations - totalEntries) / totalObservations;
  return { totalEntries, classifiedByRules, classifiedByVlm, pendingVlm, totalObservations, indexHitRate };
}
```

- [ ] **Step 2: Add a unit test for the tool**

Create `tests/unit/mcp/get-component-index.test.ts` (note: a flat file under `tests/unit/mcp/`, not a `tools/` subdirectory — the existing pattern keeps tool tests flat):

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentIndexStore } from '../../../../src/pipelines/component-index/store.js';
import { makeGetComponentIndexTool } from '../../../../src/mcp/tools/get-component-index.js';
import type { ComponentIndex, IndexedComponent } from '../../../../src/pipelines/component-index/types.js';

function mkEntry(sig: string, source: 'rules' | 'vlm', occurrences: number): IndexedComponent {
  return {
    signature: sig, classification: 'X', classificationSource: source,
    firstSeen: '2026-05-14T00:00:00Z', lastSeen: '2026-05-14T00:00:00Z',
    occurrences, domSample: '', source: 'first-traversal',
  };
}

describe('get_component_index tool', () => {
  it('returns empty stats for an unseen origin', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({});
      expect(result.entries).toEqual([]);
      expect(result.stats.totalEntries).toBe(0);
      expect(result.stats.indexHitRate).toBe(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('computes stats correctly with a mixed index', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const initial: ComponentIndex = {
        version: 1, origin: 'https://x',
        entries: {
          'aaaa': mkEntry('aaaa', 'rules', 5),
          'bbbb': mkEntry('bbbb', 'vlm', 3),
          'cccc': mkEntry('cccc', 'rules', 1),
        },
      };
      await store.save('https://x', initial);

      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({});

      expect(result.stats.totalEntries).toBe(3);
      expect(result.stats.classifiedByRules).toBe(2);
      expect(result.stats.classifiedByVlm).toBe(1);
      expect(result.stats.totalObservations).toBe(9);
      // Hit-rate: (9 total observations - 3 first-encounters) / 9 = 0.666...
      expect(result.stats.indexHitRate).toBeCloseTo(6 / 9, 5);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('honors an explicit origin argument over the current-origin default', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      await store.save('https://other', { version: 1, origin: 'https://other', entries: { 'zzzz': mkEntry('zzzz', 'rules', 2) } });
      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({ origin: 'https://other' });
      expect(result.origin).toBe('https://other');
      expect(result.stats.totalEntries).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run the tool test — should FAIL (module not found)**

Then implement Step 1's file. Then re-run:

```bash
pnpm exec vitest run --reporter=verbose tests/unit/mcp/get-component-index.test.ts
```
Expected: 3 passing.

- [ ] **Step 4: Modify `src/mcp/server.ts` to wire the indexer + register the tool**

Add to the imports block (after the existing imports):

```typescript
import { ComponentIndexStore } from '../pipelines/component-index/store.js';
import { ClassificationQueue } from '../pipelines/component-index/queue.js';
import { Matcher } from '../pipelines/component-index/matcher.js';
import { Indexer } from '../pipelines/component-index/indexer.js';
import { classifyByVlm } from '../pipelines/component-index/vlm-classifier.js';
import { makeGetComponentIndexTool } from './tools/get-component-index.js';
```

Add to `TOOL_NAMES` (between `'get_timeline'` and the closing `]`):
```typescript
  'get_component_index',
```

Inside `createServer`, after the existing `const visual = config.visual ? ... : null;` line and before `const eventStream = ...`:

```typescript
  const componentStore = new ComponentIndexStore();
  const componentQueue = new ClassificationQueue();
  const componentMatcher = new Matcher({ store: componentStore, queue: componentQueue });
  const componentIndexer = new Indexer({ matcher: componentMatcher });
```

Inside `captureGraph`, replace the existing body:

```typescript
  async function captureGraph(includeVisual: boolean | AnalysisDepth = false) {
    const shouldCapture = includeVisual !== false && visual;
    const [screenshot, nodes] = await Promise.all([
      shouldCapture ? runtime.screenshot() : Promise.resolve(null),
      structural.extractStructure(runtime.getPage()),
    ]);
    let visualElements = screenshot && visual ? await visual.detectElements(screenshot) : [];
    if (screenshot && visual && typeof includeVisual === 'string') {
      const result = await visual.analyze(screenshot, includeVisual);
      visualElements = result.elements;
    }
    return fusion.fuse(visualElements, nodes, {
      url: runtime.currentUrl(),
      viewport: { width: Config.browser.viewportWidth, height: Config.browser.viewportHeight },
      scrollPosition: { x: 0, y: 0 },
    });
  }
```

With:

```typescript
  async function captureGraph(includeVisual: boolean | AnalysisDepth = false) {
    const shouldCapture = includeVisual !== false && visual;
    const [screenshot, nodes] = await Promise.all([
      shouldCapture ? runtime.screenshot() : Promise.resolve(null),
      structural.extractStructure(runtime.getPage()),
    ]);
    let visualElements = screenshot && visual ? await visual.detectElements(screenshot) : [];
    if (screenshot && visual && typeof includeVisual === 'string') {
      const result = await visual.analyze(screenshot, includeVisual);
      visualElements = result.elements;
    }
    const origin = originOf(runtime.currentUrl());
    const componentMap = await componentIndexer.run(nodes, { origin });
    return fusion.fuse(visualElements, nodes, {
      url: runtime.currentUrl(),
      viewport: { width: Config.browser.viewportWidth, height: Config.browser.viewportHeight },
      scrollPosition: { x: 0, y: 0 },
    }, componentMap);
  }

  function originOf(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  }

  function scheduleIdleDrain(): void {
    if (componentQueue.size() === 0) return;
    void componentQueue.drainOnce({
      classifier: async ({ html, screenshotCrop }) => classifyByVlm({ html, screenshotCrop }),
      screenshotProvider: () => runtime.screenshot().catch(() => null),
      store: componentStore,
    });
  }
```

Register the new tool — find the existing `server.registerTool('get_timeline', ...)` block and add after it (before the `return server;`):

```typescript
  // Tool 14: get_component_index
  const componentIndexTool = makeGetComponentIndexTool({
    store: componentStore,
    currentOrigin: () => originOf(runtime.currentUrl()),
  });
  server.registerTool(
    componentIndexTool.name,
    {
      title: 'Get Component Index',
      description: componentIndexTool.description,
      inputSchema: z.object({
        origin: z.string().optional().describe('Origin URL (defaults to the current page origin)'),
      }),
    },
    async ({ origin }) => {
      const result = await componentIndexTool.handler({ origin });
      scheduleIdleDrain();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
```

Then add `scheduleIdleDrain()` calls to the bottom of every other tool handler that currently does scene-graph capture or any browser work — at minimum:

- `navigate` handler — after the `return { content: ... }` would normally execute, schedule the drain. Idiom: `const text = ...; scheduleIdleDrain(); return { content: [{ type: 'text' as const, text }] };`
- `get_scene` (visual=true branch only — the cached branch has no new misses)
- `act` handler — after `captureGraph()`
- `analyze_visual` handler if it captures a graph (skip if it doesn't)

Pattern: insert `scheduleIdleDrain();` immediately before each `return { content: ... }` in those handlers. Don't `await` it — fire-and-forget.

- [ ] **Step 5: Make sure `get_component_index` is listed in the `TOOL_NAMES` exported constant**

Verify:
```bash
grep "get_component_index" src/mcp/server.ts
```
Expected: appears in both `TOOL_NAMES` and the `registerTool` call.

- [ ] **Step 6: Update `tests/unit/mcp/tools.test.ts` to account for the new tool**

The existing test asserts `expect(TOOL_NAMES).toHaveLength(13)` and lists each known tool. Open `tests/unit/mcp/tools.test.ts` and:

1. Change `toHaveLength(13)` → `toHaveLength(14)`
2. Add an assertion: `expect(TOOL_NAMES).toContain('get_component_index');` inside the appropriate `it('contains ...')` block (or add a new `it('contains get_component_index')`).

- [ ] **Step 7: Run all unit + the MCP smoke test**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/ tests/integration/smoke.test.ts
```
Expected: previously-passing tests still pass, the updated `tools.test.ts` assertion passes (14 tools), and the new `get-component-index.test.ts` passes.

- [ ] **Step 8: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add src/mcp/tools/get-component-index.ts src/mcp/server.ts tests/unit/mcp/
git commit -m "feat(mcp): wire component-index into capture loop + add get_component_index tool"
```

---

## Task 11: Integration test — Playwright two-pass cost-reduction demo

**Files:**
- Create: `tests/integration/component-index/fixtures/five-components.html`
- Create: `tests/integration/component-index/component-index-e2e.test.ts`

End-to-end test against a real Chromium page rendering five named components. Two-pass scenario:

1. **First pass** — fresh index (empty), structural pipeline extracts DOM, indexer asks matcher → rules tier classifies the 3 semantic ones, queue holds the 2 unknown ones. Scene-graph nodes carry `component` fields.
2. **Second pass** — after stubbing the VLM tier to deterministically classify, run the queue drain, then re-traverse. All 5 components now hit the cached entries.

We isolate the index file to a tmp dir via the `UIPE_COMPONENT_INDEX_DIR` env var to keep the test hermetic.

- [ ] **Step 1: Create the HTML fixture**

`tests/integration/component-index/fixtures/five-components.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Five Components</title>
<style>
  body { font-family: system-ui; padding: 24px; }
  .product-card { display: block; padding: 16px; border: 1px solid #ccc; width: 220px; height: 180px; }
  .hero-banner  { display: block; padding: 24px; background: #eef; width: 600px; height: 200px; }
  .product-card h3 { margin: 0 0 8px; }
  button.primary { padding: 8px 16px; }
</style>
</head>
<body>
  <button class="primary" id="b1">Submit</button>
  <input type="text" id="i1" placeholder="Name" />
  <a href="/learn-more" id="a1">Learn more</a>
  <div class="product-card" id="p1">
    <h3>Widget</h3>
    <p>A fine widget.</p>
  </div>
  <div class="hero-banner" id="h1">
    <h1>Big Announcement</h1>
    <p>Read all about it.</p>
  </div>
</body>
</html>
```

- [ ] **Step 2: Write the integration test**

`tests/integration/component-index/component-index-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StructuralPipeline } from '../../../src/pipelines/structural/index.js';
import { ComponentIndexStore } from '../../../src/pipelines/component-index/store.js';
import { ClassificationQueue } from '../../../src/pipelines/component-index/queue.js';
import { Matcher } from '../../../src/pipelines/component-index/matcher.js';
import { Indexer } from '../../../src/pipelines/component-index/indexer.js';

const FIXTURE = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'five-components.html');
const ORIGIN = 'http://localhost-fixture';

describe('Component Index — end-to-end (Playwright)', () => {
  let browser: Browser;
  let page: Page;
  let tmp: string;

  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-e2e-'));
    const html = await readFile(FIXTURE, 'utf8');
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(html, { waitUntil: 'load' });
  });

  afterEach(async () => {
    await page.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('first pass classifies semantic components via rules; second pass hits everything from cache', async () => {
    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    // ─── First pass ──────────────────────────────────────────────────────
    const nodes1 = await structural.extractStructure(page);
    const map1 = await indexer.run(nodes1, { origin: ORIGIN });

    const fields1 = Array.from(map1.values());
    const resolved1 = fields1.filter((f) => f.name !== null);
    const pending1 = fields1.filter((f) => f.name === null);

    // The 3 semantic components (button, input, a[href]) classify via rules.
    expect(resolved1.length).toBeGreaterThanOrEqual(3);
    // Both custom divs (.product-card, .hero-banner) sit in pending.
    expect(pending1.length).toBeGreaterThanOrEqual(2);

    // ─── VLM drain: stub the classifier to return deterministic names ────
    const stubClassifier = vi.fn()
      .mockResolvedValueOnce('ProductCard')
      .mockResolvedValueOnce('HeroBanner');
    const stubScreenshot = vi.fn(async () => page.screenshot({ type: 'png' }));

    await queue.drainOnce({
      classifier: stubClassifier as any,
      screenshotProvider: stubScreenshot,
      store,
    });

    // ─── Second pass ─────────────────────────────────────────────────────
    const nodes2 = await structural.extractStructure(page);
    const { map: map2, hits, misses } = await indexer.runAndGetStats(nodes2, { origin: ORIGIN });

    const fields2 = Array.from(map2.values());
    const resolved2 = fields2.filter((f) => f.name !== null);
    const pending2 = fields2.filter((f) => f.name === null);

    // Every qualifying node hits a cached entry on pass 2.
    expect(pending2).toHaveLength(0);
    expect(resolved2.length).toBe(fields2.length);

    // Hit rate for the second pass should be very high (close to 1.0).
    const hitRate2 = hits / (hits + misses);
    expect(hitRate2).toBeGreaterThanOrEqual(0.95);

    // The previously-pending entries now exist on disk with VLM classifications.
    const index = await store.load(ORIGIN);
    const vlmEntries = Object.values(index.entries).filter((e) => e.classificationSource === 'vlm');
    expect(vlmEntries.map((e) => e.classification).sort()).toEqual(['HeroBanner', 'ProductCard']);
  }, 30_000);

  it('handles a missing screenshot provider gracefully during drain', async () => {
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    queue.enqueue({ origin: ORIGIN, signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const stubClassifier = vi.fn(async () => 'X');
    await queue.drainOnce({
      classifier: stubClassifier as any,
      screenshotProvider: async () => null,
      store,
    });

    // Provider returned null → no classification attempted, no persistence.
    expect(stubClassifier).not.toHaveBeenCalled();
    const index = await store.load(ORIGIN);
    expect(Object.keys(index.entries)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the integration test (scoped — avoid the slow optical-flow integration suite)**

```bash
pnpm exec vitest run --reporter=verbose tests/integration/component-index/
```
Expected: 2 passing within ~30s. If Playwright complains it has no browser, run `pnpm exec playwright install chromium` once.

- [ ] **Step 4: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/component-index/
git commit -m "test(component-index): Playwright e2e two-pass cost-reduction demo"
```

---

## Task 12: Documentation update

**Files:**
- Modify: `/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md` (workspace root, NOT inside the engine repo — see CLAUDE.md carry-forward #7)
- Modify: `/Users/dirkknibbe/uipe/docs/architecture.md` (workspace root)

These two files live at the **outer workspace path** `/Users/dirkknibbe/uipe/docs/`, not inside the `ui-perception-engine/` git repo. They are direct file writes that are not committed via git.

- [ ] **Step 1: Update `/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md`**

Find the sub-project #4 entry. It will currently read something like:
```markdown
### ▶ #4 — Component Index (design system / route graph indexer)
```

Replace the status marker `▶` with `✅`, and replace the body text with a 2-3 sentence summary matching the style of the existing #1, #2, #3 entries:

```markdown
### ✅ #4 — Component Index

Component-indexer pipeline stage between structural and fusion. SHA-256 structural-signature fingerprinting + rules tier (16 ordered rules) for synchronous classification, VLM tier deferred via `ClassificationQueue` and drained on MCP idle. On-disk per-origin index at `~/.uipe/component-index/<slug>.json`. New MCP tool `get_component_index` exposes the index + stats (including `indexHitRate`). Scene-graph nodes carry an optional `component: { name, source, signature }` field. Merged <DATE> (commit `<TBD-fill-in-after-merge>`). **Depends on:** structural pipeline (✓).
```

Update `<DATE>` to the actual merge date and `<TBD-fill-in-after-merge>` to the actual commit hash once available. If running this task before merge, leave the placeholders and update post-merge.

Also update the "Recommended next pick" section if it currently points at #4 — flip it to point at sub-project #7 (Hierarchical loops at fixed rates), now that #4 is shipped and both #4's prerequisites (the structural pipeline) and #7's prerequisites (#1, #2) are all satisfied.

- [ ] **Step 2: Update `/Users/dirkknibbe/uipe/docs/architecture.md`**

Find the "Current implementation" table. The row for sub-project #4 (component index / HD map prior) likely says "Not yet built" or "Design committed; implementation pending". Replace its rightmost column with:

```
Pipeline stage at `src/pipelines/component-index/` between structural and fusion. Tier-1 rules synchronously classify ~16 semantic components; misses queue for out-of-band VLM classification (`ClassificationQueue`, drained on MCP idle). Per-origin disk index at `~/.uipe/component-index/<slug>.json`. `SceneGraphNode.component` field; new `get_component_index` MCP tool with `indexHitRate` stat. Storybook seeding and OmniParser intermediate tier deferred to v2.
```

If the row's structure doesn't permit that exact phrasing, condense to match the column width of neighboring rows while preserving the substantive claims.

- [ ] **Step 3: Verify nothing else broke**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose tests/unit/
```
Expected: no test changes — docs-only edits live outside the repo.

- [ ] **Step 4: No git commit for docs at workspace root (they aren't in a repo)**

Per CLAUDE.md carry-forward #7, those outer-workspace files are not tracked. The task's "deliverable" is the on-disk edit.

There is **no `git commit`** in Task 12; the docs sync is a side effect captured by the session memory note that will be written after merge.

---

## Self-review verification (run this before declaring the plan complete)

- [ ] **Spec coverage check** — every section of the spec maps to at least one task:
  - "Data shapes" → Task 1 (types) + tests in 2-5
  - "Container heuristic" → Task 3
  - "Classification: rules" → Task 4
  - "Classification: VLM" → Task 6
  - "Storage" → Task 5
  - "MCP tool" → Task 10
  - "Edge cases" → spread across tasks (each helper carries the relevant edges)
  - "Testing" → tasks 1-8 (unit) + Task 11 (integration)
  - "Implementation phasing" → tasks 1-11
  - "Docs + roadmap" → Task 12

- [ ] **Naming consistency** — verify the following names appear identically across tasks:
  - Module names: `fingerprint.ts`, `heuristic.ts`, `classifier.ts`, `store.ts`, `vlm-classifier.ts`, `queue.ts`, `matcher.ts`, `indexer.ts`
  - Exports: `computeSignature`, `qualifies`, `classifyByRules`, `ComponentIndexStore`, `classifyByVlm`, `ClassificationQueue`, `Matcher`, `Indexer`
  - Types: `IndexedComponent`, `ComponentIndex`, `ComponentField`, `ClassificationSource`

- [ ] **Run the full unit suite one final time:**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/
```
Expected: ≥ 60 new unit tests across the 9 unit-test files, plus all previously-passing tests still pass.

---

## Definition of done

After Task 12 completes:

- [ ] All component-index unit tests pass: `pnpm exec vitest run tests/unit/pipelines/component-index/`
- [ ] All previously-passing tests still pass: `pnpm exec vitest run tests/unit/`
- [ ] Integration test passes: `pnpm exec vitest run tests/integration/component-index/`
- [ ] Typecheck clean: `pnpm exec tsc --noEmit`
- [ ] Lint clean: `pnpm exec eslint src tests --ext .ts`
- [ ] `~/.uipe/component-index/<slug>.json` appears on disk after running the MCP server against a target app with CSS components
- [ ] `get_component_index` MCP tool returns a sensible `stats` block with non-zero `indexHitRate` on the second pass
- [ ] `SceneGraphNode.component` field appears on emitted scene-graph nodes (visible in `toJSON()` output)
- [ ] `docs/autopilot-program-roadmap.md` (workspace-root) shows #4 as ✅ Shipped
- [ ] `docs/architecture.md` (workspace-root) "Current implementation" table reflects the new capability

## Out of scope (deferred to follow-up tickets/PRs)

These are explicitly NOT part of this plan:

- Storybook seeding adapter (`source: 'storybook'` reserved but unused)
- Route graph indexing (belongs in sub-project #5)
- Embedding-based fingerprinting (option D from brainstorming)
- Cross-origin index sharing / common-library indices
- Index garbage collection / migration / schema versioning beyond `version: 1`
- Agent corrections (`correct_component_classification` tool)
- OmniParser as an intermediate classification tier (tier 1.5)
- Pre-existing `AnimationCollector` `iterations > 1` bug (separate ticket from #3)
- Plumbing `outerHTML` from the structural extractor into VLM classification prompts (current implementation passes empty string; VLM still gets the screenshot crop, which carries most of the signal — refining this is a follow-up if VLM accuracy is poor in real-world testing)
- VLM rate limiting / backpressure (queue grows unboundedly today; add a cap if real traffic surfaces the issue)
