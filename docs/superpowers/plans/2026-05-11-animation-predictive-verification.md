# Animation Predictive Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `Animation.animationStarted`, compute a predicted end state from declared keyframes and emit it as a new `animation-prediction` event; at completion, compare against observed end state and fold per-property deltas + a normalized deviation score into the existing `animation-end` payload.

**Architecture:** Extend `AnimationCollector` (existing) to delegate prediction and observation work to a new `AnimationVerifier` class. All math (keyframe parsing, end-state derivation, deviation calculation) lives in pure functions under `src/pipelines/temporal/verifiers/animation/`, unit-tested without a browser. CDP correlation uses `Animation.resolveAnimation` + `Runtime.callFunctionOn` for rock-solid animationId-to-Animation-object binding.

**Tech Stack:** TypeScript (ESM with `.js` import extensions), Playwright CDP, Vitest, pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-11-animation-predictive-verification-design.md`](../specs/2026-05-11-animation-predictive-verification-design.md).

---

## File Structure

**New files (production):**

```
src/pipelines/temporal/verifiers/animation/
├── deviation.ts        per-property delta math + normalized score aggregator + SCALE constants
├── interpolation.ts    valueAtFinalState(keyframes, timing) — returns to-state or null for unsupported timing
├── keyframes.ts        parseRawKeyframes() — WAAPI raw keyframes → normalized PropertyPrediction[]
└── verifier.ts         AnimationVerifier orchestrator class; owns the pending-prediction Map
```

**New files (tests):**

```
tests/unit/pipelines/temporal/verifiers/animation/
├── deviation.test.ts
├── interpolation.test.ts
├── keyframes.test.ts
└── verifier.test.ts

tests/integration/animation-verifier.test.ts          # Playwright-driven E2E smoke
```

**Modified files:**

```
src/pipelines/temporal/collectors/types.ts            # Add 'animation-prediction' to EventType + new payload types + extend AnimationEndPayload
src/pipelines/temporal/collectors/animation.ts        # Delegate to verifier in event handlers
tests/unit/pipelines/temporal/collectors/animation.test.ts  # Extend existing tests for delegation
tests/unit/types/temporal-types.test.ts               # Add type-construction assertions for new payloads
docs/architecture.md                                  # Flip "Current implementation" row to a brief summary
docs/autopilot-program-roadmap.md                     # Flip sub-project #3 status from ▶ to ✅
```

**Module-boundary rationale (recap from spec):** Collector orchestrates CDP wiring (extended, not split). Verifier owns the Map of pending predictions and the `captureStart` / `observe` / `discard` / `clear` API. Pure helpers carry the math (keyframe parsing, end-state derivation, deviation) — testable as plain TS without a browser.

---

## Common commands

All commands run from the `ui-perception-engine/` directory.

- Run all tests: `pnpm exec vitest run --reporter=verbose`
- Run a single test file: `pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts`
- Typecheck: `pnpm exec tsc --noEmit`
- Lint: `pnpm exec eslint src tests --ext .ts`

After every task: typecheck must pass, all existing tests must still pass, then commit.

---

## Task 1: Extend `EventType` union + payload types

**Files:**
- Modify: `src/pipelines/temporal/collectors/types.ts`
- Modify: `tests/unit/types/temporal-types.test.ts`

This task is types-only. It compiles to nothing at runtime, but the type assertions in the test file lock in the contract.

- [ ] **Step 1: Open `tests/unit/types/temporal-types.test.ts` and add type-construction assertions for the new payloads**

Append after the existing tests in the same `describe` block (match the file's existing style):

```typescript
import type {
  AnimationPredictionPayload,
  AnimationEndPayload,
  SupportedProperty,
  PropertyPrediction,
  PropertyUnit,
  SkipReason,
  TimelineEvent,
} from '../../../src/pipelines/temporal/collectors/types.js';

describe('AnimationPredictionPayload', () => {
  it('accepts a complete prediction shape', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-1',
      expectedEndTimestamp: 1234,
      boundingBox: { x: 10, y: 20, w: 100, h: 50 },
      predicted: [
        { property: 'translateX', endValue: 240, unit: 'px' },
        { property: 'opacity', endValue: 1, unit: 'scalar' },
      ],
    };
    expect(payload.predicted).toHaveLength(2);
  });

  it('accepts a skipped prediction with empty predicted array', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-2',
      expectedEndTimestamp: 1234,
      boundingBox: null,
      predicted: [],
      skipped: { reason: 'unsupported-timing' },
    };
    expect(payload.skipped?.reason).toBe('unsupported-timing');
  });

  it('accepts unsupportedProperties listing Tier-3 props', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-3',
      expectedEndTimestamp: 1234,
      boundingBox: { x: 0, y: 0, w: 10, h: 10 },
      predicted: [{ property: 'translateX', endValue: 100, unit: 'px' }],
      unsupportedProperties: ['background-color', 'filter'],
    };
    expect(payload.unsupportedProperties).toContain('background-color');
  });
});

describe('Extended AnimationEndPayload', () => {
  it('accepts an end event with deviation', () => {
    const payload: AnimationEndPayload = {
      animationId: 'a-1',
      reason: 'completed',
      deviation: {
        perProperty: [{
          property: 'translateX',
          predicted: 100,
          observed: 102,
          delta: 2,
          normalizedDelta: 0.04,
        }],
        score: 0.04,
      },
    };
    expect(payload.deviation?.score).toBe(0.04);
  });

  it('accepts an end event without deviation', () => {
    const payload: AnimationEndPayload = { animationId: 'a-1', reason: 'completed' };
    expect(payload.deviation).toBeUndefined();
  });

  it('accepts a canceled end event without deviation', () => {
    const payload: AnimationEndPayload = { animationId: 'a-1', reason: 'canceled' };
    expect(payload.reason).toBe('canceled');
  });
});

describe('animation-prediction TimelineEvent', () => {
  it('typechecks with PayloadFor mapping', () => {
    const event: TimelineEvent<'animation-prediction'> = {
      id: 'evt-1',
      type: 'animation-prediction',
      timestamp: 0,
      payload: {
        animationId: 'a-1',
        expectedEndTimestamp: 300,
        boundingBox: null,
        predicted: [],
        skipped: { reason: 'no-keyframes' },
      },
    };
    expect(event.type).toBe('animation-prediction');
  });
});
```

- [ ] **Step 2: Run typecheck — should FAIL because new types don't exist yet**

Run: `pnpm exec tsc --noEmit`
Expected: errors about `AnimationPredictionPayload`, `SupportedProperty`, `SkipReason`, etc. not being exported from `types.ts`.

- [ ] **Step 3: Open `src/pipelines/temporal/collectors/types.ts` and extend the `EventType` union**

Find:
```typescript
export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
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
  | 'optical-flow-motion';
```

- [ ] **Step 4: Add the new payload types after the existing `AnimationEndPayload`**

Find the existing `AnimationEndPayload`:
```typescript
export interface AnimationEndPayload {
  animationId: string;
  reason: 'completed' | 'canceled';
}
```

Replace with:
```typescript
export type SupportedProperty =
  | 'translateX' | 'translateY' | 'scale' | 'rotate'
  | 'opacity'
  | 'width' | 'height'
  | 'top' | 'left' | 'right' | 'bottom';

export type PropertyUnit = 'px' | 'rad' | 'ratio' | 'scalar';

export interface PropertyPrediction {
  property: SupportedProperty;
  endValue: number;
  unit: PropertyUnit;
}

export type SkipReason =
  | 'no-keyframes'
  | 'unsupported-only'
  | 'unsupported-timing'
  | 'zero-duration'
  | 'resolve-failed'
  | 'no-target-node';

export interface AnimationPredictionPayload {
  animationId: string;
  expectedEndTimestamp: number;
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  predicted: PropertyPrediction[];
  unsupportedProperties?: string[];
  skipped?: { reason: SkipReason };
}

export interface PerPropertyDeviation {
  property: SupportedProperty;
  predicted: number;
  observed: number;
  delta: number;
  normalizedDelta: number;
}

export interface AnimationDeviation {
  perProperty: PerPropertyDeviation[];
  score: number;
}

export interface AnimationEndPayload {
  animationId: string;
  reason: 'completed' | 'canceled';
  deviation?: AnimationDeviation;
}
```

- [ ] **Step 5: Extend the `PayloadFor` mapped type**

Find:
```typescript
export type PayloadFor<T extends EventType> =
  T extends 'input'             ? InputPayload :
  T extends 'mutation'          ? MutationPayload :
  T extends 'network-request'   ? NetworkRequestPayload :
  T extends 'network-response'  ? NetworkResponsePayload :
  T extends 'animation-start'   ? AnimationStartPayload :
  T extends 'animation-end'     ? AnimationEndPayload :
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
  never;
```

- [ ] **Step 6: Run typecheck and the new tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run --reporter=verbose tests/unit/types/temporal-types.test.ts
```
Expected: typecheck passes, all new test cases pass.

- [ ] **Step 7: Run the full test suite to confirm no existing test broke**

```bash
pnpm exec vitest run --reporter=verbose
```
Expected: 191+ passing (all previously-passing tests plus the new type tests).

- [ ] **Step 8: Commit**

```bash
git add src/pipelines/temporal/collectors/types.ts tests/unit/types/temporal-types.test.ts
git commit -m "feat(temporal): add animation-prediction event type + payload shapes"
```

---

## Task 2: Pure helpers — `deviation.ts`

**Files:**
- Create: `src/pipelines/temporal/verifiers/animation/deviation.ts`
- Create: `tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts`

- [ ] **Step 1: Write `tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts` with all cases**

```typescript
import { describe, it, expect } from 'vitest';
import { computeDeviation, SCALE } from '../../../../../../src/pipelines/temporal/verifiers/animation/deviation.js';
import type { PropertyPrediction } from '../../../../../../src/pipelines/temporal/collectors/types.js';

describe('SCALE constants', () => {
  it('defines a scale for every SupportedProperty', () => {
    expect(SCALE.translateX).toBe(50);
    expect(SCALE.translateY).toBe(50);
    expect(SCALE.scale).toBe(0.25);
    expect(SCALE.rotate).toBeCloseTo(0.5, 5);
    expect(SCALE.opacity).toBe(0.2);
    expect(SCALE.width).toBe(50);
    expect(SCALE.height).toBe(50);
    expect(SCALE.top).toBe(50);
    expect(SCALE.left).toBe(50);
    expect(SCALE.right).toBe(50);
    expect(SCALE.bottom).toBe(50);
  });
});

describe('computeDeviation', () => {
  const predicted: PropertyPrediction[] = [
    { property: 'translateX', endValue: 100, unit: 'px' },
    { property: 'opacity', endValue: 1, unit: 'scalar' },
  ];

  it('returns zero deviation when observed matches predicted exactly', () => {
    const dev = computeDeviation(predicted, { translateX: 100, opacity: 1 });
    expect(dev.score).toBe(0);
    expect(dev.perProperty).toHaveLength(2);
    for (const p of dev.perProperty) {
      expect(p.delta).toBe(0);
      expect(p.normalizedDelta).toBe(0);
    }
  });

  it('computes per-property delta as observed minus predicted', () => {
    const dev = computeDeviation(predicted, { translateX: 105, opacity: 0.9 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    const op = dev.perProperty.find((p) => p.property === 'opacity')!;
    expect(tx.delta).toBe(5);
    expect(op.delta).toBeCloseTo(-0.1, 5);
  });

  it('normalizes delta against SCALE per property', () => {
    const dev = computeDeviation(predicted, { translateX: 150, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.normalizedDelta).toBeCloseTo(50 / 50, 5);
  });

  it('clamps normalizedDelta to [0, 1]', () => {
    const dev = computeDeviation(predicted, { translateX: 10000, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.normalizedDelta).toBe(1);
  });

  it('takes absolute value of delta for normalization', () => {
    const dev = computeDeviation(predicted, { translateX: -50, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.delta).toBe(-150);
    expect(tx.normalizedDelta).toBe(1);
  });

  it('score is max of per-property normalizedDelta', () => {
    const dev = computeDeviation(predicted, { translateX: 105, opacity: 0.5 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    const op = dev.perProperty.find((p) => p.property === 'opacity')!;
    expect(dev.score).toBe(Math.max(tx.normalizedDelta, op.normalizedDelta));
  });

  it('drops predicted properties missing from observed (does not penalize)', () => {
    const dev = computeDeviation(predicted, { translateX: 100 });
    expect(dev.perProperty).toHaveLength(1);
    expect(dev.perProperty[0].property).toBe('translateX');
  });

  it('returns score=0 with empty perProperty when predicted is empty', () => {
    const dev = computeDeviation([], { translateX: 100 });
    expect(dev.score).toBe(0);
    expect(dev.perProperty).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test — should FAIL because the module doesn't exist**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts
```
Expected: module-not-found errors.

- [ ] **Step 3: Create `src/pipelines/temporal/verifiers/animation/deviation.ts`**

```typescript
import type {
  AnimationDeviation,
  PerPropertyDeviation,
  PropertyPrediction,
  SupportedProperty,
} from '../../collectors/types.js';

// Per-property normalization scales. 1.0 of normalizedDelta corresponds to
// the listed delta — calibrated for visible deviations on typical UI elements.
// See spec section "Deviation normalization" for rationale.
export const SCALE: Record<SupportedProperty, number> = {
  translateX: 50,
  translateY: 50,
  scale:      0.25,
  rotate:     0.5,
  opacity:    0.2,
  width:      50,
  height:     50,
  top:        50,
  left:       50,
  right:      50,
  bottom:     50,
};

export function computeDeviation(
  predicted: PropertyPrediction[],
  observed: Partial<Record<SupportedProperty, number>>,
): AnimationDeviation {
  const perProperty: PerPropertyDeviation[] = [];
  for (const p of predicted) {
    const obs = observed[p.property];
    if (obs === undefined) continue;
    const delta = obs - p.endValue;
    const normalizedDelta = Math.min(Math.abs(delta) / SCALE[p.property], 1);
    perProperty.push({
      property: p.property,
      predicted: p.endValue,
      observed: obs,
      delta,
      normalizedDelta,
    });
  }
  const score = perProperty.length === 0 ? 0 : Math.max(...perProperty.map((p) => p.normalizedDelta));
  return { perProperty, score };
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts
```
Expected: 8 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/temporal/verifiers/animation/deviation.ts tests/unit/pipelines/temporal/verifiers/animation/deviation.test.ts
git commit -m "feat(verifiers): deviation math + SCALE constants for animation prediction"
```

---

## Task 3: Pure helpers — `interpolation.ts`

**Files:**
- Create: `src/pipelines/temporal/verifiers/animation/interpolation.ts`
- Create: `tests/unit/pipelines/temporal/verifiers/animation/interpolation.test.ts`

The only "interpolation" we need is "the value at offset=1 for a `iterations: 1, direction: 'normal'` animation." For all other timing configurations the function returns `null` — the verifier reads this as "unsupported-timing." No easing function is evaluated by design (for normal-direction single-iteration animations, all CSS easing functions map offset=1 → value=1 per spec).

- [ ] **Step 1: Write `tests/unit/pipelines/temporal/verifiers/animation/interpolation.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { valueAtFinalState, type NormalizedKeyframe } from '../../../../../../src/pipelines/temporal/verifiers/animation/interpolation.js';

const kfFromTo = (from: Record<string, number>, to: Record<string, number>): NormalizedKeyframe[] => ([
  { offset: 0, properties: from },
  { offset: 1, properties: to },
]);

describe('valueAtFinalState', () => {
  it('returns the to-state for iterations:1 direction:normal', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ translateX: 240 });
  });

  it('returns the to-state even with non-linear easing (easing is offset=1 invariant)', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { opacity: 0 } },
        { offset: 1, properties: { opacity: 1 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ opacity: 1 });
  });

  it('returns null for direction:reverse', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 1, direction: 'reverse' },
    );
    expect(result).toBeNull();
  });

  it('returns null for direction:alternate', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 2, direction: 'alternate' },
    );
    expect(result).toBeNull();
  });

  it('returns null for iterations !== 1 even with normal direction', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 3, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns null for iterations: Infinity', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: Infinity, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns null when no keyframe at offset=1 exists', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { translateX: 0 } },
        { offset: 0.5, properties: { translateX: 100 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns the offset=1 keyframe when multiple are present', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { translateX: 0 } },
        { offset: 1, properties: { translateX: 240 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ translateX: 240 });
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/interpolation.test.ts
```
Expected: module-not-found error.

- [ ] **Step 3: Create `src/pipelines/temporal/verifiers/animation/interpolation.ts`**

```typescript
export interface NormalizedKeyframe {
  offset: number;
  properties: Record<string, number>;
}

export interface KeyframeTiming {
  iterations: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
}

// Returns the property values at the animation's final state, or null if the
// timing configuration is unsupported by v1.
//
// Supported: iterations === 1 && direction === 'normal'. For this case, the
// final state is the keyframe at offset === 1 — independent of easing function,
// because every CSS/WAAPI easing maps offset=1 -> value=1 by spec.
export function valueAtFinalState(
  keyframes: NormalizedKeyframe[],
  timing: KeyframeTiming,
): Record<string, number> | null {
  if (timing.iterations !== 1) return null;
  if (timing.direction !== 'normal') return null;
  const final = keyframes.find((k) => k.offset === 1);
  if (!final) return null;
  return final.properties;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/interpolation.test.ts
```
Expected: 8 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/temporal/verifiers/animation/interpolation.ts tests/unit/pipelines/temporal/verifiers/animation/interpolation.test.ts
git commit -m "feat(verifiers): valueAtFinalState helper (iterations=1, direction=normal only)"
```

---

## Task 4: Pure helpers — `keyframes.ts`

**Files:**
- Create: `src/pipelines/temporal/verifiers/animation/keyframes.ts`
- Create: `tests/unit/pipelines/temporal/verifiers/animation/keyframes.test.ts`

Parses WAAPI raw keyframe arrays (what `Animation.effect.getKeyframes()` returns in-page) into the normalized `NormalizedKeyframe[]` shape that `interpolation.ts` consumes. Routes Tier-3 properties into `unsupportedProperties`. Decomposes composite `transform` strings into translateX, translateY, scale, rotate components.

The WAAPI raw shape looks like:
```
[
  { offset: 0, transform: 'translateX(0px)', opacity: '0' },
  { offset: 1, transform: 'translateX(240px) rotate(45deg)', opacity: '1' },
]
```

Note: WAAPI values arrive as **strings with units** (e.g., `'240px'`, `'45deg'`, `'0.5'`). Our parser strips units to numbers in the property's natural unit (px, rad, ratio, scalar).

- [ ] **Step 1: Write `tests/unit/pipelines/temporal/verifiers/animation/keyframes.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { parseRawKeyframes } from '../../../../../../src/pipelines/temporal/verifiers/animation/keyframes.js';

describe('parseRawKeyframes', () => {
  it('extracts translateX from a transform string', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 1, transform: 'translateX(240px)' },
    ]);
    expect(result.unsupportedProperties).toEqual([]);
    expect(result.keyframes).toEqual([
      { offset: 0, properties: { translateX: 0 } },
      { offset: 1, properties: { translateX: 240 } },
    ]);
  });

  it('decomposes composite transform into multiple components', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px) translateY(0px) scale(1) rotate(0deg)' },
      { offset: 1, transform: 'translateX(100px) translateY(50px) scale(1.5) rotate(45deg)' },
    ]);
    expect(result.keyframes[1].properties).toEqual({
      translateX: 100,
      translateY: 50,
      scale: 1.5,
      rotate: 45 * Math.PI / 180,
    });
  });

  it('keeps each keyframe independent (no cross-keyframe defaulting)', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 1, transform: 'translateX(100px) scale(1.5)' },
    ]);
    expect(result.keyframes[0].properties).toEqual({ translateX: 0 });
    expect(result.keyframes[1].properties).toEqual({ translateX: 100, scale: 1.5 });
  });

  it('parses opacity as a scalar', () => {
    const result = parseRawKeyframes([
      { offset: 0, opacity: '0' },
      { offset: 1, opacity: '1' },
    ]);
    expect(result.keyframes[1].properties).toEqual({ opacity: 1 });
  });

  it('parses width/height/top/left as pixel values', () => {
    const result = parseRawKeyframes([
      { offset: 0, width: '100px', height: '50px', top: '10px', left: '20px' },
      { offset: 1, width: '300px', height: '150px', top: '40px', left: '60px' },
    ]);
    expect(result.keyframes[1].properties).toEqual({
      width: 300,
      height: 150,
      top: 40,
      left: 60,
    });
  });

  it('routes Tier-3 properties to unsupportedProperties', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)', backgroundColor: 'rgb(255, 0, 0)' },
      { offset: 1, transform: 'translateX(100px)', backgroundColor: 'rgb(0, 255, 0)' },
    ]);
    expect(result.unsupportedProperties).toContain('backgroundColor');
    expect(result.keyframes[1].properties).toEqual({ translateX: 100 });
  });

  it('handles rotate in radians', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'rotate(0rad)' },
      { offset: 1, transform: 'rotate(1.5708rad)' },
    ]);
    expect(result.keyframes[1].properties.rotate).toBeCloseTo(1.5708, 4);
  });

  it('handles rotate in turn units', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'rotate(0turn)' },
      { offset: 1, transform: 'rotate(0.5turn)' },
    ]);
    expect(result.keyframes[1].properties.rotate).toBeCloseTo(Math.PI, 4);
  });

  it('returns empty keyframes for empty input', () => {
    const result = parseRawKeyframes([]);
    expect(result.keyframes).toEqual([]);
    expect(result.unsupportedProperties).toEqual([]);
  });

  it('routes filter, clipPath, color to unsupportedProperties', () => {
    const result = parseRawKeyframes([
      { offset: 0, filter: 'blur(0px)', clipPath: 'inset(0%)', color: 'rgb(0, 0, 0)' },
      { offset: 1, filter: 'blur(5px)', clipPath: 'inset(10%)', color: 'rgb(255, 255, 255)' },
    ]);
    expect(result.unsupportedProperties).toEqual(expect.arrayContaining(['filter', 'clipPath', 'color']));
    expect(result.keyframes[1].properties).toEqual({});
  });

  it('preserves the input offset values', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 0.5, transform: 'translateX(50px)' },
      { offset: 1, transform: 'translateX(100px)' },
    ]);
    expect(result.keyframes).toHaveLength(3);
    expect(result.keyframes[1].offset).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/keyframes.test.ts
```

- [ ] **Step 3: Create `src/pipelines/temporal/verifiers/animation/keyframes.ts`**

```typescript
import type { NormalizedKeyframe } from './interpolation.js';

export interface ParsedKeyframes {
  keyframes: NormalizedKeyframe[];
  unsupportedProperties: string[];
}

const SUPPORTED_DIRECT_PROPS = ['opacity', 'width', 'height', 'top', 'left', 'right', 'bottom'] as const;

const META_KEYS = new Set(['offset', 'easing', 'composite']);

const KNOWN_UNSUPPORTED = new Set([
  'backgroundColor', 'background-color',
  'color',
  'filter', 'backdropFilter',
  'clipPath', 'clip-path',
  'mask', 'maskImage',
  'boxShadow', 'textShadow',
  'borderRadius',
  'fill', 'stroke',
]);

interface RawKeyframe {
  offset: number;
  [key: string]: unknown;
}

const TRANSFORM_FN_RE = /(translateX|translateY|scale|rotate)\(([^)]+)\)/g;

export function parseRawKeyframes(raw: RawKeyframe[]): ParsedKeyframes {
  const unsupported = new Set<string>();
  const keyframes: NormalizedKeyframe[] = raw.map((kf) => {
    const properties: Record<string, number> = {};

    if (typeof kf.transform === 'string') {
      Object.assign(properties, parseTransform(kf.transform));
    }

    for (const prop of SUPPORTED_DIRECT_PROPS) {
      const v = kf[prop];
      if (v === undefined || v === null) continue;
      if (prop === 'opacity') {
        const n = parseFloat(String(v));
        if (!Number.isNaN(n)) properties.opacity = n;
      } else {
        const px = parsePxValue(String(v));
        if (px !== null) properties[prop] = px;
      }
    }

    for (const key of Object.keys(kf)) {
      if (META_KEYS.has(key)) continue;
      if (key === 'transform') continue;
      if ((SUPPORTED_DIRECT_PROPS as readonly string[]).includes(key)) continue;
      // Anything else is unsupported — known Tier-3 explicitly or unknown.
      unsupported.add(key);
    }

    return { offset: kf.offset, properties };
  });

  return { keyframes, unsupportedProperties: Array.from(unsupported) };
}

function parseTransform(transformStr: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of transformStr.matchAll(TRANSFORM_FN_RE)) {
    const fn = match[1];
    const arg = match[2].trim();
    if (fn === 'translateX' || fn === 'translateY') {
      const px = parsePxValue(arg);
      if (px !== null) out[fn] = px;
    } else if (fn === 'scale') {
      const n = parseFloat(arg);
      if (!Number.isNaN(n)) out.scale = n;
    } else if (fn === 'rotate') {
      const rad = parseRotateToRadians(arg);
      if (rad !== null) out.rotate = rad;
    }
  }
  return out;
}

function parsePxValue(s: string): number | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function parseRotateToRadians(s: string): number | null {
  const t = s.trim();
  if (t.endsWith('rad')) {
    const n = parseFloat(t.slice(0, -3));
    return Number.isNaN(n) ? null : n;
  }
  if (t.endsWith('turn')) {
    const n = parseFloat(t.slice(0, -4));
    return Number.isNaN(n) ? null : n * 2 * Math.PI;
  }
  if (t.endsWith('grad')) {
    const n = parseFloat(t.slice(0, -4));
    return Number.isNaN(n) ? null : (n * Math.PI) / 200;
  }
  const m = t.match(/^(-?\d+(?:\.\d+)?)(?:deg)?$/);
  if (m) return (parseFloat(m[1]) * Math.PI) / 180;
  return null;
}
```

Note: `String.matchAll()` requires Node 12+ (we're on Node 18+ per `package.json`), and the regex must have the `g` flag (ours does). No `lastIndex` bookkeeping needed.

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/keyframes.test.ts
```
Expected: 11 passing.

- [ ] **Step 5: Typecheck and full test suite**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose
```
Expected: typecheck passes, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/temporal/verifiers/animation/keyframes.ts tests/unit/pipelines/temporal/verifiers/animation/keyframes.test.ts
git commit -m "feat(verifiers): parseRawKeyframes — WAAPI keyframes to normalized props"
```

---

## Task 5: `AnimationVerifier` orchestrator class

**Files:**
- Create: `src/pipelines/temporal/verifiers/animation/verifier.ts`
- Create: `tests/unit/pipelines/temporal/verifiers/animation/verifier.test.ts`

The verifier holds the pending-prediction Map and exposes four methods:
- `captureStart(cdp, params, normalizer)` → `AnimationPredictionPayload` (the payload to emit)
- `observe(cdp, animationId)` → `AnimationDeviation | null` (deviation to fold into animation-end, or null)
- `discard(animationId)` → void (drop pending state on cancel)
- `clear()` → void (drop all state on detach)

The verifier never touches the timeline directly — it returns payloads/deviations and the collector pushes them.

- [ ] **Step 1: Write `tests/unit/pipelines/temporal/verifiers/animation/verifier.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { CDPSession } from 'playwright';
import { AnimationVerifier } from '../../../../../../src/pipelines/temporal/verifiers/animation/verifier.js';

const makeNormalizer = () => ({
  fromWallTimeMs: (n: number) => n,
  fromPerformanceNow: (n: number) => n,
  fromCdpMonotonicSeconds: (n: number) => n * 1000,
});

function makeMockCdp(responses: Record<string, unknown> = {}) {
  return {
    send: vi.fn(async (method: string) => {
      if (method in responses) return responses[method];
      throw new Error(`Unmocked CDP method: ${method}`);
    }),
  } as unknown as CDPSession;
}

const animStartParams = (overrides: any = {}) => ({
  animation: {
    id: 'anim-1',
    name: 'slide-in',
    startTime: 1.0,
    playbackRate: 1,
    source: { duration: 300, easing: 'ease-out' },
    ...overrides.animation,
  },
});

describe('AnimationVerifier.captureStart', () => {
  it('emits prediction with translateX from a simple slide animation', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 10, y: 20, w: 100, h: 50 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());

    expect(payload.animationId).toBe('anim-1');
    expect(payload.predicted).toEqual([
      { property: 'translateX', endValue: 240, unit: 'px' },
    ]);
    expect(payload.boundingBox).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(payload.skipped).toBeUndefined();
  });

  it('emits skipped:zero-duration for duration=0 animations', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    const payload = await v.captureStart(
      cdp,
      animStartParams({ animation: { source: { duration: 0 } } }),
      makeNormalizer(),
    );
    expect(payload.skipped?.reason).toBe('zero-duration');
    expect(payload.predicted).toEqual([]);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it('emits skipped:resolve-failed when resolveAnimation throws', async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Animation.resolveAnimation') throw new Error('gone');
        return undefined;
      }),
    } as unknown as CDPSession;
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('resolve-failed');
    expect(payload.predicted).toEqual([]);
    expect(payload.boundingBox).toBeNull();
  });

  it('emits skipped:no-target-node when callFunctionOn returns no bbox', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: { value: { keyframes: [], timing: { iterations: 1, direction: 'normal' }, bbox: null } },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('no-target-node');
    expect(payload.boundingBox).toBeNull();
  });

  it('emits skipped:unsupported-timing for iterations !== 1', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: Infinity, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('unsupported-timing');
    expect(payload.predicted).toEqual([]);
  });

  it('emits skipped:unsupported-only when only Tier-3 properties animate', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, backgroundColor: 'rgb(255, 0, 0)' },
              { offset: 1, backgroundColor: 'rgb(0, 255, 0)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('unsupported-only');
    expect(payload.unsupportedProperties).toContain('backgroundColor');
  });

  it('lists unsupportedProperties when mixing Tier-1 and Tier-3 props', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)', backgroundColor: 'rgb(0,0,0)' },
              { offset: 1, transform: 'translateX(100px)', backgroundColor: 'rgb(255,255,255)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped).toBeUndefined();
    expect(payload.predicted).toEqual([{ property: 'translateX', endValue: 100, unit: 'px' }]);
    expect(payload.unsupportedProperties).toContain('backgroundColor');
  });

  it('stores pending state only when a successful prediction is produced', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(v.hasPending('anim-1')).toBe(true);
  });

  it('does not store pending state for skipped predictions', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    await v.captureStart(
      cdp,
      animStartParams({ animation: { source: { duration: 0 } } }),
      makeNormalizer(),
    );
    expect(v.hasPending('anim-1')).toBe(false);
  });
});

describe('AnimationVerifier.observe', () => {
  const makeOkStartResponses = () => ({
    'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
    'Runtime.callFunctionOn': {
      result: {
        value: {
          keyframes: [
            { offset: 0, transform: 'translateX(0px)' },
            { offset: 1, transform: 'translateX(240px)' },
          ],
          timing: { iterations: 1, direction: 'normal' },
          bbox: { x: 0, y: 0, w: 10, h: 10 },
        },
      },
    },
  });

  it('returns deviation when both prediction and observation succeed', async () => {
    const cdp = makeMockCdp(makeOkStartResponses());
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());

    (cdp.send as any).mockImplementationOnce(async (method: string) => {
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: { translateX: 240 } } };
      }
      return undefined;
    });

    const dev = await v.observe(cdp, 'anim-1');
    expect(dev).not.toBeNull();
    expect(dev!.score).toBe(0);
    expect(v.hasPending('anim-1')).toBe(false);
  });

  it('returns null and drops state when observation throws', async () => {
    const cdp = makeMockCdp(makeOkStartResponses());
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());

    (cdp.send as any).mockImplementationOnce(async (method: string) => {
      if (method === 'Runtime.callFunctionOn') throw new Error('detached');
      return undefined;
    });

    const dev = await v.observe(cdp, 'anim-1');
    expect(dev).toBeNull();
    expect(v.hasPending('anim-1')).toBe(false);
  });

  it('returns null when no pending state exists', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    const dev = await v.observe(cdp, 'never-seen');
    expect(dev).toBeNull();
  });
});

describe('AnimationVerifier.discard', () => {
  it('drops pending state for a given animationId', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(v.hasPending('anim-1')).toBe(true);
    v.discard('anim-1');
    expect(v.hasPending('anim-1')).toBe(false);
  });
});

describe('AnimationVerifier.clear', () => {
  it('drops all pending state', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    await v.captureStart(
      cdp,
      animStartParams({ animation: { id: 'anim-2' } }),
      makeNormalizer(),
    );
    expect(v.hasPending('anim-1')).toBe(true);
    expect(v.hasPending('anim-2')).toBe(true);
    v.clear();
    expect(v.hasPending('anim-1')).toBe(false);
    expect(v.hasPending('anim-2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should FAIL (module not found)**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/verifier.test.ts
```

- [ ] **Step 3: Create `src/pipelines/temporal/verifiers/animation/verifier.ts`**

```typescript
import type { CDPSession } from 'playwright';
import type {
  AnimationDeviation,
  AnimationPredictionPayload,
  PropertyPrediction,
  SkipReason,
  SupportedProperty,
} from '../../collectors/types.js';
import type { ClockNormalizer } from '../../event-stream.js';
import { computeDeviation } from './deviation.js';
import { valueAtFinalState, type KeyframeTiming } from './interpolation.js';
import { parseRawKeyframes } from './keyframes.js';

interface PendingPrediction {
  predicted: PropertyPrediction[];
  objectId: string;
}

interface CapturedFromPage {
  keyframes: Array<{ offset: number; [key: string]: unknown }>;
  timing: KeyframeTiming;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

const READ_AT_START_SCRIPT = `
  function() {
    const anim = this;
    let bbox = null;
    try {
      const target = anim.effect && anim.effect.target;
      if (target && typeof target.getBoundingClientRect === 'function') {
        const r = target.getBoundingClientRect();
        bbox = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    } catch (_e) {}
    return {
      keyframes: anim.effect ? anim.effect.getKeyframes() : [],
      timing: anim.effect ? anim.effect.getComputedTiming() : {},
      bbox,
    };
  }
`;

const READ_AT_END_SCRIPT = `
  function() {
    const anim = this;
    const target = anim.effect && anim.effect.target;
    if (!target) return null;
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    const tf = cs.transform;
    const out = {};

    if (tf && tf !== 'none') {
      const m = tf.match(/^matrix\\(([^)]+)\\)$/);
      if (m) {
        const v = m[1].split(',').map(parseFloat);
        out.translateX = v[4];
        out.translateY = v[5];
        out.scale = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        out.rotate = Math.atan2(v[1], v[0]);
      } else {
        const m3 = tf.match(/^matrix3d\\(([^)]+)\\)$/);
        if (m3) {
          const v = m3[1].split(',').map(parseFloat);
          out.translateX = v[12];
          out.translateY = v[13];
          out.scale = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
          out.rotate = Math.atan2(v[1], v[0]);
        }
      }
    }
    out.opacity = parseFloat(cs.opacity);
    out.width = r.width;
    out.height = r.height;
    out.top = r.top;
    out.left = r.left;
    return out;
  }
`;

export class AnimationVerifier {
  private pending = new Map<string, PendingPrediction>();

  async captureStart(
    cdp: CDPSession,
    params: { animation: { id: string; source?: { duration?: number } } },
    _normalizer: ClockNormalizer,
  ): Promise<AnimationPredictionPayload> {
    const a = params.animation;
    const duration = a.source?.duration ?? 0;
    const expectedEndTimestamp = duration;

    if (duration === 0) {
      return this.skipped(a.id, 'zero-duration', expectedEndTimestamp);
    }

    let objectId: string;
    try {
      const resolved: any = await cdp.send('Animation.resolveAnimation' as any, { animationId: a.id } as any);
      objectId = resolved?.remoteObject?.objectId;
      if (!objectId) {
        return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
      }
    } catch {
      return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
    }

    let captured: CapturedFromPage;
    try {
      const res: any = await cdp.send('Runtime.callFunctionOn' as any, {
        objectId,
        functionDeclaration: READ_AT_START_SCRIPT,
        returnByValue: true,
      } as any);
      captured = res?.result?.value as CapturedFromPage;
      if (!captured) {
        return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
      }
    } catch {
      return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
    }

    if (!captured.bbox) {
      return this.skipped(a.id, 'no-target-node', expectedEndTimestamp);
    }

    if ((captured.keyframes ?? []).length === 0) {
      return this.skipped(a.id, 'no-keyframes', expectedEndTimestamp, captured.bbox);
    }

    const { keyframes, unsupportedProperties } = parseRawKeyframes(
      captured.keyframes as Array<{ offset: number; [key: string]: unknown }>,
    );
    const finalState = valueAtFinalState(keyframes, captured.timing);
    if (finalState === null) {
      return this.skipped(a.id, 'unsupported-timing', expectedEndTimestamp, captured.bbox);
    }

    const predicted = toPropertyPredictions(finalState);
    if (predicted.length === 0) {
      return {
        animationId: a.id,
        expectedEndTimestamp,
        boundingBox: captured.bbox,
        predicted: [],
        unsupportedProperties: unsupportedProperties.length > 0 ? unsupportedProperties : undefined,
        skipped: { reason: 'unsupported-only' },
      };
    }

    this.pending.set(a.id, { predicted, objectId });

    return {
      animationId: a.id,
      expectedEndTimestamp,
      boundingBox: captured.bbox,
      predicted,
      unsupportedProperties: unsupportedProperties.length > 0 ? unsupportedProperties : undefined,
    };
  }

  async observe(cdp: CDPSession, animationId: string): Promise<AnimationDeviation | null> {
    const pending = this.pending.get(animationId);
    if (!pending) return null;
    this.pending.delete(animationId);

    let observed: Partial<Record<SupportedProperty, number>>;
    try {
      const res: any = await cdp.send('Runtime.callFunctionOn' as any, {
        objectId: pending.objectId,
        functionDeclaration: READ_AT_END_SCRIPT,
        returnByValue: true,
      } as any);
      observed = res?.result?.value as Partial<Record<SupportedProperty, number>>;
      if (!observed) return null;
    } catch {
      return null;
    }

    return computeDeviation(pending.predicted, observed);
  }

  discard(animationId: string): void {
    this.pending.delete(animationId);
  }

  clear(): void {
    this.pending.clear();
  }

  hasPending(animationId: string): boolean {
    return this.pending.has(animationId);
  }

  private skipped(
    animationId: string,
    reason: SkipReason,
    expectedEndTimestamp: number,
    boundingBox: { x: number; y: number; w: number; h: number } | null = null,
  ): AnimationPredictionPayload {
    return {
      animationId,
      expectedEndTimestamp,
      boundingBox,
      predicted: [],
      skipped: { reason },
    };
  }
}

const SUPPORTED_PROPS: readonly SupportedProperty[] = [
  'translateX', 'translateY', 'scale', 'rotate',
  'opacity',
  'width', 'height',
  'top', 'left', 'right', 'bottom',
];

const UNIT: Record<SupportedProperty, 'px' | 'rad' | 'ratio' | 'scalar'> = {
  translateX: 'px', translateY: 'px',
  scale: 'ratio',
  rotate: 'rad',
  opacity: 'scalar',
  width: 'px', height: 'px',
  top: 'px', left: 'px', right: 'px', bottom: 'px',
};

function toPropertyPredictions(state: Record<string, number>): PropertyPrediction[] {
  const out: PropertyPrediction[] = [];
  for (const prop of SUPPORTED_PROPS) {
    if (prop in state) {
      out.push({ property: prop, endValue: state[prop], unit: UNIT[prop] });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/verifiers/animation/verifier.test.ts
```
Expected: 14 passing.

- [ ] **Step 5: Typecheck and full test suite**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose
```

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/temporal/verifiers/animation/verifier.ts tests/unit/pipelines/temporal/verifiers/animation/verifier.test.ts
git commit -m "feat(verifiers): AnimationVerifier orchestrator + state lifecycle"
```

---

## Task 6: Integrate verifier into `AnimationCollector`

**Files:**
- Modify: `src/pipelines/temporal/collectors/animation.ts`
- Modify: `tests/unit/pipelines/temporal/collectors/animation.test.ts`

The collector gains a `private verifier = new AnimationVerifier()` and four new call sites:

1. After pushing `animation-start`: call `verifier.captureStart(...)`, push the resulting `animation-prediction` event.
2. Inside the `setTimeout` completion callback: call `verifier.observe(...)`, fold the result into the `animation-end` payload.
3. In `animationCanceled` handler: call `verifier.discard(animationId)`.
4. In `detach()`: call `verifier.clear()`.

- [ ] **Step 1: Open `tests/unit/pipelines/temporal/collectors/animation.test.ts` and add new tests**

Append after the existing tests in the same `describe('AnimationCollector', …)` block. The new tests use a richer mock that handles `Animation.resolveAnimation` and `Runtime.callFunctionOn` responses. Add this helper near the top of the file (after the existing `makeMockCdp`):

```typescript
const makeMockCdpWithVerifier = (opts: {
  resolveResponse?: any;
  startReadResponse?: any;
  endReadResponse?: any;
  resolveThrows?: boolean;
} = {}) => {
  const handlers = new Map<string, Function[]>();
  let readCallCount = 0;
  const cdp = {
    send: vi.fn(async (method: string) => {
      if (method === 'Animation.enable') return undefined;
      if (method === 'Animation.resolveAnimation') {
        if (opts.resolveThrows) throw new Error('gone');
        return opts.resolveResponse ?? { remoteObject: { objectId: 'obj-1' } };
      }
      if (method === 'Runtime.callFunctionOn') {
        readCallCount++;
        if (readCallCount === 1) {
          return opts.startReadResponse ?? {
            result: {
              value: {
                keyframes: [
                  { offset: 0, transform: 'translateX(0px)' },
                  { offset: 1, transform: 'translateX(240px)' },
                ],
                timing: { iterations: 1, direction: 'normal' },
                bbox: { x: 10, y: 20, w: 100, h: 50 },
              },
            },
          };
        }
        return opts.endReadResponse ?? { result: { value: { translateX: 240 } } };
      }
      return undefined;
    }),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: vi.fn(),
    detach: vi.fn(),
  } as unknown as CDPSession;
  return { cdp, handlers };
};
```

Then append these tests inside the `describe('AnimationCollector', …)` block:

```typescript
it('animationStarted pushes animation-prediction after animation-start', async () => {
  const { cdp, handlers } = makeMockCdpWithVerifier();
  const page = makeMockPage(cdp);
  const stream = new TemporalEventStream();
  await stream.attach(page);
  await new AnimationCollector().attach(page, stream);

  const handler = handlers.get('Animation.animationStarted')![0];
  await handler({
    animation: {
      id: 'anim-1',
      name: 'slide',
      startTime: performance.now() / 1000,
      playbackRate: 1,
      source: { duration: 300, easing: 'linear' },
    },
  });

  // Allow promises queued in the handler to resolve.
  await new Promise((r) => setImmediate(r));

  const events = stream.getEvents();
  expect(events).toHaveLength(2);
  expect(events[0].type).toBe('animation-start');
  expect(events[1].type).toBe('animation-prediction');
  expect((events[1].payload as any).animationId).toBe('anim-1');
  expect((events[1].payload as any).predicted).toEqual([
    { property: 'translateX', endValue: 240, unit: 'px' },
  ]);
});

it('animation-end carries deviation when prediction + observation succeed', async () => {
  vi.useFakeTimers();
  try {
    const { cdp, handlers } = makeMockCdpWithVerifier();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const handler = handlers.get('Animation.animationStarted')![0];
    await handler({
      animation: {
        id: 'anim-1',
        name: 'slide',
        startTime: performance.now() / 1000,
        playbackRate: 1,
        source: { duration: 100, easing: 'linear' },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(0);

    const events = stream.getEvents();
    const endEvent = events.find((e) => e.type === 'animation-end');
    expect(endEvent).toBeDefined();
    const payload = endEvent!.payload as any;
    expect(payload.reason).toBe('completed');
    expect(payload.deviation).toBeDefined();
    expect(payload.deviation.score).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('animationCanceled drops pending verifier state', async () => {
  const { cdp, handlers } = makeMockCdpWithVerifier();
  const page = makeMockPage(cdp);
  const stream = new TemporalEventStream();
  await stream.attach(page);
  const collector = new AnimationCollector();
  await collector.attach(page, stream);

  const startHandler = handlers.get('Animation.animationStarted')![0];
  await startHandler({
    animation: {
      id: 'anim-1',
      name: 'slide',
      startTime: performance.now() / 1000,
      playbackRate: 1,
      source: { duration: 300, easing: 'linear' },
    },
  });
  await new Promise((r) => setImmediate(r));

  const cancelHandler = handlers.get('Animation.animationCanceled')![0];
  cancelHandler({ id: 'anim-1' });

  const events = stream.getEvents();
  const endEvent = events.find((e) => e.type === 'animation-end');
  expect(endEvent).toBeDefined();
  expect((endEvent!.payload as any).reason).toBe('canceled');
  expect((endEvent!.payload as any).deviation).toBeUndefined();
});

it('detach clears pending verifier state', async () => {
  const { cdp, handlers } = makeMockCdpWithVerifier();
  const page = makeMockPage(cdp);
  const stream = new TemporalEventStream();
  await stream.attach(page);
  const collector = new AnimationCollector();
  await collector.attach(page, stream);

  const startHandler = handlers.get('Animation.animationStarted')![0];
  await startHandler({
    animation: {
      id: 'anim-1',
      name: 'slide',
      startTime: performance.now() / 1000,
      playbackRate: 1,
      source: { duration: 300, easing: 'linear' },
    },
  });
  await new Promise((r) => setImmediate(r));

  await collector.detach();
  // Re-attaching does not surface leaked events; detach should not throw.
  expect(cdp.detach).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the new tests — should FAIL because the collector doesn't delegate yet**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/collectors/animation.test.ts
```
Expected: the 4 new tests fail.

- [ ] **Step 3: Open `src/pipelines/temporal/collectors/animation.ts` and integrate the verifier**

Replace the entire file body with:

```typescript
import type { Page, CDPSession } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';
import { AnimationVerifier } from '../verifiers/animation/verifier.js';

let nextId = 0;

interface AnimationStartState {
  startTimestamp: number;
  wallTimeAtStart: number;
  duration: number;
  completionTimer?: ReturnType<typeof setTimeout>;
}

export class AnimationCollector implements Collector {
  readonly name = 'animation';
  private cdp: CDPSession | undefined;
  private active = new Map<string, AnimationStartState>();
  private verifier = new AnimationVerifier();

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('AnimationCollector: stream not attached, skipping');
      return;
    }

    try {
      this.cdp = await page.context().newCDPSession(page);
      await this.cdp.send('Animation.enable');

      this.cdp.on('Animation.animationStarted', async (params: any) => {
        const a = params.animation;
        const startTimestamp = a.startTime !== undefined
          ? normalizer.fromCdpMonotonicSeconds(a.startTime)
          : normalizer.fromPerformanceNow(performance.now());
        const duration = a.source?.duration ?? 0;
        const wallTimeAtStart = Date.now();

        const state: AnimationStartState = {
          startTimestamp,
          wallTimeAtStart,
          duration,
        };
        this.active.set(a.id, state);

        stream.push({
          id: `anim-start-${++nextId}`,
          type: 'animation-start',
          timestamp: startTimestamp,
          payload: {
            animationId: a.id,
            name: a.name,
            duration,
            easing: a.source?.easing,
          },
        });

        // Predict + emit prediction event.
        try {
          const cdp = this.cdp;
          if (cdp) {
            const predPayload = await this.verifier.captureStart(cdp, params, normalizer);
            stream.push({
              id: `anim-pred-${++nextId}`,
              type: 'animation-prediction',
              timestamp: startTimestamp,
              payload: { ...predPayload, expectedEndTimestamp: startTimestamp + duration },
            });
          }
        } catch (err) {
          console.warn(`AnimationCollector: prediction failed (${(err as Error).message})`);
        }

        if (duration > 0) {
          state.completionTimer = setTimeout(async () => {
            let deviation = null;
            try {
              const cdp = this.cdp;
              if (cdp) {
                deviation = await this.verifier.observe(cdp, a.id);
              }
            } catch (err) {
              console.warn(`AnimationCollector: observation failed (${(err as Error).message})`);
            }
            stream.push({
              id: `anim-end-${++nextId}`,
              type: 'animation-end',
              timestamp: startTimestamp + duration,
              payload: deviation
                ? { animationId: a.id, reason: 'completed', deviation }
                : { animationId: a.id, reason: 'completed' },
            });
            this.active.delete(a.id);
          }, duration + 16);
        }
      });

      this.cdp.on('Animation.animationCanceled', (params: any) => {
        const id = params.id;
        const state = this.active.get(id);
        let timestamp: number;
        if (state) {
          if (state.completionTimer) clearTimeout(state.completionTimer);
          const elapsed = Date.now() - state.wallTimeAtStart;
          timestamp = state.startTimestamp + elapsed;
          this.active.delete(id);
        } else {
          timestamp = normalizer.fromWallTimeMs(Date.now());
        }

        this.verifier.discard(id);

        stream.push({
          id: `anim-end-${++nextId}`,
          type: 'animation-end',
          timestamp,
          payload: {
            animationId: id,
            reason: 'canceled',
          },
        });
      });
    } catch (err) {
      console.warn(`AnimationCollector: attach failed (${(err as Error).message})`);
    }
  }

  async detach(): Promise<void> {
    for (const state of this.active.values()) {
      if (state.completionTimer) clearTimeout(state.completionTimer);
    }
    this.active.clear();
    this.verifier.clear();
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
```

- [ ] **Step 4: Run the modified test file — all old + new tests should pass**

```bash
pnpm exec vitest run --reporter=verbose tests/unit/pipelines/temporal/collectors/animation.test.ts
```
Expected: existing tests still pass, 4 new tests pass.

- [ ] **Step 5: Run the full suite + typecheck**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/temporal/collectors/animation.ts tests/unit/pipelines/temporal/collectors/animation.test.ts
git commit -m "feat(animation): wire AnimationVerifier into AnimationCollector"
```

---

## Task 7: Integration test with real Playwright + static HTML fixture

**Files:**
- Create: `tests/integration/animation-verifier.test.ts`
- Create: `tests/integration/fixtures/animation-page.html`

This is the first end-to-end test that drives a real browser through real animations. The fixture is a self-contained static HTML page with controllable animations triggered by element classes; the test mounts the page via `page.setContent()`, attaches the stream, drives the animation, and asserts the resulting timeline.

If Playwright isn't already installed locally with browser binaries, run `pnpm exec playwright install chromium` first.

- [ ] **Step 1: Create the fixture HTML at `tests/integration/fixtures/animation-page.html`**

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 20px; font-family: sans-serif; }
  .box {
    width: 100px;
    height: 100px;
    background: #4a90e2;
    position: relative;
  }
  .slide.running {
    animation: slide-anim 200ms linear forwards;
  }
  @keyframes slide-anim {
    from { transform: translateX(0px); }
    to   { transform: translateX(200px); }
  }
  .fade.running {
    animation: fade-anim 200ms linear forwards;
  }
  @keyframes fade-anim {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .bg.running {
    animation: bg-anim 200ms linear forwards;
  }
  @keyframes bg-anim {
    from { background-color: red; }
    to   { background-color: green; }
  }
  .spinner.running {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
</style>
</head>
<body>
  <div id="slide" class="box slide"></div>
  <div id="fade" class="box fade"></div>
  <div id="bg" class="box bg"></div>
  <div id="spinner" class="box spinner"></div>
</body>
</html>
```

- [ ] **Step 2: Create `tests/integration/animation-verifier.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemporalEventStream } from '../../src/pipelines/temporal/event-stream.js';
import { AnimationCollector } from '../../src/pipelines/temporal/collectors/animation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HTML = readFileSync(resolve(__dirname, 'fixtures/animation-page.html'), 'utf-8');

describe('AnimationVerifier — Playwright integration', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let stream: TemporalEventStream;
  let collector: AnimationCollector;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.setContent(FIXTURE_HTML);
    stream = new TemporalEventStream();
    collector = new AnimationCollector();
    await stream.attach(page, [collector]);
  });

  afterEach(async () => {
    await collector?.detach();
    await context?.close();
  });

  it('predicts and verifies a translateX animation', async () => {
    await page.evaluate(() => {
      document.getElementById('slide')!.classList.add('running');
    });

    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const start = events.find((e) => e.type === 'animation-start');
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    expect(start).toBeDefined();
    expect(prediction).toBeDefined();
    expect(end).toBeDefined();

    const pred = prediction!.payload as any;
    expect(pred.predicted).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'translateX', endValue: 200, unit: 'px' }),
    ]));
    expect(pred.boundingBox).toBeTruthy();
    expect(pred.skipped).toBeUndefined();

    const endPayload = end!.payload as any;
    expect(endPayload.reason).toBe('completed');
    expect(endPayload.deviation).toBeDefined();
    expect(endPayload.deviation.score).toBeLessThan(0.05);
  }, 10000);

  it('predicts and verifies an opacity fade', async () => {
    await page.evaluate(() => {
      document.getElementById('fade')!.classList.add('running');
    });
    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    const pred = prediction!.payload as any;
    expect(pred.predicted).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'opacity', endValue: 1, unit: 'scalar' }),
    ]));

    const endPayload = end!.payload as any;
    expect(endPayload.deviation.score).toBeLessThan(0.05);
  }, 10000);

  it('skips a background-color-only animation with reason unsupported-only', async () => {
    await page.evaluate(() => {
      document.getElementById('bg')!.classList.add('running');
    });
    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    const pred = prediction!.payload as any;
    expect(pred.skipped?.reason).toBe('unsupported-only');
    expect(pred.predicted).toEqual([]);
    expect(pred.unsupportedProperties).toEqual(expect.arrayContaining(['backgroundColor']));

    const endPayload = end!.payload as any;
    expect(endPayload.deviation).toBeUndefined();
  }, 10000);

  it('skips an infinite spinner with reason unsupported-timing', async () => {
    await page.evaluate(() => {
      document.getElementById('spinner')!.classList.add('running');
    });
    await page.waitForTimeout(200);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');

    const pred = prediction!.payload as any;
    expect(pred.skipped?.reason).toBe('unsupported-timing');
    expect(pred.predicted).toEqual([]);
  }, 10000);
});
```

- [ ] **Step 3: Ensure Chromium is installed**

```bash
pnpm exec playwright install chromium
```
Expected: chromium installed (no-op if already present).

- [ ] **Step 4: Run the integration tests**

```bash
pnpm exec vitest run --reporter=verbose tests/integration/animation-verifier.test.ts
```
Expected: 4 passing.

If a test fails because the background-color animation property name doesn't match (WAAPI may use either `backgroundColor` or `background-color` depending on Chromium version), inspect the actual `pred.unsupportedProperties` value and adjust the assertion accordingly.

- [ ] **Step 5: Run the full suite**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose
```
Expected: everything passes (integration tests add 4).

- [ ] **Step 6: Commit**

```bash
git add tests/integration/animation-verifier.test.ts tests/integration/fixtures/animation-page.html
git commit -m "test(verifiers): Playwright integration coverage for animation prediction"
```

---

## Task 8: Update documentation — architecture table + roadmap status

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/autopilot-program-roadmap.md`

- [ ] **Step 1: Open `docs/architecture.md` and locate the "Current implementation" table**

Find the table row that mentions predictive verification (currently noting "Not yet built" or similar — search for "Predictive verification" or "predict" in the section). Replace the implementation column for that row with:

```
Implemented as `animation-prediction` event emitted on `Animation.animationStarted` (declared keyframes -> predicted end state via WAAPI). Deviation (per-property delta + normalized score) folded into `animation-end`. Element bbox captured for future optical-flow correlation. Declarative animations only (`iterations: 1`, `direction: 'normal'`); imperative/multi-iteration/Tier-3 cases emit `skipped` with reason.
```

If the row's structure doesn't permit that exact phrasing, condense to match the column width of neighboring rows while preserving the substantive claims (event names, scope limits).

- [ ] **Step 2: Open `docs/autopilot-program-roadmap.md` and flip sub-project #3 status**

Find:
```markdown
### ▶ #3 — Predictive verification against CDP Animation API
```

Replace with:
```markdown
### ✅ #3 — Predictive verification against CDP Animation API
```

Update the body of the entry to match the optical-flow / temporal-stream entry's pattern. Replace the body text with:

```markdown
`AnimationVerifier` + `animation-prediction` event + extended `animation-end` payload with deviation score. Merged 2026-05-11 (commit `<TBD-fill-in-after-merge>`). Declarative animations only (`iterations: 1, direction: 'normal'`); imperative + multi-iteration + Tier-3 cases emit `skipped`. **Depends on:** #2 (✓), CDP Animation events (✓).
```

Note: Replace `<TBD-fill-in-after-merge>` with the actual merge commit hash once available. If running this task before merge, leave the placeholder and update it post-merge.

- [ ] **Step 3: Verify nothing else broke**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run --reporter=verbose
```
Expected: no test changes — docs-only.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/autopilot-program-roadmap.md
git commit -m "docs: mark sub-project #3 (predictive verification) shipped"
```

---

## Definition of done

After Task 8 completes:

- [ ] All tests pass: `pnpm exec vitest run --reporter=verbose` shows ≥ 215 passing (191 prior + ~24 new across types/deviation/interpolation/keyframes/verifier/collector/integration).
- [ ] Typecheck clean: `pnpm exec tsc --noEmit` passes.
- [ ] Lint clean: `pnpm exec eslint src tests --ext .ts` passes.
- [ ] `animation-prediction` events appear on the timeline when running the MCP server against a page with CSS animations.
- [ ] `animation-end` events carry `deviation.score` for verified animations.
- [ ] `docs/autopilot-program-roadmap.md` shows #3 as ✅ Shipped.
- [ ] `docs/architecture.md` "Current implementation" table reflects the new capability.

## Out of scope (deferred to follow-up tickets/PRs)

These are explicitly NOT part of this plan:

- Fixing the pre-existing `iterations > 1` bug in `AnimationCollector` (separate ticket already captured)
- Optical-flow correlation (uses `boundingBox` field once captured but not consumed in v1)
- Multi-iteration / direction-reverse / alternate predictions (emit `skipped: 'unsupported-timing'`)
- Tier-3 property verification (color, filter, clip-path)
- Mid-animation continuous comparison (endpoint-only)
- Configurable SCALE thresholds via runtime config
- `pseudoElement` target support
