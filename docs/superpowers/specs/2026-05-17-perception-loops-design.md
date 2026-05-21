# Perception Loops — Design

**Date:** 2026-05-17
**Status:** Draft — pending user review
**Roadmap entries:** [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) — sub-projects #7 (Hierarchical loops at fixed rates) and #8 (Anomaly-triggered attention), merged into one v1 sub-project
**Architecture source:** [`docs/architecture.md`](../../architecture.md) §"Techniques to borrow, ranked by impact" #7 (Hierarchical loops) + #8 (Anomaly-triggered attention)

## Goal

Formalize UIPE's perception layer as three rate-bounded, event-driven loops at distinct cadences — frame (~16ms, tied to keyframe emission), semantic (~200ms), and intent (~1s). Loops are idle by default and wake on either a heartbeat-with-pending-work or an escalation from a faster loop. Anomaly triggers connect the tiers: when a faster loop spots something unexpected, it escalates work to the slower, more expensive loop. v1 ships with one trigger — **DOM mutation outside an active CSS animation** — proving the full escalation chain on a concrete case.

The autopilot analogy: in Tesla / Waymo perception, the fast loop (sensor fusion at ~60Hz) is always running, the slower loops (motion planning at ~10Hz, route planning at ~1Hz) wake when needed. UIPE's equivalent: frame loop subscribes to keyframes, semantic loop wakes on frame-detected anomalies, intent loop wakes when the semantic loop flags an unclassified component for VLM treatment.

## Primary consumer

**The agent observing what UIPE perceives, via the timeline.** New `perception-*` event types flow through `TemporalEventStream` so an agent calling `get_timeline` sees every tick, anomaly, escalation, and intent-result. The agent's existing model (poll for events, reason about state) doesn't change; the timeline just carries richer information.

Secondary consumer: **the developer using the `perception-session` Claude skill** to debug "what is perception actually seeing on this page during this workflow?" The skill is an inspection layer on top of the MCP tool surface, not a CI gate.

## Non-goals (v1)

- **Additional anomaly triggers** beyond `mutation-outside-animation`. The candidates discussed in brainstorming (animation deviation > 0.5, new component signature, optical-flow motion above threshold while no animation is tracked) are deferred. Each is a single-file detector + a one-line addition to the `AnomalyReason` union when picked up in v2.
- **CSS `transition` tracking.** `AnimationCollector` tracks the Web Animations API (`Animation` objects), not CSS `transition`. A transition-triggered DOM change while no `Animation` is in flight = false anomaly. A v2 `TransitionCollector` would close this gap.
- **Spatial gating.** Mutations on subtree A while an animation runs on subtree B are suppressed by the global temporal gate. Per-animation target-ancestor tracking + spatial-overlap is v2.
- **Configurable thresholds via runtime config.** `lookbackMs`, `warmupMs`, `coalesceMs`, semantic-loop cadence, intent-loop cadence are constants in v1. Tuned in source, not via MCP.
- **Persisted session summaries across server restarts.** Summaries live in-memory until next `start_perception`. Disk persistence is v2.
- **Multi-page parallel perception.** Single session per MCP server. If `BrowserRuntime` ever supports parallel tabs, a session-per-page model is needed.
- **VLM cost budgeting / rate limiting.** `vlmCalls.estimatedDollars` is best-effort observability; no quota, no kill-switch.
- **Anomaly persistence.** Anomalies live in `TemporalEventStream`'s ring buffer (lossy by design). Long-session preservation would need a v2 `AnomalyStore`.
- **The skill's "expected anomalies" assertion grammar.** v1 skill report is descriptive. A v2 assertion grammar (`"workflow X must produce 1 anomaly of reason Y"`) would make the skill a real test framework.

## Architecture

```
   FrameCapture (existing)
        │  keyframe event
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FrameLoop                                                           │
│  src/pipelines/perception/frame-loop.ts                              │
│                                                                       │
│  on keyframe:                                                         │
│    emit perception-tick { tier: 'frame', cause: 'keyframe' }          │
│    detector = detectMutationOutsideAnimation({                        │
│      recentMutations,    // ring buffer trimmed to lookbackMs         │
│      activeAnimations,   // Set<animId> from anim-start/-end events   │
│      nowMs, sessionStartMs,                                            │
│    })                                                                 │
│    if detector returned a result:                                     │
│      emit perception-anomaly { tier, reason, detail }                 │
│      emit perception-escalation { from: 'frame', to: 'semantic' }     │
│      EventEmitter.emit('escalate', { from: 'frame', regions })        │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ escalate event
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SemanticLoop                                                        │
│  src/pipelines/perception/semantic-loop.ts                           │
│                                                                       │
│  wake conditions:                                                     │
│    - escalation from frame loop                                       │
│    - heartbeat (max cadence ~200ms) if work accumulated                │
│                                                                       │
│  on wake:                                                             │
│    emit perception-tick { tier: 'semantic', cause }                   │
│    for each flagged region:                                           │
│      extract structural state of mutation target subtree              │
│      run component-index match (uses #4's indexer)                    │
│      if any node has component.status === 'pending':                  │
│        EventEmitter.emit('escalate', { from: 'semantic', regions })   │
│        emit perception-escalation { from: 'semantic', to: 'intent' }  │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ escalate event
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  IntentLoop                                                          │
│  src/pipelines/perception/intent-loop.ts                             │
│                                                                       │
│  wake conditions:                                                     │
│    - escalation from semantic loop (only)                             │
│    - target cadence ~1s, but never fires on heartbeat alone           │
│                                                                       │
│  on wake:                                                             │
│    emit perception-tick { tier: 'intent', cause: 'escalation' }       │
│    for each flagged region:                                           │
│      crop screenshot to region.bbox via sharp                         │
│      result = await classifyByVlm({ html: '', screenshotCrop })       │
│      emit perception-intent-result { region, classification, ... }    │
└──────────────────────────────────────────────────────────────────────┘
```

**Module boundaries:**
- `session.ts` — `PerceptionSession` orchestrator. Owns lifecycle (`start(page)`, `stop()`, `getSummary()`). Instantiates the three loops + the in-process `EventEmitter` that wires them. Holds the in-memory summary state.
- `frame-loop.ts` — `FrameLoop` class. Maintains `activeAnimations: Set<string>` (from anim-start/-end events) and `recentMutations` ring buffer. Subscribes to `FrameCapture` keyframes. Calls the pure detector on each keyframe.
- `semantic-loop.ts` — `SemanticLoop` class. Owns its target-cadence timer (idle gating). On wake: re-extracts the changed subtree's structural state, hands to the existing component-`Indexer` (from #4).
- `intent-loop.ts` — `IntentLoop` class. Pure event-driven (no heartbeat). Wraps `classifyByVlm` (from #4) + sharp crop.
- `anomaly/mutation-outside-animation.ts` — pure detector function. No state, no I/O.
- `types.ts` — `PerceptionSessionSummary`, `PerceptionTier`, runtime helpers. Event payload types live in `temporal/collectors/types.ts` alongside the rest of the timeline types.

**Pipeline integration point:** Perception is a top-level subsystem instantiated in `src/mcp/server.ts`. The frame loop subscribes to `FrameCapture`'s `keyframe` events and to `TemporalEventStream`'s anim-start/-end events. The semantic loop calls into the existing `Indexer` from sub-project #4. The intent loop calls `classifyByVlm` from #4. No mutation of existing pipeline outputs — perception layers on top.

## Data shapes

### Event payload types

```typescript
// In src/pipelines/temporal/collectors/types.ts (alongside existing payloads)

export type PerceptionTier = 'frame' | 'semantic' | 'intent';
export type AnomalyReason = 'mutation-outside-animation';   // v1: single trigger

export interface PerceptionTickPayload {
  tier: PerceptionTier;
  cause: 'keyframe' | 'heartbeat' | 'escalation' | 'navigation-reset';
}

export interface PerceptionAnomalyPayload {
  tier: PerceptionTier;              // which loop detected it
  reason: AnomalyReason;
  detail: {
    mutationCount: number;           // mutations in the coalesced burst
    targetNodeIds: string[];         // affected DOM nodes (deduped)
  };
}

export interface PerceptionEscalationPayload {
  from: PerceptionTier;
  to: PerceptionTier;
  reason: AnomalyReason;
  regions: Array<{
    nodeId: string;
    bbox: { x: number; y: number; w: number; h: number };
  }>;
}

export interface PerceptionIntentResultPayload {
  region: { nodeId: string; bbox: { x: number; y: number; w: number; h: number } };
  classification: string;             // e.g. "AnimatedCounter", "ToastNotification", "Unknown"
  classificationSource: 'vlm';
  durationMs: number;                 // VLM round-trip time
}
```

### EventType + PayloadFor extensions

```typescript
export type EventType =
  | 'input' | 'mutation' | 'network-request' | 'network-response'
  | 'animation-start' | 'animation-end' | 'animation-prediction'
  | 'phash-change'
  | 'optical-flow-raw' | 'optical-flow-region' | 'optical-flow-motion'
  | 'perception-tick' | 'perception-anomaly' | 'perception-escalation' | 'perception-intent-result';

export type PayloadFor<T extends EventType> =
  // ... existing rows ...
  T extends 'perception-tick'           ? PerceptionTickPayload :
  T extends 'perception-anomaly'        ? PerceptionAnomalyPayload :
  T extends 'perception-escalation'     ? PerceptionEscalationPayload :
  T extends 'perception-intent-result'  ? PerceptionIntentResultPayload :
  never;
```

### Session summary

```typescript
// In src/pipelines/perception/types.ts

export interface PerceptionSessionSummary {
  startedAt: number;                       // stream-relative ms at session start
  durationMs: number;                      // wall-clock elapsed
  tickCounts: Record<PerceptionTier, number>;
  averageCadenceMs: Record<PerceptionTier, number | null>;  // null if loop never ticked
  targetCadenceMs: Record<PerceptionTier, number>;          // {frame: keyframe-bound, semantic: 200, intent: 1000}
  anomalyCount: number;
  anomaliesByReason: Record<AnomalyReason, number>;
  escalationCount: number;
  intentResultCount: number;
  vlmCalls: { count: number; estimatedDollars?: number };   // best-effort cost surface
}
```

## v1 anomaly trigger — `mutation-outside-animation`

Pure function, called by `FrameLoop` on each keyframe. The loop owns state (active-animation set, recent-mutation buffer); the detector is data-in / data-out.

```typescript
// src/pipelines/perception/anomaly/mutation-outside-animation.ts

export interface DetectInput {
  recentMutations: TimelineEvent<'mutation'>[];   // ring-buffer-trimmed to lookbackMs
  activeAnimations: Set<string>;                  // animationIds currently running
  nowMs: number;
  sessionStartMs: number;
}

export interface DetectConfig {
  lookbackMs: number;        // default 200 — window of "recent" mutations
  coalesceWindowMs: number;  // default 100 — group bursts into one anomaly
  warmupMs: number;          // default 500 — suppress mutations right after session start
}

export type DetectResult =
  | null
  | { mutationCount: number; targetNodeIds: string[] };

export function detectMutationOutsideAnimation(
  input: DetectInput,
  config?: DetectConfig,
): DetectResult;
```

**Decision logic (in order):**

1. **Warm-up gate.** If `nowMs - sessionStartMs < warmupMs` → return null. Suppresses page-load + hydration mutation bursts.
2. **Active-animation gate.** If `activeAnimations.size > 0` → return null. Any CSS animation in flight = mutations are "expected."
3. **Coalesce.** Group `recentMutations` into bursts (gaps ≤ `coalesceWindowMs` belong to the same burst). Take only the latest burst (the one whose latest timestamp is closest to `nowMs`). Deduplicate target node IDs.
4. **Empty-result short-circuit.** If burst is empty → return null.
5. **Emit.** Return `{ mutationCount: burst.length, targetNodeIds: [...uniqueIds] }`.

**State managed by `FrameLoop`:**
- `activeAnimations: Set<string>` — added on `animation-start`, removed on `animation-end`.
- `recentMutations: TimelineEvent<'mutation'>[]` — append on `mutation` events, trim to `lookbackMs` on each keyframe tick.
- `lastAnomalyEmittedAt: number` — debounce so back-to-back keyframes don't re-fire the same anomaly. Suppress if within `coalesceWindowMs` of last emit.

**Why this catches the Garner count-up case** (validated during brainstorm against `https://garnerhcre-rebuild.vercel.app/`): IntersectionObserver fires → React `setState` schedules re-render → `<span>$0M+</span>` text content changes to `<span>$5M+</span>`. `MutationCollector` captures the mutation. No CSS animation was started (pure JS counter). `activeAnimations` is empty. Past the 500ms warmup. Result: one anomaly per coalesced burst → semantic loop wakes → checks the component-index → finds the `<span>` matches a known signature → suppresses VLM (already classified). Cost: one frame-tick + one semantic-tick. No VLM call. Visible in the timeline as a `perception-anomaly` event.

## MCP tool surface

Three new tools registered in `src/mcp/server.ts`:

**`start_perception`** — Begin a perception session.

```typescript
inputSchema: z.object({})
```

Behavior:
1. If no `FrameCapture` is running, auto-start `watch` (perception requires keyframes).
2. Instantiate `PerceptionSession`, call `start(page)`.
3. Store as `currentSession` on the server.
4. Return `{ status: 'started', startedAt: <stream-relative-ms> }` or `{ status: 'already-running', startedAt: <existing> }`.

Errors: no page attached → `"Call navigate first."`

**`stop_perception`** — End the current session, return summary.

```typescript
inputSchema: z.object({})
```

Behavior:
1. Call `currentSession.stop()` (unsubscribes loops; clears timers).
2. Capture `currentSession.getSummary()` into `lastSummary`.
3. Clear `currentSession`. Do NOT auto-stop `watch` — keyframe capture stays alive for non-perception consumers.
4. Return the summary as JSON.

Errors: no active session → returns `lastSummary` if any, else `{ error: 'No session active and no prior summary' }`.

**`get_perception_session`** — Read-only snapshot.

```typescript
inputSchema: z.object({})
```

Behavior: returns `currentSession.getSummary()` if running, else `lastSummary` if any, else `{ error: 'No session active and no prior summary' }`. Useful for the skill to peek mid-flight.

The existing `get_timeline` tool exposes all `perception-*` events via the standard timeline filter (`types: ['perception-tick', 'perception-anomaly', ...]`).

## Claude skill — `perception-session`

Lives at `ui-perception-engine/skills/perception-session/SKILL.md`. Invoked via Claude Code's `Skill` tool with a workflow description.

```yaml
---
name: perception-session
description: |
  Use when investigating what UIPE's perception layer captures during a workflow.
  Wraps start_perception → drive action → inspect events + summary → stop into
  a structured session, then reports a markdown summary of which loops fired,
  anomalies triggered, and intent-loop classifications.
---
```

**Skill body instructions:**
1. Accept a workflow description from the user.
2. Call `start_perception` (auto-starts watch).
3. Execute the workflow via existing `navigate` / `act` MCP tools.
4. Optionally call `get_perception_session` mid-flight for long workflows.
5. After the workflow completes, call `stop_perception` to get the final summary.
6. Pull recent `perception-*` events from `get_timeline`.
7. Produce a markdown report containing:
   - Tick counts + actual cadences vs targets (per tier)
   - Anomalies fired (timestamps + reasons + target nodes)
   - Escalations (from-tier → to-tier counts)
   - Intent-loop results (region classifications)
   - VLM cost estimate (best-effort)
   - Optional pass/fail vs user-stated expectations

The skill encodes the inspection *workflow*; the underlying MCP tools remain composable for agents that prefer raw access.

## Edge cases

| Case | Behavior |
|---|---|
| `start_perception` called twice without `stop_perception` between | Return `{ status: 'already-running', startedAt: <existing> }`. Do NOT restart — silently resetting counts would mislead the caller. |
| Page navigation during a session | `PerceptionSession` listens on `page.on('framenavigated', ...)`. On nav: emit `perception-tick { tier: 'frame', cause: 'navigation-reset' }`, clear `activeAnimations` + `recentMutations`, reset `sessionStartMs` to the new nav time (re-applies warmup). Session stays alive across navigations. |
| Page closed (tab killed) mid-session | `page.on('close')` fires. Auto-stop the session; preserve the summary in `lastSummary` until next `start_perception`. |
| `FrameCapture` not running mid-session (`watch` stopped externally) | Frame loop goes dormant (no keyframes = no ticks). Semantic + intent still wake via heartbeat / queued escalations. Summary surfaces `tickCounts.frame = 0` so the skill can flag it. |
| VLM call fails (network error, missing API key) | `classifyByVlm` (from #4) returns `'Unknown'` rather than throwing. `vlmCalls.count` still increments; the intent-result emits with `classification: 'Unknown'`. Anomaly + escalation chains are unaffected. |
| Coalesce-window miss (two bursts just outside the coalesce window) | Two anomalies fire instead of one. Acceptable in v1 — both timestamps land on the timeline; the skill's report shows both. Tune `coalesceWindowMs` if real-world false-doubles become common. |
| Intent loop backpressure (escalations arrive faster than VLM responds) | `IntentLoop` maintains an internal pending queue (mirrors #4's `ClassificationQueue`). If pending > 10, drop oldest with a logger warning. No timeline event for drops (would be noise). |
| Mutations on subtree A while CSS animation runs on subtree B | Suppressed by the global temporal gate. False negative. Documented in non-goals; spatial gating is v2. |
| Mutation burst within the warmup window | Suppressed. False negative on initial workflow actions. Skill workflows should call `start_perception` *before* the first interaction to give warmup room. |
| Heartbeat fires on a loop with no pending work | `perception-tick { cause: 'heartbeat' }` still emits — useful for the skill to verify the loop is alive. Cheap (single timeline event). |
| Skill workflow runs longer than expected, never calls `stop_perception` | Session lingers as a zombie until manually stopped or page closed. Document as a known limit. |
| Concurrent overlapping `start_perception` calls (rare but possible across awaits) | First call wins; second returns `already-running`. Same as the duplicate case. |

## Testing

### Pure unit tests in `tests/unit/pipelines/perception/`

| File | Coverage |
|---|---|
| `anomaly/mutation-outside-animation.test.ts` | Warmup gate suppresses; active-animation gate suppresses; coalesce groups bursts ≤ `coalesceWindowMs`; dedupes target node IDs; empty input returns null; latest-burst-only selection. |
| `frame-loop.test.ts` | On simulated keyframe → emits `perception-tick { tier: 'frame', cause: 'keyframe' }`. Animation-start/-end events update `activeAnimations`. Mutation events accumulate; ring buffer trims past `lookbackMs`. Detector return triggers anomaly + escalation events. Debounce suppresses back-to-back identical anomalies. |
| `semantic-loop.test.ts` | Rate-bounded: two escalations within 50ms produce one tick (cadence honored). Heartbeat tick fires only when work pending. Calls component-`Indexer` on flagged regions. Escalates to intent when `component.status === 'pending'`. |
| `intent-loop.test.ts` | Only fires on escalation, never on heartbeat. Calls mocked VLM classifier per region. Emits `perception-intent-result`. Backpressure: 11th pending escalation triggers oldest-drop. |
| `session.test.ts` | `start(page)` wires all three loops + the EventEmitter. `stop()` unsubscribes cleanly (no zombie timers). `getSummary()` returns correct aggregate counts. Navigation event resets `sessionStartMs`. Page-close event auto-stops. |

### Integration test in `tests/integration/perception/perception-e2e.test.ts`

Playwright + a static HTML fixture with a deliberate "mutation outside animation" trigger:

1. `page.setContent()` with a fixture: a button that, on click, triggers `setTimeout(() => el.textContent = 'changed', 100)` — pure JS, no CSS animation.
2. `start_perception` (the test calls this via the server's tool handler directly, not via MCP — same pattern as #3's integration test).
3. `page.click('button')`.
4. Wait 500ms — enough for the mutation, frame tick, semantic tick, intent tick to all fire.
5. `stop_perception` → get the summary.
6. Assert: summary has exactly 1 anomaly of reason `mutation-outside-animation`, exactly 1 `frame→semantic` escalation, ≥ 1 `semantic→intent` escalation if the mutated element produces a `pending` component (configure the fixture so it does), mocked VLM called exactly once.

VLM is mocked with a deterministic stub (returns `'TestComponent'`). Real-browser, real timing, no flakiness because the mutation timing is wall-clock-deterministic.

### Performance budget

- `FrameLoop.onKeyframe()` should complete in < 1ms — pure-TS detector + small ring-buffer ops.
- `SemanticLoop.onWake()` cost is dominated by `Indexer.run()`, already characterized in #4 (< 50ms for typical pages).
- `IntentLoop` cost is dominated by VLM round-trip (~500ms-2s; uncontrolled).

## Implementation phasing (rough — full task breakdown in subsequent plan)

1. Event-type union + payload types (`temporal/collectors/types.ts` extension + type tests)
2. Pure detector: `anomaly/mutation-outside-animation.ts`
3. `PerceptionSession` skeleton: lifecycle, summary stub, no loops yet
4. `FrameLoop`: subscribes to keyframes + animation events, runs detector, emits events
5. `SemanticLoop`: cadence timer, escalation queue, calls Indexer
6. `IntentLoop`: escalation-driven, VLM call, backpressure
7. `EventEmitter` wiring in `PerceptionSession`
8. MCP tools (`start_perception`, `stop_perception`, `get_perception_session`) + server wiring
9. `perception-session` Claude skill (`skills/perception-session/SKILL.md`)
10. Integration test (Playwright + fixture)
11. Docs + roadmap update (flip #7 + #8 to ✅, link to PR)

Likely ~12-14 tasks in the implementation plan.

## Open questions / follow-ups

- **Coalesce-window calibration.** 100ms is a guess. Real-world testing on dynamic pages (SPAs with frequent re-renders) will tell us if it's too tight (false doubles) or too loose (lumping unrelated actions). Cheap to tune in source.
- **Semantic-loop heartbeat cadence.** 200ms targets ~5Hz. If the loop's actual work (DOM re-extraction on subtree) is slow on heavy pages, we may need a longer heartbeat or pre-filter mutations.
- **Intent-loop drop policy.** Oldest-first is the obvious default but "highest-priority-first" (e.g., based on bbox size) might be smarter once we have more anomaly reasons. Defer to v2 calibration.
- **Skill assertion grammar.** Today's skill report is descriptive. A v2 assertion grammar (the skill takes "expected: 1 anomaly of reason mutation-outside-animation") would close the loop on "perception tests" being real tests, not just inspections.
- **OmniParser tier integration.** If the semantic loop's component-extract becomes the bottleneck, OmniParser's region detection could feed into it as a tier-A pre-filter (same role OmniParser plays in `VisualPipeline.detectElements`). Out of scope for v1.

## References

- [`docs/architecture.md`](../../architecture.md) §"Hierarchical loops at fixed rates" + §"Anomaly-triggered attention" — canonical autopilot analogy
- [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) sub-projects #7 and #8 (merged here)
- [`src/pipelines/temporal/event-stream.ts`](../../../src/pipelines/temporal/event-stream.ts) — existing timeline; perception events flow through it
- [`src/pipelines/temporal/collectors/animation.ts`](../../../src/pipelines/temporal/collectors/animation.ts) — source of `animation-start`/`-end` events that feed `activeAnimations`
- [`src/pipelines/temporal/collectors/mutation.ts`](../../../src/pipelines/temporal/collectors/mutation.ts) — source of mutation events the detector consumes
- [`src/pipelines/component-index/indexer.ts`](../../../src/pipelines/component-index/indexer.ts) — sub-project #4; called by `SemanticLoop`
- [`src/pipelines/component-index/vlm-classifier.ts`](../../../src/pipelines/component-index/vlm-classifier.ts) — sub-project #4; called by `IntentLoop`
- [`docs/superpowers/specs/2026-05-12-component-index-design.md`](2026-05-12-component-index-design.md) — sub-project #4 spec, reference for spec/plan style
- [`docs/superpowers/specs/2026-05-11-animation-predictive-verification-design.md`](2026-05-11-animation-predictive-verification-design.md) — sub-project #3 spec, reference for the pure-helpers + orchestrator pattern this design follows
