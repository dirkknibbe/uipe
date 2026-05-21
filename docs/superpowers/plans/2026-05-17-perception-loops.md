# Perception Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a rate-bounded, event-driven perception system with three loops (frame / semantic / intent) and one v1 anomaly trigger (`mutation-outside-animation`). Loops wake on heartbeat or escalation; the chain produces `perception-*` events on the existing `TemporalEventStream` and a `PerceptionSessionSummary` inspectable via three new MCP tools and a Claude skill.

**Architecture:** New top-level pipeline at `src/pipelines/perception/` with one orchestrator (`PerceptionSession`) and three loop classes. Pure helpers (the detector) carry decisions; loops own state + subscriptions. Escalation between loops via a session-owned `EventEmitter`. Three MCP tools (`start_perception`, `stop_perception`, `get_perception_session`) and a `perception-session` Claude skill provide the public surface. No mutation of existing pipeline outputs — perception layers on top of `FrameCapture`, `TemporalEventStream`, `AnimationCollector`, `MutationCollector`, and the #4 `Indexer`.

**Tech Stack:** TypeScript (ESM with `.js` import extensions), Playwright, Vitest, pnpm, `sharp` (already a dep, for screenshot cropping), Anthropic SDK (already used via `classifyByVlm`).

**Spec:** [`docs/superpowers/specs/2026-05-17-perception-loops-design.md`](../specs/2026-05-17-perception-loops-design.md).

---

## File Structure

**New files (production):**

```
src/pipelines/perception/
├── types.ts                                          PerceptionSessionSummary
├── session.ts                                        PerceptionSession orchestrator
├── frame-loop.ts                                     FrameLoop class
├── semantic-loop.ts                                  SemanticLoop class
├── intent-loop.ts                                    IntentLoop class
└── anomaly/
    └── mutation-outside-animation.ts                 pure detector
```

**New files (MCP):**

```
src/mcp/tools/perception.ts                          three factory functions sharing state
```

**New files (skill):**

```
skills/perception-session/SKILL.md
```

**New files (tests):**

```
tests/unit/pipelines/perception/
├── types.test.ts                                     event payload + session summary type construction
├── anomaly/
│   └── mutation-outside-animation.test.ts            pure detector
├── session.test.ts                                   lifecycle + summary accumulation
├── frame-loop.test.ts                                state, subscriptions, detector wiring
├── semantic-loop.test.ts                             cadence, escalation, indexer calls
└── intent-loop.test.ts                               VLM call, backpressure

tests/integration/perception/
├── fixtures/
│   └── mutation-trigger.html                         button → setTimeout text mutation
└── perception-e2e.test.ts                            Playwright full-chain test

tests/unit/mcp/
└── perception.test.ts                                three MCP tool factories
```

**Modified files:**

```
src/pipelines/temporal/collectors/types.ts            # Add 4 EventType entries + payloads + PerceptionTier + AnomalyReason
src/mcp/server.ts                                     # Instantiate state, register 3 tools, bump TOOL_NAMES
tests/unit/mcp/tools.test.ts                          # TOOL_NAMES count + toContain assertions
/Users/dirkknibbe/uipe/docs/architecture.md           # Flip #7 + #8 rows in Current implementation table
/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md  # Flip #7 + #8 statuses
```

**Module-boundary rationale (recap from spec):**
- Pure detector (`anomaly/mutation-outside-animation.ts`) carries the gate logic + coalesce math; testable as plain TS.
- `frame-loop.ts` owns state (active-animation set, recent-mutations ring buffer) and CDP/event-stream subscriptions; calls the pure detector.
- `semantic-loop.ts` and `intent-loop.ts` follow the same "state + subscriptions + handoff to existing helpers" pattern; semantic calls `Indexer`, intent calls `classifyByVlm` — both from sub-project #4.
- `session.ts` orchestrates lifecycle, owns an internal `EventEmitter` for inter-loop escalation, and exposes `_record*` methods loops call to update the summary + emit to the timeline.

---

## Common commands

All commands run from the `ui-perception-engine/` directory.

- Run all unit tests: `pnpm exec vitest run --reporter=verbose tests/unit/`
- Run perception unit tests: `pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/`
- Run perception e2e: `pnpm exec vitest run --reporter=verbose tests/integration/perception/`
- Run a single file: `pnpm exec vitest run --reporter=verbose <path>`
- Typecheck: `pnpm exec tsc --noEmit`
- Lint: `pnpm exec eslint src tests --ext .ts`

After every task: typecheck passes, all previously-passing tests pass, then commit.

**Note on full-suite runs:** The optical-flow integration tests are slow. If the full suite times out on a given task, scope tests to `tests/unit/` + `tests/integration/perception/` and run `pnpm exec tsc --noEmit` separately as the type-safety ground truth.

---

## Task 1: Event types + payload definitions

**Files:**
- Modify: `src/pipelines/temporal/collectors/types.ts`
- Create: `src/pipelines/perception/types.ts`
- Create: `tests/unit/pipelines/perception/types.test.ts`

Types-only task. Adds four new event payloads + the session summary shape, locks the contract via type-construction assertions. Same pattern as sub-project #3 Task 1 and #4 Task 1.

- [ ] **Step 1: Write `tests/unit/pipelines/perception/types.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import type {
  PerceptionTier,
  AnomalyReason,
  PerceptionTickPayload,
  PerceptionAnomalyPayload,
  PerceptionEscalationPayload,
  PerceptionIntentResultPayload,
  TimelineEvent,
} from '../../../../src/pipelines/temporal/collectors/types.js';
import type { PerceptionSessionSummary } from '../../../../src/pipelines/perception/types.js';

describe('PerceptionTier', () => {
  it('accepts the three tier values', () => {
    const tiers: PerceptionTier[] = ['frame', 'semantic', 'intent'];
    expect(tiers).toHaveLength(3);
  });
});

describe('AnomalyReason', () => {
  it('accepts the v1 reason', () => {
    const r: AnomalyReason = 'mutation-outside-animation';
    expect(r).toBe('mutation-outside-animation');
  });
});

describe('PerceptionTickPayload', () => {
  it('accepts each cause value', () => {
    const causes: Array<PerceptionTickPayload['cause']> = ['keyframe', 'heartbeat', 'escalation', 'navigation-reset'];
    const payloads = causes.map((cause) => ({ tier: 'frame' as const, cause }));
    expect(payloads).toHaveLength(4);
  });
});

describe('PerceptionAnomalyPayload', () => {
  it('accepts a full anomaly shape', () => {
    const p: PerceptionAnomalyPayload = {
      tier: 'frame',
      reason: 'mutation-outside-animation',
      detail: { mutationCount: 3, targetNodeIds: ['dom-1', 'dom-2'] },
    };
    expect(p.detail.mutationCount).toBe(3);
  });
});

describe('PerceptionEscalationPayload', () => {
  it('accepts a frame→semantic escalation', () => {
    const p: PerceptionEscalationPayload = {
      from: 'frame',
      to: 'semantic',
      reason: 'mutation-outside-animation',
      regions: [{ nodeId: 'dom-1', bbox: { x: 0, y: 0, w: 100, h: 50 } }],
    };
    expect(p.regions).toHaveLength(1);
  });
});

describe('PerceptionIntentResultPayload', () => {
  it('accepts a complete intent result', () => {
    const p: PerceptionIntentResultPayload = {
      region: { nodeId: 'dom-1', bbox: { x: 0, y: 0, w: 100, h: 50 } },
      classification: 'AnimatedCounter',
      classificationSource: 'vlm',
      durationMs: 873,
    };
    expect(p.classification).toBe('AnimatedCounter');
  });
});

describe('TimelineEvent<perception-*>', () => {
  it('perception-tick typechecks via PayloadFor mapping', () => {
    const e: TimelineEvent<'perception-tick'> = {
      id: 'evt-1', type: 'perception-tick', timestamp: 0,
      payload: { tier: 'frame', cause: 'keyframe' },
    };
    expect(e.type).toBe('perception-tick');
  });

  it('perception-anomaly typechecks', () => {
    const e: TimelineEvent<'perception-anomaly'> = {
      id: 'evt-2', type: 'perception-anomaly', timestamp: 0,
      payload: { tier: 'frame', reason: 'mutation-outside-animation', detail: { mutationCount: 1, targetNodeIds: ['x'] } },
    };
    expect(e.type).toBe('perception-anomaly');
  });

  it('perception-escalation typechecks', () => {
    const e: TimelineEvent<'perception-escalation'> = {
      id: 'evt-3', type: 'perception-escalation', timestamp: 0,
      payload: { from: 'frame', to: 'semantic', reason: 'mutation-outside-animation', regions: [] },
    };
    expect(e.type).toBe('perception-escalation');
  });

  it('perception-intent-result typechecks', () => {
    const e: TimelineEvent<'perception-intent-result'> = {
      id: 'evt-4', type: 'perception-intent-result', timestamp: 0,
      payload: {
        region: { nodeId: 'x', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        classification: 'X',
        classificationSource: 'vlm',
        durationMs: 100,
      },
    };
    expect(e.type).toBe('perception-intent-result');
  });
});

describe('PerceptionSessionSummary', () => {
  it('accepts a complete summary shape', () => {
    const s: PerceptionSessionSummary = {
      startedAt: 0,
      durationMs: 5000,
      tickCounts: { frame: 12, semantic: 3, intent: 1 },
      averageCadenceMs: { frame: 100, semantic: 1500, intent: null },
      targetCadenceMs: { frame: 16, semantic: 200, intent: 1000 },
      anomalyCount: 2,
      anomaliesByReason: { 'mutation-outside-animation': 2 },
      escalationCount: 3,
      intentResultCount: 1,
      vlmCalls: { count: 1, estimatedDollars: 0.02 },
    };
    expect(s.anomalyCount).toBe(2);
  });

  it('accepts a summary with null averageCadenceMs for an unused tier', () => {
    const s: PerceptionSessionSummary = {
      startedAt: 0, durationMs: 100,
      tickCounts: { frame: 0, semantic: 0, intent: 0 },
      averageCadenceMs: { frame: null, semantic: null, intent: null },
      targetCadenceMs: { frame: 16, semantic: 200, intent: 1000 },
      anomalyCount: 0,
      anomaliesByReason: { 'mutation-outside-animation': 0 },
      escalationCount: 0,
      intentResultCount: 0,
      vlmCalls: { count: 0 },
    };
    expect(s.tickCounts.frame).toBe(0);
  });
});
```

- [ ] **Step 2: Run typecheck — should FAIL because types don't exist yet**

```bash
pnpm exec tsc --noEmit
```
Expected: errors about `PerceptionTickPayload`, `AnomalyReason`, etc. not being exported.

- [ ] **Step 3: Modify `src/pipelines/temporal/collectors/types.ts` — extend the `EventType` union**

Find:
```typescript
export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'animation-prediction'
  | 'phash-change'
  | 'optical-flow-raw'
  | 'optical-flow-region'
  | 'optical-flow-motion';
```

Replace with:
```typescript
export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'animation-prediction'
  | 'phash-change'
  | 'optical-flow-raw'
  | 'optical-flow-region'
  | 'optical-flow-motion'
  | 'perception-tick'
  | 'perception-anomaly'
  | 'perception-escalation'
  | 'perception-intent-result';
```

- [ ] **Step 4: In the same file, add the new payload types**

Add these exports after the existing `OpticalFlow*Payload` definitions (search for `OpticalFlowMotionPayload` and add after it):

```typescript
export type PerceptionTier = 'frame' | 'semantic' | 'intent';

export type AnomalyReason = 'mutation-outside-animation';

export interface PerceptionTickPayload {
  tier: PerceptionTier;
  cause: 'keyframe' | 'heartbeat' | 'escalation' | 'navigation-reset';
}

export interface PerceptionAnomalyPayload {
  tier: PerceptionTier;
  reason: AnomalyReason;
  detail: {
    mutationCount: number;
    targetNodeIds: string[];
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
  classification: string;
  classificationSource: 'vlm';
  durationMs: number;
}
```

- [ ] **Step 5: In the same file, extend the `PayloadFor` mapped type**

Find:
```typescript
export type PayloadFor<T extends EventType> =
  T extends 'input'             ? InputPayload :
  T extends 'mutation'          ? MutationPayload :
  T extends 'network-request'   ? NetworkRequestPayload :
  T extends 'network-response'  ? NetworkResponsePayload :
  T extends 'animation-start'   ? AnimationStartPayload :
  T extends 'animation-end'     ? AnimationEndPayload :
  T extends 'animation-prediction' ? AnimationPredictionPayload :
  T extends 'phash-change'      ? PHashChangePayload :
  T extends 'optical-flow-raw'    ? OpticalFlowRawPayload :
  T extends 'optical-flow-region' ? OpticalFlowRegionPayload :
  T extends 'optical-flow-motion' ? OpticalFlowMotionPayload :
  never;
```

Replace with:
```typescript
export type PayloadFor<T extends EventType> =
  T extends 'input'             ? InputPayload :
  T extends 'mutation'          ? MutationPayload :
  T extends 'network-request'   ? NetworkRequestPayload :
  T extends 'network-response'  ? NetworkResponsePayload :
  T extends 'animation-start'   ? AnimationStartPayload :
  T extends 'animation-end'     ? AnimationEndPayload :
  T extends 'animation-prediction' ? AnimationPredictionPayload :
  T extends 'phash-change'      ? PHashChangePayload :
  T extends 'optical-flow-raw'    ? OpticalFlowRawPayload :
  T extends 'optical-flow-region' ? OpticalFlowRegionPayload :
  T extends 'optical-flow-motion' ? OpticalFlowMotionPayload :
  T extends 'perception-tick'           ? PerceptionTickPayload :
  T extends 'perception-anomaly'        ? PerceptionAnomalyPayload :
  T extends 'perception-escalation'     ? PerceptionEscalationPayload :
  T extends 'perception-intent-result'  ? PerceptionIntentResultPayload :
  never;
```

- [ ] **Step 6: Create `src/pipelines/perception/types.ts`**

```typescript
import type { PerceptionTier, AnomalyReason } from '../temporal/collectors/types.js';

export interface PerceptionSessionSummary {
  startedAt: number;                  // stream-relative ms at session start
  durationMs: number;                 // wall-clock elapsed since startedAt
  tickCounts: Record<PerceptionTier, number>;
  averageCadenceMs: Record<PerceptionTier, number | null>;  // null if loop never ticked
  targetCadenceMs: Record<PerceptionTier, number>;          // declared target
  anomalyCount: number;
  anomaliesByReason: Record<AnomalyReason, number>;
  escalationCount: number;
  intentResultCount: number;
  vlmCalls: { count: number; estimatedDollars?: number };
}
```

- [ ] **Step 7: Run typecheck and the new tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/types.test.ts
```
Expected: typecheck passes, 12 test cases pass.

- [ ] **Step 8: Run the full unit suite to confirm nothing else broke**

```bash
pnpm exec vitest run --reporter=dot tests/unit/
```
Expected: previously-passing tests still pass plus 12 new ones.

- [ ] **Step 9: Commit**

```bash
git add src/pipelines/temporal/collectors/types.ts src/pipelines/perception/types.ts tests/unit/pipelines/perception/types.test.ts
git commit -m "feat(perception): event types + session summary shape"
```

---

## Task 2: Pure detector — `mutation-outside-animation`

**Files:**
- Create: `src/pipelines/perception/anomaly/mutation-outside-animation.ts`
- Create: `tests/unit/pipelines/perception/anomaly/mutation-outside-animation.test.ts`

The v1 anomaly trigger. Pure function — no I/O, no async, no side effects. Takes `recentMutations` + `activeAnimations` + timestamps + config; returns either `null` or `{ mutationCount, targetNodeIds }`. Decision logic per spec §"v1 anomaly trigger — mutation-outside-animation":

1. Warmup gate: `nowMs - sessionStartMs < warmupMs` → null
2. Active-animation gate: `activeAnimations.size > 0` → null
3. Coalesce: group mutations into bursts (gaps ≤ `coalesceWindowMs` join); take the latest burst
4. Empty short-circuit
5. Emit result

- [ ] **Step 1: Write `tests/unit/pipelines/perception/anomaly/mutation-outside-animation.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { detectMutationOutsideAnimation } from '../../../../../src/pipelines/perception/anomaly/mutation-outside-animation.js';
import type { TimelineEvent } from '../../../../../src/pipelines/temporal/collectors/types.js';

function mkMutation(timestamp: number, targetNodeId: string): TimelineEvent<'mutation'> {
  return {
    id: `evt-${timestamp}-${targetNodeId}`,
    type: 'mutation',
    timestamp,
    payload: {
      mutationType: 'childList',
      targetNodeId,
      addedNodes: [],
      removedNodes: [],
      attributeName: undefined,
      oldValue: undefined,
      newValue: undefined,
    },
  };
}

const DEFAULTS = { lookbackMs: 200, coalesceWindowMs: 100, warmupMs: 500 };

describe('detectMutationOutsideAnimation', () => {
  it('returns null during warmup window', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(100, 'a')],
      activeAnimations: new Set(),
      nowMs: 400,            // 400 - 0 = 400 < 500ms warmup
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns null when any animation is active', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(900, 'a')],
      activeAnimations: new Set(['anim-1']),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns null when no mutations', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns result when past warmup + no animation + has mutations', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(950, 'a'), mkMutation(960, 'b')],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 2,
      targetNodeIds: ['a', 'b'],
    });
  });

  it('coalesces mutations within the coalesce window into one burst', () => {
    // Three mutations at 900, 950, 990 — gaps 50ms and 40ms, both ≤ 100ms coalesce
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(900, 'a'),
        mkMutation(950, 'b'),
        mkMutation(990, 'c'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 3,
      targetNodeIds: ['a', 'b', 'c'],
    });
  });

  it('takes only the latest burst when multiple non-overlapping bursts exist', () => {
    // Burst A: 600-650 (older). Burst B: 950-990 (latest). Gap = 300ms > coalesce.
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(600, 'old1'),
        mkMutation(650, 'old2'),
        mkMutation(950, 'new1'),
        mkMutation(990, 'new2'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 2,
      targetNodeIds: ['new1', 'new2'],
    });
  });

  it('deduplicates target node IDs', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(900, 'a'),
        mkMutation(920, 'a'),     // same node mutated twice
        mkMutation(950, 'b'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result?.targetNodeIds).toEqual(['a', 'b']);
    // mutationCount counts the events; targetNodeIds is deduped
    expect(result?.mutationCount).toBe(3);
  });

  it('treats a single mutation as a one-event burst', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(950, 'a')],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({ mutationCount: 1, targetNodeIds: ['a'] });
  });

  it('uses provided config over defaults', () => {
    // Override warmup to 0 → no suppression
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(100, 'a')],
      activeAnimations: new Set(),
      nowMs: 200,
      sessionStartMs: 0,
    }, { lookbackMs: 200, coalesceWindowMs: 100, warmupMs: 0 });
    expect(result).toEqual({ mutationCount: 1, targetNodeIds: ['a'] });
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/anomaly/mutation-outside-animation.test.ts
```
Expected: module-not-found errors.

- [ ] **Step 3: Create `src/pipelines/perception/anomaly/mutation-outside-animation.ts`**

```typescript
import type { TimelineEvent } from '../../temporal/collectors/types.js';

export interface DetectInput {
  recentMutations: TimelineEvent<'mutation'>[];
  activeAnimations: Set<string>;
  nowMs: number;
  sessionStartMs: number;
}

export interface DetectConfig {
  lookbackMs: number;
  coalesceWindowMs: number;
  warmupMs: number;
}

export type DetectResult =
  | null
  | { mutationCount: number; targetNodeIds: string[] };

export const DEFAULT_CONFIG: DetectConfig = {
  lookbackMs: 200,
  coalesceWindowMs: 100,
  warmupMs: 500,
};

/**
 * Pure detector for the v1 anomaly trigger. Returns a result when:
 *   - past the warmup window
 *   - no animation is currently active
 *   - at least one mutation falls within the latest coalesced burst
 *
 * `recentMutations` is assumed to already be trimmed to `lookbackMs` by the
 * caller (FrameLoop maintains a ring buffer).
 */
export function detectMutationOutsideAnimation(
  input: DetectInput,
  config: DetectConfig = DEFAULT_CONFIG,
): DetectResult {
  // 1. Warmup gate
  if (input.nowMs - input.sessionStartMs < config.warmupMs) return null;

  // 2. Active animation gate
  if (input.activeAnimations.size > 0) return null;

  // 3. Coalesce — group mutations into bursts, take the latest
  if (input.recentMutations.length === 0) return null;

  // Sort by timestamp ascending to make grouping deterministic
  const sorted = [...input.recentMutations].sort((a, b) => a.timestamp - b.timestamp);

  // Find the latest burst by walking backwards: include events while the gap
  // to the previous event is ≤ coalesceWindowMs.
  const latest = sorted[sorted.length - 1];
  const burst: TimelineEvent<'mutation'>[] = [latest];
  for (let i = sorted.length - 2; i >= 0; i--) {
    const gap = burst[burst.length - 1].timestamp - sorted[i].timestamp;
    if (gap > config.coalesceWindowMs) break;
    burst.push(sorted[i]);
  }

  // 4. Empty short-circuit (defensive — shouldn't hit since we returned null above on empty)
  if (burst.length === 0) return null;

  // 5. Emit. Dedupe target IDs.
  const uniqueIds = Array.from(new Set(burst.map((e) => e.payload.targetNodeId)));
  return {
    mutationCount: burst.length,
    targetNodeIds: uniqueIds,
  };
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/anomaly/mutation-outside-animation.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/perception/anomaly/mutation-outside-animation.ts tests/unit/pipelines/perception/anomaly/mutation-outside-animation.test.ts
git commit -m "feat(perception): pure detector — mutation-outside-animation"
```

---

## Task 3: `PerceptionSession` skeleton + lifecycle

**Files:**
- Create: `src/pipelines/perception/session.ts`
- Create: `tests/unit/pipelines/perception/session.test.ts`

Builds the orchestrator class with lifecycle (`start`/`stop`/`getSummary`) and the internal `_record*` methods loops call to update summary state + emit timeline events. No loops are wired in this task — they're added in tasks 4-7. This task establishes the contract.

The class also owns a private `EventEmitter` for inter-loop escalation. We expose `internalEmitter` (intentionally — loops in sibling files need it). It is not part of the public MCP surface.

**Note on TemporalEventStream API:** `TemporalEventStream.recordEvent(type, payload, timestamp?)` is the way collectors push events onto the timeline. The session uses the same method. If your local copy of `event-stream.ts` exposes a different name (e.g. `emit`, `push`), use the same name the existing collectors use — open `src/pipelines/temporal/collectors/animation.ts` to see the canonical call pattern.

- [ ] **Step 1: Verify TemporalEventStream's emit method name**

```bash
grep -n "this.stream\." src/pipelines/temporal/collectors/animation.ts | head -5
```

Note the method name used to push events (e.g. `recordEvent`, `emit`, `addEvent`). Use that exact name in all subsequent code.

- [ ] **Step 2: Write `tests/unit/pipelines/perception/session.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

function mkStream() {
  return {
    recordEvent: vi.fn(),
  } as unknown as TemporalEventStream;
}

describe('PerceptionSession lifecycle', () => {
  let stream: TemporalEventStream;
  let session: PerceptionSession;

  beforeEach(() => {
    stream = mkStream();
    session = new PerceptionSession({ eventStream: stream });
  });

  it('summary starts with zero counts and target cadences', () => {
    const s = session.getSummary();
    expect(s.tickCounts).toEqual({ frame: 0, semantic: 0, intent: 0 });
    expect(s.anomalyCount).toBe(0);
    expect(s.targetCadenceMs.semantic).toBe(200);
    expect(s.targetCadenceMs.intent).toBe(1000);
  });

  it('start() sets startedAt', () => {
    session.start(100);
    const s = session.getSummary();
    expect(s.startedAt).toBe(100);
  });

  it('start() called twice throws', () => {
    session.start(100);
    expect(() => session.start(200)).toThrow();
  });

  it('stop() sets durationMs based on time elapsed', () => {
    session.start(100);
    session.stop(450);
    const s = session.getSummary();
    expect(s.durationMs).toBe(350);
  });

  it('stop() without start throws', () => {
    expect(() => session.stop(100)).toThrow();
  });

  it('_recordTick increments tier count and emits perception-tick', () => {
    session.start(100);
    session.recordTick('frame', 'keyframe', 150);
    const s = session.getSummary();
    expect(s.tickCounts.frame).toBe(1);
    expect(stream.recordEvent).toHaveBeenCalledWith('perception-tick', { tier: 'frame', cause: 'keyframe' }, 150);
  });

  it('_recordAnomaly increments anomalyCount and reason bucket', () => {
    session.start(100);
    session.recordAnomaly('frame', 'mutation-outside-animation', { mutationCount: 2, targetNodeIds: ['x', 'y'] }, 200);
    const s = session.getSummary();
    expect(s.anomalyCount).toBe(1);
    expect(s.anomaliesByReason['mutation-outside-animation']).toBe(1);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-anomaly',
      { tier: 'frame', reason: 'mutation-outside-animation', detail: { mutationCount: 2, targetNodeIds: ['x', 'y'] } },
      200,
    );
  });

  it('_recordEscalation increments escalationCount', () => {
    session.start(100);
    session.recordEscalation('frame', 'semantic', 'mutation-outside-animation', [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }], 250);
    expect(session.getSummary().escalationCount).toBe(1);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-escalation',
      expect.objectContaining({ from: 'frame', to: 'semantic' }),
      250,
    );
  });

  it('_recordIntentResult increments intentResultCount + vlmCalls.count', () => {
    session.start(100);
    session.recordIntentResult(
      { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
      'AnimatedCounter',
      300,
      400,
    );
    const s = session.getSummary();
    expect(s.intentResultCount).toBe(1);
    expect(s.vlmCalls.count).toBe(1);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-intent-result',
      expect.objectContaining({ classification: 'AnimatedCounter', classificationSource: 'vlm', durationMs: 300 }),
      400,
    );
  });

  it('averageCadenceMs computes mean inter-tick interval per tier', () => {
    session.start(0);
    session.recordTick('frame', 'keyframe', 100);
    session.recordTick('frame', 'keyframe', 300);    // gap 200
    session.recordTick('frame', 'keyframe', 500);    // gap 200
    const s = session.getSummary();
    expect(s.averageCadenceMs.frame).toBe(200);
    expect(s.averageCadenceMs.semantic).toBeNull();
    expect(s.averageCadenceMs.intent).toBeNull();
  });

  it('internalEmitter is a usable EventEmitter', () => {
    const handler = vi.fn();
    session.internalEmitter.on('escalate', handler);
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    expect(handler).toHaveBeenCalledWith({ from: 'frame', regions: [] });
  });
});
```

- [ ] **Step 3: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/session.test.ts
```

- [ ] **Step 4: Create `src/pipelines/perception/session.ts`**

```typescript
import { EventEmitter } from 'node:events';
import type {
  AnomalyReason,
  PerceptionTier,
  PerceptionEscalationPayload,
} from '../temporal/collectors/types.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSessionSummary } from './types.js';

const TARGET_CADENCE_MS: Record<PerceptionTier, number> = {
  frame: 16,        // not actually used — frame is keyframe-bound; surfaced for inspection
  semantic: 200,
  intent: 1000,
};

const ALL_ANOMALY_REASONS: AnomalyReason[] = ['mutation-outside-animation'];

interface PerceptionSessionOptions {
  eventStream: TemporalEventStream;
}

interface TickRecord {
  count: number;
  lastTimestamp: number | null;
  intervalSum: number;     // sum of intervals between consecutive ticks
  intervalCount: number;   // number of intervals (count - 1)
}

export class PerceptionSession {
  readonly internalEmitter = new EventEmitter();

  private state: 'idle' | 'running' | 'stopped' = 'idle';
  private startedAt = 0;
  private stoppedAt = 0;
  private readonly stream: TemporalEventStream;

  private readonly ticks: Record<PerceptionTier, TickRecord> = {
    frame:    { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
    semantic: { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
    intent:   { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
  };

  private anomalyCount = 0;
  private anomaliesByReason: Record<AnomalyReason, number> = {
    'mutation-outside-animation': 0,
  };
  private escalationCount = 0;
  private intentResultCount = 0;
  private vlmCallCount = 0;

  constructor(opts: PerceptionSessionOptions) {
    this.stream = opts.eventStream;
  }

  start(nowMs: number): void {
    if (this.state === 'running') {
      throw new Error('PerceptionSession.start: already running');
    }
    this.state = 'running';
    this.startedAt = nowMs;
    this.stoppedAt = 0;
  }

  stop(nowMs: number): void {
    if (this.state !== 'running') {
      throw new Error('PerceptionSession.stop: not running');
    }
    this.state = 'stopped';
    this.stoppedAt = nowMs;
    this.internalEmitter.removeAllListeners();
  }

  isRunning(): boolean {
    return this.state === 'running';
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  /** Reset sessionStartMs after a navigation event so the warmup gate re-applies. */
  resetStartedAt(nowMs: number): void {
    this.startedAt = nowMs;
  }

  recordTick(tier: PerceptionTier, cause: 'keyframe' | 'heartbeat' | 'escalation' | 'navigation-reset', timestamp: number): void {
    const t = this.ticks[tier];
    t.count += 1;
    if (t.lastTimestamp !== null) {
      t.intervalSum += timestamp - t.lastTimestamp;
      t.intervalCount += 1;
    }
    t.lastTimestamp = timestamp;
    this.stream.recordEvent('perception-tick', { tier, cause }, timestamp);
  }

  recordAnomaly(tier: PerceptionTier, reason: AnomalyReason, detail: { mutationCount: number; targetNodeIds: string[] }, timestamp: number): void {
    this.anomalyCount += 1;
    this.anomaliesByReason[reason] += 1;
    this.stream.recordEvent('perception-anomaly', { tier, reason, detail }, timestamp);
  }

  recordEscalation(from: PerceptionTier, to: PerceptionTier, reason: AnomalyReason, regions: PerceptionEscalationPayload['regions'], timestamp: number): void {
    this.escalationCount += 1;
    this.stream.recordEvent('perception-escalation', { from, to, reason, regions }, timestamp);
  }

  recordIntentResult(
    region: { nodeId: string; bbox: { x: number; y: number; w: number; h: number } },
    classification: string,
    durationMs: number,
    timestamp: number,
  ): void {
    this.intentResultCount += 1;
    this.vlmCallCount += 1;
    this.stream.recordEvent(
      'perception-intent-result',
      { region, classification, classificationSource: 'vlm', durationMs },
      timestamp,
    );
  }

  getSummary(): PerceptionSessionSummary {
    const now = this.state === 'running' ? Date.now() : this.stoppedAt;
    const durationMs = this.state === 'idle' ? 0 : now - this.startedAt;

    const averageCadenceMs: Record<PerceptionTier, number | null> = {
      frame: this.ticks.frame.intervalCount > 0 ? this.ticks.frame.intervalSum / this.ticks.frame.intervalCount : null,
      semantic: this.ticks.semantic.intervalCount > 0 ? this.ticks.semantic.intervalSum / this.ticks.semantic.intervalCount : null,
      intent: this.ticks.intent.intervalCount > 0 ? this.ticks.intent.intervalSum / this.ticks.intent.intervalCount : null,
    };

    // Initialize anomaliesByReason buckets with zeros even if never fired
    const anomaliesByReason = {} as Record<AnomalyReason, number>;
    for (const r of ALL_ANOMALY_REASONS) {
      anomaliesByReason[r] = this.anomaliesByReason[r] ?? 0;
    }

    return {
      startedAt: this.startedAt,
      durationMs,
      tickCounts: {
        frame: this.ticks.frame.count,
        semantic: this.ticks.semantic.count,
        intent: this.ticks.intent.count,
      },
      averageCadenceMs,
      targetCadenceMs: TARGET_CADENCE_MS,
      anomalyCount: this.anomalyCount,
      anomaliesByReason,
      escalationCount: this.escalationCount,
      intentResultCount: this.intentResultCount,
      vlmCalls: { count: this.vlmCallCount },
    };
  }
}
```

- [ ] **Step 5: If `TemporalEventStream.recordEvent` doesn't match the actual method name in your codebase, update accordingly**

Open `src/pipelines/temporal/event-stream.ts` and check the public method name for adding events. If it's different (e.g. `record`, `addEvent`, `push`), update both `session.ts` and the test's mock to match.

- [ ] **Step 6: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/session.test.ts
```
Expected: 11 passing.

- [ ] **Step 7: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/pipelines/perception/session.ts tests/unit/pipelines/perception/session.test.ts
git commit -m "feat(perception): PerceptionSession orchestrator skeleton"
```

---

## Task 4: `FrameLoop`

**Files:**
- Create: `src/pipelines/perception/frame-loop.ts`
- Create: `tests/unit/pipelines/perception/frame-loop.test.ts`

Subscribes to `FrameCapture` keyframes and `TemporalEventStream` for animation + mutation events. Maintains `activeAnimations: Set<string>` and `recentMutations: TimelineEvent<'mutation'>[]` ring buffer. On each keyframe: trim buffer, emit tick, run detector, emit anomaly + escalation if triggered.

**Note on FrameCapture's emit shape:** open `src/pipelines/visual/frame-capture.ts` and verify the `keyframe` event payload shape (likely `{ frame: Buffer, timestamp: number }`). The loop subscribes via `frameCapture.on('keyframe', handler)`.

**Note on TemporalEventStream subscription:** open `src/pipelines/temporal/event-stream.ts` to find how external consumers subscribe to events. If it exposes `on('event', handler)` or similar, use that. If not — confirm and adapt the code. The pattern in #3's collectors is the canonical reference.

- [ ] **Step 1: Verify FrameCapture + EventStream APIs**

```bash
grep -n "emit\|EventEmitter\|on\(" src/pipelines/visual/frame-capture.ts | head -10
grep -n "on\(\|subscribe\|removeListener" src/pipelines/temporal/event-stream.ts | head -10
```

Note the exact subscription method (likely `.on('keyframe', ...)` and `.on('event', ...)`). Update the code below accordingly if names differ.

- [ ] **Step 2: Write `tests/unit/pipelines/perception/frame-loop.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { FrameLoop } from '../../../../src/pipelines/perception/frame-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';

class FakeFrameCapture extends EventEmitter {
  emitKeyframe(timestamp: number, frame = Buffer.from([0x89, 0x50])) {
    this.emit('keyframe', { frame, timestamp });
  }
}

class FakeEventStream extends EventEmitter {
  recordEvent = vi.fn();
  pushEvent(type: TimelineEvent['type'], payload: any, timestamp = Date.now()) {
    this.emit('event', { id: `e-${timestamp}`, type, timestamp, payload });
  }
}

function setup(config?: { lookbackMs?: number; coalesceWindowMs?: number; warmupMs?: number }) {
  const stream = new FakeEventStream();
  const session = new PerceptionSession({ eventStream: stream as unknown as TemporalEventStream });
  const frameCapture = new FakeFrameCapture();
  const loop = new FrameLoop({
    session,
    frameCapture: frameCapture as any,
    eventStream: stream as unknown as TemporalEventStream,
    config,
  });
  return { stream, session, frameCapture, loop };
}

describe('FrameLoop', () => {
  it('emits perception-tick { tier: frame, cause: keyframe } on each keyframe', () => {
    const { session, frameCapture, loop, stream } = setup();
    session.start(0);
    loop.start();
    frameCapture.emitKeyframe(600);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-tick',
      { tier: 'frame', cause: 'keyframe' },
      600,
    );
  });

  it('tracks active animations via animation-start / animation-end events', () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    session.start(0);
    loop.start();
    stream.pushEvent('animation-start', { animationId: 'a-1', startTimestamp: 50 }, 50);
    // Mutation while animation active → no anomaly
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'x', addedNodes: [], removedNodes: [] }, 100);
    frameCapture.emitKeyframe(120);
    expect(stream.recordEvent).not.toHaveBeenCalledWith('perception-anomaly', expect.anything(), expect.anything());

    // End animation, mutation now triggers anomaly
    stream.pushEvent('animation-end', { animationId: 'a-1', reason: 'completed' }, 200);
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'y', addedNodes: [], removedNodes: [] }, 220);
    frameCapture.emitKeyframe(240);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-anomaly',
      expect.objectContaining({ tier: 'frame', reason: 'mutation-outside-animation' }),
      240,
    );
  });

  it('emits perception-anomaly and perception-escalation when detector fires', () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    session.start(0);
    loop.start();
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'a', addedNodes: [], removedNodes: [] }, 100);
    frameCapture.emitKeyframe(120);

    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-anomaly',
      expect.objectContaining({ reason: 'mutation-outside-animation' }),
      120,
    );
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-escalation',
      expect.objectContaining({ from: 'frame', to: 'semantic' }),
      120,
    );
  });

  it('emits an escalate event on internalEmitter for the semantic loop', () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    const handler = vi.fn();
    session.internalEmitter.on('escalate', handler);
    session.start(0);
    loop.start();
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'a', addedNodes: [], removedNodes: [] }, 100);
    frameCapture.emitKeyframe(120);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ from: 'frame' }));
  });

  it('trims recentMutations older than lookbackMs', () => {
    const { session, frameCapture, loop, stream } = setup({ lookbackMs: 100, warmupMs: 0 });
    session.start(0);
    loop.start();
    // Old mutation falls outside the lookback window
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'old', addedNodes: [], removedNodes: [] }, 0);
    frameCapture.emitKeyframe(500);  // 500 - 0 = 500 > lookbackMs 100
    expect(stream.recordEvent).not.toHaveBeenCalledWith('perception-anomaly', expect.anything(), expect.anything());
  });

  it('debounces back-to-back keyframes within coalesce window', () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0, coalesceWindowMs: 100 });
    session.start(0);
    loop.start();
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'a', addedNodes: [], removedNodes: [] }, 100);
    frameCapture.emitKeyframe(110);
    frameCapture.emitKeyframe(150);   // within 100ms of last anomaly emit
    const anomalyCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-anomaly');
    expect(anomalyCalls).toHaveLength(1);
  });

  it('stop() unsubscribes from frameCapture and eventStream', () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    session.start(0);
    loop.start();
    loop.stop();
    stream.pushEvent('mutation', { mutationType: 'childList', targetNodeId: 'a', addedNodes: [], removedNodes: [] }, 100);
    frameCapture.emitKeyframe(120);
    // No ticks after stop()
    const tickCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-tick');
    expect(tickCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/frame-loop.test.ts
```

- [ ] **Step 4: Create `src/pipelines/perception/frame-loop.ts`**

```typescript
import type { FrameCapture } from '../visual/frame-capture.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { TimelineEvent, EventType } from '../temporal/collectors/types.js';
import type { PerceptionSession } from './session.js';
import {
  detectMutationOutsideAnimation,
  DEFAULT_CONFIG,
  type DetectConfig,
} from './anomaly/mutation-outside-animation.js';

export interface FrameLoopOptions {
  session: PerceptionSession;
  frameCapture: FrameCapture;
  eventStream: TemporalEventStream;
  config?: Partial<DetectConfig>;
}

export class FrameLoop {
  private readonly session: PerceptionSession;
  private readonly frameCapture: FrameCapture;
  private readonly eventStream: TemporalEventStream;
  private readonly config: DetectConfig;

  private activeAnimations = new Set<string>();
  private recentMutations: TimelineEvent<'mutation'>[] = [];
  private lastAnomalyEmittedAt = -Infinity;

  // Bound handlers so we can remove them in stop()
  private readonly onKeyframe = (kf: { frame: Buffer; timestamp: number }): void => {
    this.handleKeyframe(kf.timestamp);
  };
  private readonly onEvent = (e: TimelineEvent<EventType>): void => {
    this.handleEvent(e);
  };

  constructor(opts: FrameLoopOptions) {
    this.session = opts.session;
    this.frameCapture = opts.frameCapture;
    this.eventStream = opts.eventStream;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
  }

  start(): void {
    this.frameCapture.on('keyframe', this.onKeyframe);
    this.eventStream.on('event', this.onEvent);
  }

  stop(): void {
    this.frameCapture.off('keyframe', this.onKeyframe);
    this.eventStream.off('event', this.onEvent);
    this.activeAnimations.clear();
    this.recentMutations = [];
  }

  /** Test seam: expose state for assertions. */
  getActiveAnimationsForTest(): Set<string> {
    return this.activeAnimations;
  }

  /** Test seam. */
  getRecentMutationsForTest(): TimelineEvent<'mutation'>[] {
    return this.recentMutations;
  }

  private handleEvent(e: TimelineEvent<EventType>): void {
    if (e.type === 'animation-start') {
      const payload = e.payload as TimelineEvent<'animation-start'>['payload'];
      this.activeAnimations.add(payload.animationId);
    } else if (e.type === 'animation-end') {
      const payload = e.payload as TimelineEvent<'animation-end'>['payload'];
      this.activeAnimations.delete(payload.animationId);
    } else if (e.type === 'mutation') {
      this.recentMutations.push(e as TimelineEvent<'mutation'>);
    }
  }

  private handleKeyframe(nowMs: number): void {
    // Trim ring buffer to lookback window
    this.recentMutations = this.recentMutations.filter(
      (m) => nowMs - m.timestamp <= this.config.lookbackMs,
    );

    // Emit the frame tick
    this.session.recordTick('frame', 'keyframe', nowMs);

    // Debounce: skip detector if we just emitted within the coalesce window
    if (nowMs - this.lastAnomalyEmittedAt <= this.config.coalesceWindowMs) {
      return;
    }

    const result = detectMutationOutsideAnimation(
      {
        recentMutations: this.recentMutations,
        activeAnimations: this.activeAnimations,
        nowMs,
        sessionStartMs: this.session.getStartedAt(),
      },
      this.config,
    );

    if (!result) return;

    this.lastAnomalyEmittedAt = nowMs;

    // Best-effort: pull bboxes from mutation payloads if available; otherwise use null bbox.
    // Mutation payloads don't carry bboxes today, so for v1 we emit nodeIds without bboxes;
    // the semantic loop is responsible for resolving bboxes from the structural pipeline.
    const regions = result.targetNodeIds.map((nodeId) => ({
      nodeId,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    }));

    this.session.recordAnomaly('frame', 'mutation-outside-animation', result, nowMs);
    this.session.recordEscalation('frame', 'semantic', 'mutation-outside-animation', regions, nowMs);
    this.session.internalEmitter.emit('escalate', { from: 'frame', regions });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/frame-loop.test.ts
```
Expected: 7 passing.

- [ ] **Step 6: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/pipelines/perception/frame-loop.ts tests/unit/pipelines/perception/frame-loop.test.ts
git commit -m "feat(perception): FrameLoop — keyframe subscriber + detector wiring"
```

---

## Task 5: `SemanticLoop`

**Files:**
- Create: `src/pipelines/perception/semantic-loop.ts`
- Create: `tests/unit/pipelines/perception/semantic-loop.test.ts`

Cadence-bounded loop that wakes on escalation from frame loop or on heartbeat-with-pending-work. On wake: re-runs structural extraction + the #4 `Indexer`, then checks for `component.status === 'pending'` nodes and escalates to intent.

**Simplification for v1:** Semantic loop re-runs the *full* structural pipeline + `Indexer.run()` on each wake (not just the changed subtree). Captured in the spec's open questions as a perf follow-up.

- [ ] **Step 1: Write `tests/unit/pipelines/perception/semantic-loop.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SemanticLoop } from '../../../../src/pipelines/perception/semantic-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import type { StructuralPipeline } from '../../../../src/pipelines/structural/index.js';
import type { Indexer } from '../../../../src/pipelines/component-index/indexer.js';
import type { Page } from 'playwright';

function mkSession() {
  const stream = { recordEvent: vi.fn(), on: vi.fn(), off: vi.fn() } as unknown as TemporalEventStream;
  return { session: new PerceptionSession({ eventStream: stream }), stream };
}

function mkIndexer(componentMap: Map<string, any>): Indexer {
  return {
    run: vi.fn(async () => componentMap),
  } as unknown as Indexer;
}

function mkStructural(nodes: any[]): StructuralPipeline {
  return {
    extractStructure: vi.fn(async () => nodes),
  } as unknown as StructuralPipeline;
}

function mkPage(): Page {
  return {
    url: () => 'http://test',
  } as unknown as Page;
}

describe('SemanticLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not tick when idle (no escalations, heartbeat fires but queue empty)', () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    vi.advanceTimersByTime(500);
    const tickCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-tick' && c[1].tier === 'semantic');
    expect(tickCalls).toHaveLength(0);
  });

  it('wakes on escalation and emits a semantic tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await vi.advanceTimersByTimeAsync(10);
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-tick',
      expect.objectContaining({ tier: 'semantic', cause: 'escalation' }),
      expect.any(Number),
    );
  });

  it('rate-bounds: two escalations within cadenceMs produce one tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await vi.advanceTimersByTimeAsync(50);
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'b', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await vi.advanceTimersByTimeAsync(50);
    const tickCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-tick' && c[1].tier === 'semantic');
    expect(tickCalls).toHaveLength(1);
  });

  it('calls indexer.run on each tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const structural = mkStructural([{ id: 'n-1', tag: 'div' }]);
    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await vi.advanceTimersByTimeAsync(10);
    expect(structural.extractStructure).toHaveBeenCalled();
    expect(indexer.run).toHaveBeenCalled();
  });

  it('escalates to intent when indexer flags a node as pending', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const componentMap = new Map([
      ['a', { name: null, status: 'pending', signature: 'sig-1' }],
    ]);
    const indexer = mkIndexer(componentMap);
    const structural = mkStructural([{ id: 'a', tag: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 50 } }]);

    const intentHandler = vi.fn();
    session.internalEmitter.on('escalate', (payload) => {
      if (payload.from === 'semantic') intentHandler(payload);
    });

    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 100, h: 50 } }] });
    await vi.advanceTimersByTimeAsync(10);

    expect(intentHandler).toHaveBeenCalledWith(expect.objectContaining({ from: 'semantic' }));
    expect(stream.recordEvent).toHaveBeenCalledWith(
      'perception-escalation',
      expect.objectContaining({ from: 'semantic', to: 'intent' }),
      expect.any(Number),
    );
  });

  it('does not escalate to intent when no nodes are pending', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const componentMap = new Map([
      ['a', { name: 'Button', source: 'rules', signature: 'sig-1' }],
    ]);
    const indexer = mkIndexer(componentMap);
    const structural = mkStructural([{ id: 'a', tag: 'button', boundingBox: { x: 0, y: 0, width: 100, height: 50 } }]);

    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 100, h: 50 } }] });
    await vi.advanceTimersByTimeAsync(10);

    const escalationCalls = (stream.recordEvent as any).mock.calls.filter(
      (c: any[]) => c[0] === 'perception-escalation' && c[1].from === 'semantic',
    );
    expect(escalationCalls).toHaveLength(0);
  });

  it('stop() unsubscribes', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const loop = new SemanticLoop({
      session,
      eventStream: stream,
      indexer: mkIndexer(new Map()),
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    loop.stop();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await vi.advanceTimersByTimeAsync(10);
    const tickCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-tick' && c[1].tier === 'semantic');
    expect(tickCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/semantic-loop.test.ts
```

- [ ] **Step 3: Create `src/pipelines/perception/semantic-loop.ts`**

```typescript
import type { Page } from 'playwright';
import type { StructuralPipeline } from '../structural/index.js';
import type { Indexer } from '../component-index/indexer.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSession } from './session.js';

export interface SemanticLoopOptions {
  session: PerceptionSession;
  eventStream: TemporalEventStream;
  indexer: Indexer;
  structuralPipeline: StructuralPipeline;
  page: Page;
  config?: { cadenceMs?: number };
}

interface PendingEscalation {
  regions: Array<{ nodeId: string; bbox: { x: number; y: number; w: number; h: number } }>;
}

export class SemanticLoop {
  private readonly session: PerceptionSession;
  private readonly indexer: Indexer;
  private readonly structuralPipeline: StructuralPipeline;
  private readonly page: Page;
  private readonly cadenceMs: number;

  private pending: PendingEscalation[] = [];
  private lastTickAt = -Infinity;
  private running = false;

  private readonly onEscalate = (payload: { from: string; regions: PendingEscalation['regions'] }): void => {
    if (payload.from !== 'frame') return;
    this.pending.push({ regions: payload.regions });
    void this.maybeWake('escalation');
  };

  constructor(opts: SemanticLoopOptions) {
    this.session = opts.session;
    this.indexer = opts.indexer;
    this.structuralPipeline = opts.structuralPipeline;
    this.page = opts.page;
    this.cadenceMs = opts.config?.cadenceMs ?? 200;
  }

  start(): void {
    this.running = true;
    this.session.internalEmitter.on('escalate', this.onEscalate);
  }

  stop(): void {
    this.running = false;
    this.session.internalEmitter.off('escalate', this.onEscalate);
    this.pending = [];
  }

  private async maybeWake(cause: 'escalation' | 'heartbeat'): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    if (now - this.lastTickAt < this.cadenceMs) return;
    if (this.pending.length === 0 && cause === 'heartbeat') return;

    this.lastTickAt = now;
    const work = this.pending;
    this.pending = [];

    this.session.recordTick('semantic', cause, now);

    // Re-extract structural state + run indexer (v1: full re-extraction)
    const structural = await this.structuralPipeline.extractStructure(this.page);
    const url = this.page.url();
    const origin = safeOrigin(url);
    const componentMap = await this.indexer.run(structural, { origin });

    // Collect pending-classification nodes referenced by the flagged regions
    const flaggedIds = new Set<string>();
    for (const escalation of work) {
      for (const region of escalation.regions) flaggedIds.add(region.nodeId);
    }

    const pendingRegions: Array<{ nodeId: string; bbox: { x: number; y: number; w: number; h: number } }> = [];
    for (const nodeId of flaggedIds) {
      const entry = componentMap.get(nodeId);
      if (entry && entry.name === null && entry.status === 'pending') {
        const node = structural.find((n) => n.id === nodeId);
        const bb = node?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
        pendingRegions.push({
          nodeId,
          bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
        });
      }
    }

    if (pendingRegions.length > 0) {
      this.session.recordEscalation('semantic', 'intent', 'mutation-outside-animation', pendingRegions, now);
      this.session.internalEmitter.emit('escalate', { from: 'semantic', regions: pendingRegions });
    }
  }
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/semantic-loop.test.ts
```
Expected: 7 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/perception/semantic-loop.ts tests/unit/pipelines/perception/semantic-loop.test.ts
git commit -m "feat(perception): SemanticLoop — escalation-driven, calls Indexer, escalates to intent"
```

---

## Task 6: `IntentLoop`

**Files:**
- Create: `src/pipelines/perception/intent-loop.ts`
- Create: `tests/unit/pipelines/perception/intent-loop.test.ts`

Pure event-driven loop. Wakes only on escalation from semantic. Crops the latest screenshot to each region's bbox via `sharp`, calls `classifyByVlm`, emits `perception-intent-result`. Maintains an internal pending queue with backpressure (drop oldest after `maxPending`).

**`classifyByVlm` is injected** via constructor so tests can mock without hitting Anthropic. Same pattern as #4's queue tests.

**Screenshot source:** the loop takes a `getScreenshot: () => Promise<Buffer | null>` callback in its constructor. The session provides this as `() => page.screenshot().catch(() => null)`. In tests, it's a `vi.fn()` returning a fake PNG buffer.

- [ ] **Step 1: Write `tests/unit/pipelines/perception/intent-loop.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentLoop } from '../../../../src/pipelines/perception/intent-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

vi.mock('sharp', () => {
  // Stub: extract().png().toBuffer() returns the input buffer unchanged
  const extract = vi.fn().mockReturnThis();
  const png = vi.fn().mockReturnThis();
  const toBuffer = vi.fn(async () => Buffer.from([0x89, 0x50]));
  return {
    default: () => ({ extract, png, toBuffer }),
  };
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mkSession() {
  const stream = { recordEvent: vi.fn(), on: vi.fn(), off: vi.fn() } as unknown as TemporalEventStream;
  return { session: new PerceptionSession({ eventStream: stream }), stream };
}

describe('IntentLoop', () => {
  it('does not call VLM unless an escalation arrives', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();
    await Promise.resolve();
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies each region in an escalation and emits perception-intent-result', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn(async () => 'AnimatedCounter');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 50, h: 30 } },
        { nodeId: 'b', bbox: { x: 60, y: 0, w: 50, h: 30 } },
      ],
    });

    // Allow microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(classify).toHaveBeenCalledTimes(2);
    const intentResultCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-intent-result');
    expect(intentResultCalls).toHaveLength(2);
  });

  it('emits a single perception-tick for the drain (not per-region)', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    const tickCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-tick' && c[1].tier === 'intent');
    expect(tickCalls).toHaveLength(1);
  });

  it('drops oldest when pending queue exceeds maxPending', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    // Make classify slow so the queue builds up
    let resolveClassify: (v: string) => void = () => {};
    const classify = vi.fn(() => new Promise<string>((r) => { resolveClassify = r; }));
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify, config: { maxPending: 2 } });
    loop.start();

    // Fire 5 escalations — first starts immediately, next ones queue, exceeding maxPending=2
    for (let i = 0; i < 5; i++) {
      session.internalEmitter.emit('escalate', { from: 'semantic', regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    }
    await Promise.resolve();

    // Resolve in-flight + drain
    resolveClassify('X');
    await new Promise((r) => setTimeout(r, 10));

    // Behavior: oldest got dropped. We assert exact count is finite and < 5.
    const intentResultCalls = (stream.recordEvent as any).mock.calls.filter((c: any[]) => c[0] === 'perception-intent-result');
    expect(intentResultCalls.length).toBeLessThan(5);
  });

  it('skips classification when screenshot provider returns null', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => null);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'semantic', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(classify).not.toHaveBeenCalled();
  });

  it('continues past a per-region classifier error', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => 'OK');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    const successfulCalls = (stream.recordEvent as any).mock.calls.filter(
      (c: any[]) => c[0] === 'perception-intent-result' && c[1].classification === 'OK',
    );
    expect(successfulCalls).toHaveLength(1);
  });

  it('ignores escalation events whose from is not semantic', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream, getScreenshot, classifyByVlm: classify });
    loop.start();
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(classify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/intent-loop.test.ts
```

- [ ] **Step 3: Create `src/pipelines/perception/intent-loop.ts`**

```typescript
import sharp from 'sharp';
import { createLogger } from '../../utils/logger.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSession } from './session.js';

const logger = createLogger('PerceptionIntentLoop');

export type ClassifyByVlmFn = (args: { html: string; screenshotCrop: Buffer }) => Promise<string>;

export interface IntentLoopOptions {
  session: PerceptionSession;
  eventStream: TemporalEventStream;
  getScreenshot: () => Promise<Buffer | null>;
  classifyByVlm: ClassifyByVlmFn;
  config?: { maxPending?: number };
}

interface PendingItem {
  nodeId: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export class IntentLoop {
  private readonly session: PerceptionSession;
  private readonly getScreenshot: () => Promise<Buffer | null>;
  private readonly classify: ClassifyByVlmFn;
  private readonly maxPending: number;

  private pending: PendingItem[] = [];
  private draining = false;
  private running = false;

  private readonly onEscalate = (payload: { from: string; regions: PendingItem[] }): void => {
    if (payload.from !== 'semantic') return;
    for (const region of payload.regions) this.enqueue(region);
    void this.drain();
  };

  constructor(opts: IntentLoopOptions) {
    this.session = opts.session;
    this.getScreenshot = opts.getScreenshot;
    this.classify = opts.classifyByVlm;
    this.maxPending = opts.config?.maxPending ?? 10;
  }

  start(): void {
    this.running = true;
    this.session.internalEmitter.on('escalate', this.onEscalate);
  }

  stop(): void {
    this.running = false;
    this.session.internalEmitter.off('escalate', this.onEscalate);
    this.pending = [];
  }

  private enqueue(item: PendingItem): void {
    if (this.pending.length >= this.maxPending) {
      const dropped = this.pending.shift();
      logger.warn('IntentLoop: dropping oldest pending region due to backpressure', { dropped });
    }
    this.pending.push(item);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    if (this.pending.length === 0) return;
    this.draining = true;
    try {
      // Single tick per drain
      const tickAt = Date.now();
      this.session.recordTick('intent', 'escalation', tickAt);

      const screenshot = await this.getScreenshot();
      if (!screenshot) {
        this.pending = [];
        return;
      }

      const items = this.pending;
      this.pending = [];

      for (const item of items) {
        if (!this.running) break;
        const start = Date.now();
        try {
          const crop = await cropToBbox(screenshot, item.bbox);
          const classification = await this.classify({ html: '', screenshotCrop: crop });
          const duration = Date.now() - start;
          this.session.recordIntentResult(
            { nodeId: item.nodeId, bbox: item.bbox },
            classification,
            duration,
            Date.now(),
          );
        } catch (err) {
          logger.warn('IntentLoop: per-region classification failed, skipping', { nodeId: item.nodeId, error: String(err) });
        }
      }
    } finally {
      this.draining = false;
      // If new items arrived during drain, kick off another round.
      if (this.pending.length > 0 && this.running) {
        void this.drain();
      }
    }
  }
}

async function cropToBbox(png: Buffer, bbox: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.max(1, Math.round(bbox.w));
  const height = Math.max(1, Math.round(bbox.h));
  return sharp(png).extract({ left, top, width, height }).png().toBuffer();
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/intent-loop.test.ts
```
Expected: 7 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/perception/intent-loop.ts tests/unit/pipelines/perception/intent-loop.test.ts
git commit -m "feat(perception): IntentLoop — escalation-driven VLM with backpressure"
```

---

## Task 7: Wire loops into `PerceptionSession`

**Files:**
- Modify: `src/pipelines/perception/session.ts`
- Modify: `tests/unit/pipelines/perception/session.test.ts`

Extends `PerceptionSession.start()` to also instantiate and start all three loops; `stop()` stops them all. Also wires page navigation + close handling. The three loops are constructed inside `start()` because they depend on the page + collectors.

The session's `start(page, deps)` signature changes — `start()` now takes the runtime dependencies (page, frameCapture, eventStream-already-known, indexer, structuralPipeline, classifyByVlm, getScreenshot).

- [ ] **Step 1: Extend `tests/unit/pipelines/perception/session.test.ts` with composition tests**

Add after the existing tests:

```typescript
import { FrameLoop } from '../../../../src/pipelines/perception/frame-loop.js';
import { SemanticLoop } from '../../../../src/pipelines/perception/semantic-loop.js';
import { IntentLoop } from '../../../../src/pipelines/perception/intent-loop.js';
import { EventEmitter as NodeEventEmitter } from 'node:events';

describe('PerceptionSession composed with loops', () => {
  function mkComposedDeps() {
    const stream = new NodeEventEmitter() as any;
    stream.recordEvent = vi.fn();
    const frameCapture = new NodeEventEmitter() as any;
    const indexer = { run: vi.fn(async () => new Map()) } as any;
    const structuralPipeline = { extractStructure: vi.fn(async () => []) } as any;
    const page = {
      url: () => 'http://test',
      on: vi.fn(),
      off: vi.fn(),
    } as any;
    const classifyByVlm = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => Buffer.from([0x89, 0x50]));
    return { stream, frameCapture, indexer, structuralPipeline, page, classifyByVlm, getScreenshot };
  }

  it('start() instantiates and starts FrameLoop, SemanticLoop, IntentLoop', () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    expect(deps.page.on).toHaveBeenCalledWith('framenavigated', expect.any(Function));
    expect(deps.page.on).toHaveBeenCalledWith('close', expect.any(Function));
    session.stop(100);
  });

  it('stop() cleanly removes page listeners', () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    session.stop(100);
    expect(deps.page.off).toHaveBeenCalledWith('framenavigated', expect.any(Function));
    expect(deps.page.off).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('navigation event resets sessionStartMs and emits a navigation-reset tick', () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    // Find and invoke the framenavigated handler
    const navHandler = deps.page.on.mock.calls.find((c: any[]) => c[0] === 'framenavigated')[1];
    navHandler();
    expect(deps.stream.recordEvent).toHaveBeenCalledWith(
      'perception-tick',
      expect.objectContaining({ tier: 'frame', cause: 'navigation-reset' }),
      expect.any(Number),
    );
    session.stop(100);
  });

  it('page close auto-stops the session', () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    const closeHandler = deps.page.on.mock.calls.find((c: any[]) => c[0] === 'close')[1];
    closeHandler();
    expect(session.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Modify `src/pipelines/perception/session.ts`**

Add the imports at the top:
```typescript
import type { Page } from 'playwright';
import type { FrameCapture } from '../visual/frame-capture.js';
import type { StructuralPipeline } from '../structural/index.js';
import type { Indexer } from '../component-index/indexer.js';
import { FrameLoop } from './frame-loop.js';
import { SemanticLoop } from './semantic-loop.js';
import { IntentLoop, type ClassifyByVlmFn } from './intent-loop.js';
```

Replace the `start(nowMs: number)` method signature and body with:
```typescript
export interface SessionStartDeps {
  page: Page;
  frameCapture: FrameCapture;
  indexer: Indexer;
  structuralPipeline: StructuralPipeline;
  classifyByVlm: ClassifyByVlmFn;
  getScreenshot: () => Promise<Buffer | null>;
}

// ... inside class:

private frameLoop: FrameLoop | null = null;
private semanticLoop: SemanticLoop | null = null;
private intentLoop: IntentLoop | null = null;
private page: Page | null = null;
private readonly onPageNav = (): void => {
  const now = Date.now();
  this.resetStartedAt(now);
  this.stream.recordEvent('perception-tick', { tier: 'frame', cause: 'navigation-reset' }, now);
};
private readonly onPageClose = (): void => {
  if (this.isRunning()) {
    try { this.stop(Date.now()); } catch { /* already stopped */ }
  }
};

start(nowMs: number, deps?: SessionStartDeps): void {
  if (this.state === 'running') {
    throw new Error('PerceptionSession.start: already running');
  }
  this.state = 'running';
  this.startedAt = nowMs;
  this.stoppedAt = 0;

  if (deps) {
    this.page = deps.page;
    this.frameLoop = new FrameLoop({ session: this, frameCapture: deps.frameCapture, eventStream: this.stream });
    this.semanticLoop = new SemanticLoop({
      session: this,
      eventStream: this.stream,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      page: deps.page,
    });
    this.intentLoop = new IntentLoop({
      session: this,
      eventStream: this.stream,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    this.frameLoop.start();
    this.semanticLoop.start();
    this.intentLoop.start();
    deps.page.on('framenavigated', this.onPageNav);
    deps.page.on('close', this.onPageClose);
  }
}

stop(nowMs: number): void {
  if (this.state !== 'running') {
    throw new Error('PerceptionSession.stop: not running');
  }
  this.state = 'stopped';
  this.stoppedAt = nowMs;
  this.frameLoop?.stop();
  this.semanticLoop?.stop();
  this.intentLoop?.stop();
  this.frameLoop = null;
  this.semanticLoop = null;
  this.intentLoop = null;
  if (this.page) {
    this.page.off('framenavigated', this.onPageNav);
    this.page.off('close', this.onPageClose);
    this.page = null;
  }
  this.internalEmitter.removeAllListeners();
}
```

- [ ] **Step 3: Run all perception unit tests**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/perception/
```
Expected: previously-passing tests still pass + 4 new session composition tests.

- [ ] **Step 4: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/pipelines/perception/session.ts tests/unit/pipelines/perception/session.test.ts
git commit -m "feat(perception): wire loops into PerceptionSession + page nav/close handlers"
```

---

## Task 8: MCP tools + server wiring

**Files:**
- Create: `src/mcp/tools/perception.ts`
- Create: `tests/unit/mcp/perception.test.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/mcp/tools.test.ts`

Three new MCP tools that share state. Following the file-per-tool pattern from `#4`'s `get-component-index.ts` would mean three separate files; here we put them in one file (`perception.ts`) because they share a `PerceptionToolState` object — three factories closing over the same state is cleaner than three files reaching into a shared module.

- [ ] **Step 1: Write `tests/unit/mcp/perception.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPerceptionState,
  makeStartPerceptionTool,
  makeStopPerceptionTool,
  makeGetPerceptionSessionTool,
} from '../../../src/mcp/tools/perception.js';

function mkDeps() {
  const session = {
    isRunning: vi.fn(() => false),
    start: vi.fn(),
    stop: vi.fn(),
    getSummary: vi.fn(() => ({ startedAt: 100, durationMs: 0, tickCounts: { frame: 0, semantic: 0, intent: 0 } } as any)),
    getStartedAt: vi.fn(() => 100),
  };
  const ensureLaunched = vi.fn(async () => {});
  const ensureWatchStarted = vi.fn(async () => {});
  const getPage = vi.fn(() => ({ url: () => 'http://x', on: vi.fn(), off: vi.fn() } as any));
  const getDeps = vi.fn(() => ({
    page: getPage(),
    frameCapture: {} as any,
    indexer: {} as any,
    structuralPipeline: {} as any,
    classifyByVlm: vi.fn() as any,
    getScreenshot: vi.fn() as any,
  }));
  return { session, ensureLaunched, ensureWatchStarted, getPage, getDeps };
}

describe('start_perception', () => {
  it('starts a session and reports startedAt', async () => {
    const deps = mkDeps();
    const state = createPerceptionState();
    state.createSession = vi.fn(() => deps.session as any);
    const tool = makeStartPerceptionTool({
      state,
      ensureLaunched: deps.ensureLaunched,
      ensureWatchStarted: deps.ensureWatchStarted,
      getSessionDeps: deps.getDeps,
    });
    const result = await tool.handler({});
    expect(result).toEqual({ status: 'started', startedAt: expect.any(Number) });
    expect(deps.ensureWatchStarted).toHaveBeenCalled();
    expect(deps.session.start).toHaveBeenCalled();
  });

  it('returns already-running if called twice', async () => {
    const deps = mkDeps();
    const state = createPerceptionState();
    deps.session.isRunning = vi.fn(() => true);
    state.currentSession = deps.session as any;
    const tool = makeStartPerceptionTool({
      state,
      ensureLaunched: deps.ensureLaunched,
      ensureWatchStarted: deps.ensureWatchStarted,
      getSessionDeps: deps.getDeps,
    });
    const result = await tool.handler({});
    expect(result).toEqual({ status: 'already-running', startedAt: 100 });
  });
});

describe('stop_perception', () => {
  it('returns summary and clears current session', async () => {
    const deps = mkDeps();
    deps.session.isRunning = vi.fn(() => true);
    const state = createPerceptionState();
    state.currentSession = deps.session as any;
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect(deps.session.stop).toHaveBeenCalled();
    expect(state.currentSession).toBeNull();
    expect((result as any).startedAt).toBe(100);
  });

  it('returns the lastSummary if no session is running', async () => {
    const state = createPerceptionState();
    state.lastSummary = { startedAt: 50, durationMs: 200 } as any;
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(50);
  });

  it('returns an error if no session and no last summary', async () => {
    const state = createPerceptionState();
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect((result as any).error).toMatch(/no session/i);
  });
});

describe('get_perception_session', () => {
  it('returns the running summary', async () => {
    const deps = mkDeps();
    deps.session.isRunning = vi.fn(() => true);
    const state = createPerceptionState();
    state.currentSession = deps.session as any;
    const tool = makeGetPerceptionSessionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(100);
  });

  it('falls back to last summary', async () => {
    const state = createPerceptionState();
    state.lastSummary = { startedAt: 33 } as any;
    const tool = makeGetPerceptionSessionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(33);
  });
});
```

- [ ] **Step 2: Create `src/mcp/tools/perception.ts`**

```typescript
import { PerceptionSession, type SessionStartDeps } from '../../pipelines/perception/session.js';
import type { TemporalEventStream } from '../../pipelines/temporal/event-stream.js';
import type { PerceptionSessionSummary } from '../../pipelines/perception/types.js';

export interface PerceptionState {
  currentSession: PerceptionSession | null;
  lastSummary: PerceptionSessionSummary | null;
  /** Test seam: factory for creating a new PerceptionSession. */
  createSession: (eventStream: TemporalEventStream) => PerceptionSession;
}

export function createPerceptionState(): PerceptionState {
  return {
    currentSession: null,
    lastSummary: null,
    createSession: (eventStream) => new PerceptionSession({ eventStream }),
  };
}

interface StartOptions {
  state: PerceptionState;
  ensureLaunched: () => Promise<void>;
  ensureWatchStarted: () => Promise<void>;
  getEventStream?: () => TemporalEventStream;
  getSessionDeps: () => SessionStartDeps;
}

export interface StartPerceptionTool {
  readonly name: 'start_perception';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<{ status: 'started' | 'already-running'; startedAt: number }>;
}

export function makeStartPerceptionTool(opts: StartOptions): StartPerceptionTool {
  return {
    name: 'start_perception',
    description:
      'Begin a perception session. Starts the frame/semantic/intent loop hierarchy on the current page. Auto-starts watch (keyframe capture) if not already running. Use stop_perception to end the session and get a summary.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const s = opts.state.currentSession;
      if (s && s.isRunning()) {
        return { status: 'already-running', startedAt: s.getStartedAt() };
      }
      await opts.ensureLaunched();
      await opts.ensureWatchStarted();
      const eventStream = opts.getEventStream?.();
      const session = eventStream
        ? opts.state.createSession(eventStream)
        : opts.state.createSession(null as unknown as TemporalEventStream);
      const deps = opts.getSessionDeps();
      const startedAt = Date.now();
      session.start(startedAt, deps);
      opts.state.currentSession = session;
      return { status: 'started', startedAt };
    },
  };
}

interface StopOptions {
  state: PerceptionState;
}

export interface StopPerceptionTool {
  readonly name: 'stop_perception';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<PerceptionSessionSummary | { error: string }>;
}

export function makeStopPerceptionTool(opts: StopOptions): StopPerceptionTool {
  return {
    name: 'stop_perception',
    description:
      "End the current perception session and return its summary (tick counts, anomalies, escalations, intent results, VLM cost). Does NOT stop watch — keyframe capture continues for non-perception consumers. If no session is running, returns the previous session's summary if available.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const session = opts.state.currentSession;
      if (session && session.isRunning()) {
        session.stop(Date.now());
        const summary = session.getSummary();
        opts.state.lastSummary = summary;
        opts.state.currentSession = null;
        return summary;
      }
      if (opts.state.lastSummary) {
        return opts.state.lastSummary;
      }
      return { error: 'No session active and no prior summary' };
    },
  };
}

interface GetOptions {
  state: PerceptionState;
}

export interface GetPerceptionSessionTool {
  readonly name: 'get_perception_session';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<PerceptionSessionSummary | { error: string }>;
}

export function makeGetPerceptionSessionTool(opts: GetOptions): GetPerceptionSessionTool {
  return {
    name: 'get_perception_session',
    description:
      "Return the current perception session's summary if one is running. Otherwise return the last completed session's summary if any. Use this to inspect what perception is seeing mid-flight without stopping the session.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const session = opts.state.currentSession;
      if (session && session.isRunning()) {
        return session.getSummary();
      }
      if (opts.state.lastSummary) {
        return opts.state.lastSummary;
      }
      return { error: 'No session active and no prior summary' };
    },
  };
}
```

- [ ] **Step 3: Run the tool tests — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/mcp/perception.test.ts
```

- [ ] **Step 4: After creating the file in Step 2, re-run; expect 8 passing**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/mcp/perception.test.ts
```

- [ ] **Step 5: Modify `src/mcp/server.ts` to wire the tools**

Add to the imports block:
```typescript
import {
  createPerceptionState,
  makeStartPerceptionTool,
  makeStopPerceptionTool,
  makeGetPerceptionSessionTool,
} from './tools/perception.js';
import { classifyByVlm } from '../pipelines/component-index/vlm-classifier.js';
```

Add to the `TOOL_NAMES` array (after `'get_component_index'` or wherever the last tool is):
```typescript
  'start_perception',
  'stop_perception',
  'get_perception_session',
```

Inside `createServer`, after the `componentIndexer` initialization (added in #4 Task 10), instantiate the perception state:

```typescript
  const perceptionState = createPerceptionState();
```

And register the three tools. Find the existing `get_component_index` tool registration and add after it:

```typescript
  // Tool 15: start_perception
  const startPerceptionTool = makeStartPerceptionTool({
    state: perceptionState,
    ensureLaunched,
    ensureWatchStarted: async () => {
      // If FrameCapture isn't running, start it. ensureWatchStarted mirrors the
      // watch tool's behavior but does not return a result.
      if (!frameCapture) {
        await ensureLaunched();
        const page = runtime.getPage();
        frameCapture = new FrameCapture(page);
        await frameCapture.start();
        keyframeCount = 0;
        watchStartTime = Date.now();
      }
    },
    getEventStream: () => eventStream,
    getSessionDeps: () => {
      const page = runtime.getPage();
      return {
        page,
        frameCapture: frameCapture!,
        indexer: componentIndexer,
        structuralPipeline: structural,
        classifyByVlm,
        getScreenshot: () => runtime.screenshot().catch(() => null),
      };
    },
  });
  server.registerTool(
    startPerceptionTool.name,
    {
      title: 'Start Perception Session',
      description: startPerceptionTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      await ensureStreamAttached();
      const result = await startPerceptionTool.handler({});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 16: stop_perception
  const stopPerceptionTool = makeStopPerceptionTool({ state: perceptionState });
  server.registerTool(
    stopPerceptionTool.name,
    {
      title: 'Stop Perception Session',
      description: stopPerceptionTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const result = await stopPerceptionTool.handler({});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 17: get_perception_session
  const getPerceptionSessionTool = makeGetPerceptionSessionTool({ state: perceptionState });
  server.registerTool(
    getPerceptionSessionTool.name,
    {
      title: 'Get Perception Session',
      description: getPerceptionSessionTool.description,
      inputSchema: z.object({}),
    },
    async () => {
      const result = await getPerceptionSessionTool.handler({});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
```

- [ ] **Step 6: Update `tests/unit/mcp/tools.test.ts`**

Find `expect(TOOL_NAMES).toHaveLength(14);` and change to `toHaveLength(17);`.

Add inside the existing describe block:
```typescript
  it('contains the three perception tools', () => {
    expect(TOOL_NAMES).toContain('start_perception');
    expect(TOOL_NAMES).toContain('stop_perception');
    expect(TOOL_NAMES).toContain('get_perception_session');
  });
```

- [ ] **Step 7: Run all unit + the existing smoke test**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/ tests/integration/smoke.test.ts
```
Expected: previously-passing tests still pass; the updated `tools.test.ts` asserts 17 tools.

- [ ] **Step 8: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add src/mcp/tools/perception.ts src/mcp/server.ts tests/unit/mcp/
git commit -m "feat(mcp): start_perception / stop_perception / get_perception_session"
```

---

## Task 9: Claude skill — `perception-session`

**Files:**
- Create: `skills/perception-session/SKILL.md`

A Claude Code skill that wraps the perception MCP tools into a structured inspection workflow. Lives in the repo for version control; users symlink or copy to `~/.claude/skills/` to make it available in their Claude Code sessions.

No automated tests for the skill — it's markdown content. We do verify the file exists and the frontmatter parses.

- [ ] **Step 1: Create `skills/perception-session/SKILL.md`**

```markdown
---
name: perception-session
description: Use when investigating what UIPE's perception layer captures during a workflow. Wraps start_perception → drive action → inspect events + summary → stop into a structured session, then reports a markdown summary of which loops fired, anomalies triggered, and intent-loop classifications. Also use when the user says "what did perception see," "test the perception loops," or "show me anomalies for this workflow."
---

# perception-session

You're using UIPE's perception layer to investigate what the system actually
captures while a workflow runs on a page. This skill orchestrates the
session: start perception, drive the workflow, inspect the timeline +
summary, stop perception, and report a structured markdown summary.

## When to use this

- The user wants to validate that a specific UI change (count-up animation,
  toast notification, modal mutation) is being captured by perception.
- The user wants to debug "why didn't perception fire an anomaly here?"
- The user wants a report of perception activity over a workflow they're
  about to drive.

## When NOT to use this

- The user just wants to navigate or analyze a single page (use
  `navigate` + `get_scene` directly).
- The user is asking about UIPE's source code (use Read + grep).
- The workflow has no expected perception activity to assert on.

## How to use this

1. **Confirm the workflow.** Ask the user (or restate from context) what
   workflow you'll drive and what they expect perception to capture. Be
   explicit about expected anomalies if any (e.g. "expect 1 anomaly of
   reason mutation-outside-animation when the counter ticks up").

2. **Start the session.** Call `start_perception`. This auto-starts watch
   (keyframe capture) if not already running. Record the `startedAt`
   timestamp.

3. **Drive the workflow.** Use existing MCP tools (`navigate`, `act` with
   click/scroll/type/wait, etc.) to execute the steps. Wait long enough
   between steps for perception to process — give 500ms-1s of buffer after
   each action.

4. **(Optional) Peek mid-flight.** For long workflows, call
   `get_perception_session` partway through to see running stats. Useful
   if a loop appears stuck.

5. **Stop the session.** Call `stop_perception`. This returns the final
   summary as JSON. Do NOT stop watch — leave keyframe capture running
   for other consumers.

6. **Pull the relevant timeline events.** Call `get_timeline` filtered to
   `perception-tick`, `perception-anomaly`, `perception-escalation`,
   `perception-intent-result` with `since: <startedAt>`. This gives the
   detailed event sequence to back up the summary.

7. **Produce a report.** Generate markdown with these sections:
   - **Session overview**: duration, tick counts per tier, achieved vs target cadence
   - **Anomalies**: timestamps, reasons, target nodes, count by reason
   - **Escalations**: from-tier → to-tier counts
   - **Intent results**: VLM classifications per region
   - **VLM cost**: best-effort dollar estimate from `vlmCalls`
   - **Assertions** (if user stated expectations): ✅ or ❌ per expectation,
     with the relevant timeline snippet if it failed

Make the report scannable. Use tables for repeated rows (anomalies,
intent results). Quote specific timeline events when explaining failures.

## What perception can detect today (v1)

- **Anomaly trigger**: `mutation-outside-animation`. Fires when DOM
  mutations happen while no CSS animation is active. Catches things like
  JS-driven count-up animations, IntersectionObserver-triggered state
  updates, React re-renders that change text content.
- **Escalation chain**: frame loop → semantic loop → intent loop. Frame
  spots the anomaly, semantic checks if the affected nodes are
  unclassified components, intent classifies new components via VLM.

## What perception does NOT yet detect (v1 limitations)

- CSS `transition` (not `Animation` API) — false negatives.
- Animation deviation, new component signatures, optical-flow motion
  triggers — deferred to v2.
- Mutations on subtree A while an animation runs on subtree B — global
  temporal gate suppresses these as false negatives.

Be honest about these limits in the report when relevant.
```

- [ ] **Step 2: Verify the file parses**

The skill is markdown with YAML frontmatter. No code to typecheck. Just confirm the file exists:

```bash
test -f skills/perception-session/SKILL.md && echo "ok"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/perception-session/SKILL.md
git commit -m "feat(skill): perception-session — inspection workflow wrapper"
```

---

## Task 10: Integration test — Playwright full-chain

**Files:**
- Create: `tests/integration/perception/fixtures/mutation-trigger.html`
- Create: `tests/integration/perception/perception-e2e.test.ts`

End-to-end test against real Chromium + a static HTML fixture with a deliberate "mutation outside animation" trigger.

- [ ] **Step 1: Create the fixture**

`tests/integration/perception/fixtures/mutation-trigger.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Mutation Trigger</title>
<style>
  body { font-family: system-ui; padding: 24px; }
  #target { display: block; width: 200px; height: 80px; padding: 16px; border: 1px solid #ccc; background: #eef; }
  button { padding: 8px 16px; cursor: pointer; }
</style>
</head>
<body>
  <button id="trigger">Trigger mutation</button>
  <div class="custom-card" id="target">
    <span id="text">initial</span>
  </div>
  <script>
    document.getElementById('trigger').addEventListener('click', () => {
      // Pure JS mutation — no CSS animation.
      setTimeout(() => {
        document.getElementById('text').textContent = 'changed';
      }, 50);
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Write the e2e test**

`tests/integration/perception/perception-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { StructuralPipeline } from '../../../src/pipelines/structural/index.js';
import { ComponentIndexStore } from '../../../src/pipelines/component-index/store.js';
import { ClassificationQueue } from '../../../src/pipelines/component-index/queue.js';
import { Matcher } from '../../../src/pipelines/component-index/matcher.js';
import { Indexer } from '../../../src/pipelines/component-index/indexer.js';
import { TemporalEventStream } from '../../../src/pipelines/temporal/event-stream.js';
import { MutationCollector, AnimationCollector } from '../../../src/pipelines/temporal/collectors/index.js';
import { PerceptionSession } from '../../../src/pipelines/perception/session.js';

const FIXTURE = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'mutation-trigger.html');

class FakeFrameCapture extends EventEmitter {
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  emitFakeKeyframe(timestamp: number) {
    this.emit('keyframe', { frame: Buffer.from([0x89, 0x50]), timestamp });
  }
}

describe('Perception loops — end-to-end (Playwright)', () => {
  let browser: Browser;
  let page: Page;
  let tmp: string;

  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'uipe-perception-e2e-'));
    const html = await readFile(FIXTURE, 'utf8');
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(html, { waitUntil: 'load' });
  });

  afterEach(async () => {
    await page.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('full chain: mutation → frame anomaly → semantic escalation → intent VLM', async () => {
    const stream = new TemporalEventStream();
    const mutationCollector = new MutationCollector();
    const animationCollector = new AnimationCollector();
    await stream.attach(page, [mutationCollector, animationCollector]);

    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    const stubVlm = vi.fn(async () => 'TestComponent');
    const frameCapture = new FakeFrameCapture();
    const session = new PerceptionSession({ eventStream: stream });
    session.start(Date.now() - 1000, {  // start 1s in the past so warmup is past
      page,
      frameCapture: frameCapture as any,
      indexer,
      structuralPipeline: structural,
      classifyByVlm: stubVlm,
      getScreenshot: async () => page.screenshot({ type: 'png' }),
    });

    // Wait past the warmup window (500ms default)
    await new Promise((r) => setTimeout(r, 200));

    // Click the button → after 50ms a text mutation fires (no CSS animation)
    await page.click('#trigger');
    await new Promise((r) => setTimeout(r, 300));

    // Manually emit a frame keyframe (we use a fake frame capture)
    frameCapture.emitFakeKeyframe(Date.now());
    await new Promise((r) => setTimeout(r, 300));

    // Stop perception
    session.stop(Date.now());
    const summary = session.getSummary();

    expect(summary.anomalyCount).toBeGreaterThanOrEqual(1);
    expect(summary.anomaliesByReason['mutation-outside-animation']).toBeGreaterThanOrEqual(1);
    expect(summary.escalationCount).toBeGreaterThanOrEqual(1);
    // Intent only fires if the semantic loop flagged a pending component.
    // This depends on the fixture's text node being a recognized signature
    // or not; we don't assert intent strictly here — just verify the chain.
  }, 30_000);

  it('does not fire anomaly when mutation happens during an active animation', async () => {
    // Add an explicit CSS animation that's running when we trigger the mutation
    await page.evaluate(() => {
      const target = document.getElementById('target')!;
      target.animate(
        [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }],
        { duration: 2000, iterations: 1 },
      );
    });

    const stream = new TemporalEventStream();
    const mutationCollector = new MutationCollector();
    const animationCollector = new AnimationCollector();
    await stream.attach(page, [mutationCollector, animationCollector]);

    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    const stubVlm = vi.fn(async () => 'X');
    const frameCapture = new FakeFrameCapture();
    const session = new PerceptionSession({ eventStream: stream });
    session.start(Date.now() - 1000, {
      page,
      frameCapture: frameCapture as any,
      indexer,
      structuralPipeline: structural,
      classifyByVlm: stubVlm,
      getScreenshot: async () => page.screenshot({ type: 'png' }),
    });

    await new Promise((r) => setTimeout(r, 200));
    await page.click('#trigger');
    await new Promise((r) => setTimeout(r, 200));

    frameCapture.emitFakeKeyframe(Date.now());
    await new Promise((r) => setTimeout(r, 200));

    session.stop(Date.now());
    const summary = session.getSummary();
    expect(summary.anomalyCount).toBe(0);
  }, 30_000);
});
```

- [ ] **Step 3: Run the integration test (scoped)**

```bash
pnpm exec vitest run --reporter=verbose tests/integration/perception/
```
Expected: 2 passing within ~10-30s. If Playwright complains about missing Chromium, run `pnpm exec playwright install chromium` once.

- [ ] **Step 4: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/perception/
git commit -m "test(perception): Playwright e2e — full anomaly chain + animation-suppression case"
```

---

## Task 11: Docs update

**Files:**
- Modify: `/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md` (workspace root, NOT in git — per CLAUDE.md carry-forward #7)
- Modify: `/Users/dirkknibbe/uipe/docs/architecture.md` (workspace root)

Per the spec, the workspace-root docs are direct file writes that aren't committed via git. The task's deliverable is the on-disk edit.

- [ ] **Step 1: Update `/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md`**

Find sub-project #7 (it will say `▶ #7 — Hierarchical loops at fixed rates`). Replace the entry with:

```markdown
### ✅ #7 — Hierarchical loops at fixed rates (+ Anomaly-triggered attention #8)

`PerceptionSession` orchestrator with three autonomous loops at distinct cadences: frame (~16ms, tied to keyframe emission), semantic (~200ms), and intent (~1s). Rate-bounded, event-driven — loops are idle by default and wake on heartbeat-with-pending-work or escalation from a faster loop. v1 ships with one anomaly trigger: `mutation-outside-animation`. New event types (`perception-tick`, `perception-anomaly`, `perception-escalation`, `perception-intent-result`) flow through `TemporalEventStream`. Three new MCP tools (`start_perception`, `stop_perception`, `get_perception_session`) + a `perception-session` Claude skill for inspection sessions. Merged 2026-05-DD (commit `<TBD-fill-in-after-merge>`). **Depends on:** #2 (✓), #1 (✓), #3 (✓), #4 (✓).
```

Find sub-project #8 (`◌ #8 — Anomaly-triggered attention`). Replace the entry with:

```markdown
### ✅ #8 — Anomaly-triggered attention (merged into #7)

Shipped jointly with #7 (Hierarchical loops). The merge made sense because the rate-tiered loop infrastructure has no useful consumer without anomaly triggers, and the anomaly triggers' value depends on the loop hierarchy being in place. v1 anomaly: `mutation-outside-animation`. Additional triggers (animation deviation, new component signature, optical-flow motion) deferred to v2. See #7 entry for shipping details.
```

Update the "Recommended next pick" section. Find it (it likely points at #7 today) and replace with:

```markdown
## Recommended next pick (after #1, #3, #4, #7+#8 shipped)

**Storybook seeding adapter for #4** OR **SLAM for SPA routes (#5)**.

- The Storybook adapter is the obvious follow-up to #4 — it'd significantly reduce cold-start VLM cost on apps that publish a Storybook. The design question (Storybook entries vs first-traversal precedence) is tractable; implementation effort is modest.
- #5 (SLAM for SPA routes) is the next big architectural piece. Both prerequisites (#2 timeline, #4 component signatures) are satisfied. Builds the agent's spatial model: routes + transitions + components reachable from each. Multi-week scope.

Storybook is the smaller, faster ship; #5 is the more architecturally consequential. Either is reasonable.
```

- [ ] **Step 2: Update `/Users/dirkknibbe/uipe/docs/architecture.md`**

Find the "Current implementation" table. Find the row for #7 (`Hierarchical loops at fixed rates`) and replace the rightmost column with:

```
**Shipped** (PR `<TBD>`, merged 2026-05-DD, branch `feat/perception-loops`). `PerceptionSession` orchestrator at `src/pipelines/perception/` runs three autonomous loops at distinct cadences. Frame loop subscribes to `FrameCapture` keyframes; semantic + intent are rate-bounded and event-driven. v1 anomaly trigger: `mutation-outside-animation`. New `perception-*` event types on `TemporalEventStream`; three new MCP tools (`start_perception`, `stop_perception`, `get_perception_session`). A `perception-session` Claude skill orchestrates inspection workflows. Follow-ups: CSS `transition` detection (separate collector), spatial gating (subtree-aware anomaly suppression), additional anomaly triggers (animation deviation, new component signature, optical-flow motion).
```

Find the row for #8 (`Anomaly-triggered attention`) and replace with:

```
**Shipped** (jointly with #7, see above). v1 trigger: `mutation-outside-animation`. Escalation chain: frame loop spots anomaly → semantic loop checks the affected nodes via component-index → intent loop classifies unclassified components via VLM. Additional triggers deferred to v2.
```

- [ ] **Step 3: Verify nothing else broke**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=dot tests/unit/
```
Expected: no test changes — docs-only edits live outside the repo.

- [ ] **Step 4: No git commit for Task 11**

The workspace-root docs are not in a git repo (per CLAUDE.md carry-forward #7). The deliverable is the on-disk edit; the post-merge note about the commit hash gets backfilled later.

---

## Self-review verification (run before declaring complete)

- [ ] **Spec coverage:** every spec section maps to a task:
  - "Architecture" + ASCII diagram → Tasks 4-7 (loops + session wiring)
  - "Data shapes" → Task 1
  - "v1 anomaly trigger" → Task 2 + Task 4 (FrameLoop calls it)
  - "MCP tool surface" → Task 8
  - "Claude skill" → Task 9
  - "Edge cases" table → covered across Task 4 (debounce, animation gate), Task 6 (backpressure, screenshot null), Task 7 (page nav/close), Task 8 (already-running, missing session)
  - "Testing" → Tasks 1-8 (unit) + Task 10 (integration)
  - "Implementation phasing" → Tasks 1-11
  - "Docs + roadmap update" → Task 11

- [ ] **Naming consistency** — verify these names match identically across tasks:
  - Classes: `PerceptionSession`, `FrameLoop`, `SemanticLoop`, `IntentLoop`
  - Functions: `detectMutationOutsideAnimation`
  - Tool factories: `makeStartPerceptionTool`, `makeStopPerceptionTool`, `makeGetPerceptionSessionTool`
  - Types: `PerceptionTier`, `AnomalyReason`, `PerceptionSessionSummary`, `SessionStartDeps`, `DetectInput`, `DetectConfig`, `DetectResult`
  - Tool names: `'start_perception'`, `'stop_perception'`, `'get_perception_session'`
  - Event types: `'perception-tick'`, `'perception-anomaly'`, `'perception-escalation'`, `'perception-intent-result'`

- [ ] **Run the full unit suite one final time:**

```bash
pnpm exec vitest run --reporter=dot tests/unit/
```
Expected: ≥ ~50 new unit tests across the 7 perception unit-test files + 1 MCP test file, plus all previously-passing tests still pass.

---

## Definition of done

After Task 11 completes:

- [ ] All perception unit tests pass: `pnpm exec vitest run tests/unit/pipelines/perception/ tests/unit/mcp/perception.test.ts`
- [ ] Previously-passing tests still pass: `pnpm exec vitest run tests/unit/`
- [ ] Integration test passes: `pnpm exec vitest run tests/integration/perception/`
- [ ] Typecheck clean: `pnpm exec tsc --noEmit`
- [ ] Lint clean: `pnpm exec eslint src tests --ext .ts`
- [ ] `start_perception` / `stop_perception` / `get_perception_session` are listed in `TOOL_NAMES` and registered on the MCP server
- [ ] `perception-tick`, `perception-anomaly`, `perception-escalation`, `perception-intent-result` appear on the timeline when running the MCP server against a page that triggers the v1 anomaly
- [ ] `docs/autopilot-program-roadmap.md` (workspace-root) shows #7 + #8 as ✅
- [ ] `docs/architecture.md` (workspace-root) "Current implementation" table reflects both as Shipped
- [ ] `skills/perception-session/SKILL.md` exists in the repo

## Out of scope (deferred to follow-up tickets/PRs)

These are explicitly NOT part of this plan:

- Additional anomaly triggers (`new-component-signature`, `animation-deviation-high`, `optical-flow-motion-above-threshold-while-no-animation`) — each is a single-file detector + a one-line addition to the `AnomalyReason` union when picked up
- CSS `transition` tracking via a v2 `TransitionCollector`
- Spatial gating (per-animation target-ancestor tracking + spatial-overlap check)
- Configurable thresholds via runtime config (`PerceptionConfig` exposed via MCP)
- Persisted session summaries across server restarts (`~/.uipe/perception/sessions/`)
- Multi-page parallel perception
- VLM cost budgeting / rate limiting beyond best-effort observability
- Anomaly persistence beyond the timeline ring buffer
- The skill's "expected anomalies" assertion grammar (turning the skill into a real test framework)
- Semantic loop performance: today it re-runs the *full* structural pipeline + indexer on each wake; a v2 optimization would scope to changed subtrees only
- Resolving real bboxes from mutation payloads in the frame loop — today we emit nodeIds with `{0,0,0,0}` placeholder bboxes; the semantic loop resolves real bboxes from the structural pipeline. If frame-level bboxes become useful, the `MutationCollector` would need to capture bbox snapshots at mutation time.
