# Animation Predictive Verification — Design

**Date:** 2026-05-11
**Status:** Draft — pending user review
**Roadmap entry:** [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) — sub-project #3
**Architecture source:** [`docs/architecture.md`](../../architecture.md) — "Predictive verification against CDP Animation API"

## Goal

When the browser fires `Animation.animationStarted`, compute a **predicted end state** from the declared keyframes and emit it onto the [`TemporalEventStream`](../../../src/pipelines/temporal/event-stream.ts) as a first-class event. At animation completion, read the **observed end state** from the page and compare it to the prediction. Surface per-property deltas and a single normalized deviation score, again on the timeline.

The deviation signal is what sub-project #8 ("anomaly-triggered attention") will threshold to decide when to spend a VLM call. Sub-project #3's job is to produce that signal with enough fidelity that #8's downstream policy is meaningful.

## Primary consumer

**The autopilot perception layer itself**, via the timeline. The architecture thesis is predictive coding: the agent has an expectation (predicted endpoint); observation matches → no attention needed; mismatch → attention spike. This sub-project makes "expectation" and "match" representable on the same timeline that already carries observations.

Secondary consumer: the developer reading `get_timeline` output. A prediction event with `predicted: [{property: 'translateX', endValue: 240, unit: 'px'}]` and a matching `animation-end` with `deviation.score: 0.02` is legible — it tells a story without raw keyframe dumps.

## Non-goals (v1)

- **Imperative animations** (rAF tweens, GSAP without WAAPI bridge, canvas/WebGL). They never fire `Animation.animationStarted`, so no trigger. Future work: optical-flow-as-prediction-source via motion extrapolation, or design-system priors (#4).
- **Tier-3 properties** — `background-color`, `color`, `filter`, `clip-path`, `mask`. These require perceptual color spaces or geometric-complex comparison and belong with the visual tier, not the deterministic geometric comparator.
- **Mid-animation deviation** — only endpoint comparison. Continuous verification would mean periodic sampling, which lands at a different design.
- **Optical-flow correlation (hybrid mode)** — element bbox is *captured* on the prediction event (extension point), but the comparator does not yet consume it. Hybrid is its own design pass after v1 ships.
- **Configurable deviation thresholds via runtime config** — hardcoded constants with rationale comments. Config override added only when a real use case forces it.
- **Multi-iteration / alternating / reversed animations** (`iterations !== 1` or `direction !== 'normal'`) — emit `skipped: 'unsupported-timing'`. Use cases (loading spinners, alternating bounces) aren't load-bearing for the #8 signal.
- **Severity buckets / policy classification** — payload carries raw deltas plus a normalized score. "What counts as anomalous" is a policy decision that belongs in #8.

## Architecture

```
                    CDP Animation domain
                            │
                            ▼
┌───────────────────────────────────────────────────────────────────────┐
│  AnimationCollector (existing, extended)                              │
│  src/pipelines/temporal/collectors/animation.ts                       │
│  - on animationStarted: push 'animation-start' (unchanged)            │
│                          + await verifier.captureStart(...)           │
│                          + push 'animation-prediction'                │
│  - on completion timer:  + await verifier.observe(...)                │
│                          + push 'animation-end' with deviation folded │
│  - on animationCanceled: + verifier.discard(animationId)              │
│  - on detach():          + verifier.clear()                           │
└─────────────────────────────┬─────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  AnimationVerifier (new, stateful)                                    │
│  src/pipelines/temporal/verifiers/animation/verifier.ts               │
│  - captureStart(cdp, params, normalizer) → Prediction                 │
│  - observe(cdp, animationId)             → {predicted, observed,      │
│                                              deviation} | null         │
│  - discard(animationId), clear()                                      │
│  - holds Map<animationId, PendingPrediction>                          │
└─────────────────────────────┬─────────────────────────────────────────┘
                              │ (delegates math to)
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  Pure functions (browser-free; unit-tested in isolation)      │
   │  src/pipelines/temporal/verifiers/animation/                  │
   │  - keyframes.ts     parse WAAPI raw → normalized props        │
   │  - interpolation.ts value-at-final-state (no easing eval)     │
   │  - deviation.ts     per-property delta + normalized score     │
   └───────────────────────────────────────────────────────────────┘
```

**Module-boundary rationale:**

- Collector orchestrates CDP wiring. It already lives in `collectors/animation.ts`; it gains delegation calls but stays the single owner of CDP plumbing for animations.
- Verifier owns *state* — the Map of in-flight predictions. Putting state into a separate class makes lifecycle (clear-on-navigate, drop-on-cancel) testable without a browser.
- Pure helpers carry the *math*. Keyframe parsing, end-state derivation, and deviation calculation are deterministic transforms of plain objects — they get the bulk of the test surface and run in milliseconds.

## Data flow

### Happy path

```
CDP Animation.animationStarted (params)
  │
  ▼
AnimationCollector
  ├── push('animation-start', {animationId, name, duration, easing})   ← existing
  ├── await verifier.captureStart(cdp, params, normalizer):
  │     ├── CDP Animation.resolveAnimation(animationId) → RemoteObject ref to in-page Animation
  │     ├── CDP Runtime.callFunctionOn(remoteObject, IIFE):
  │     │     return {
  │     │       keyframes: anim.effect.getKeyframes(),
  │     │       timing:    anim.effect.getComputedTiming(),
  │     │       bbox:      target.getBoundingClientRect()
  │     │     }
  │     ├── if timing.iterations !== 1 || timing.direction !== 'normal' →
  │     │       skipped: {reason: 'unsupported-timing'}, return early
  │     ├── parseKeyframes(raw) → {predicted: PropertyPrediction[], unsupportedProperties}
  │     ├── store pending Map: animationId → {targetHandle, predicted, bbox}
  │     └── return Prediction
  └── push('animation-prediction', predictionPayload)

… animation runs …

setTimeout(duration + 16ms) fires    (existing completion-timer path)
  │
  ▼
  ├── await verifier.observe(cdp, animationId):
  │     ├── pending Map lookup; if missing → return null
  │     ├── CDP Runtime.callFunctionOn(targetHandle, IIFE):
  │     │     return per-property observed values (transforms, opacity, bbox)
  │     ├── deviation(predicted, observed) → {perProperty[], score}
  │     ├── drop pending Map entry
  │     └── return {predicted, observed, deviation}
  └── push('animation-end', {animationId, reason: 'completed', deviation?})

CDP Animation.animationCanceled
  ├── verifier.discard(animationId)       ← drop pending Map entry
  └── push('animation-end', {animationId, reason: 'canceled'})    ← existing
```

### Read mechanism

`Animation.resolveAnimation` exists exactly to bridge CDP animation IDs to in-page `Animation` objects. Using it gives rock-solid correlation — no fuzzy match by target+name+startTime. `Runtime.callFunctionOn` on the resolved handle returns WAAPI-normalized data: CSS animations, CSS transitions, and JS-driven WAAPI all surface through the same `effect.getKeyframes()` shape, so the verifier doesn't need a separate code path per animation source.

All interpolation and deviation math runs **host-side in TypeScript**. The in-page IIFEs only collect raw values; they never compute. This keeps the math unit-testable against fixture data without spinning up a browser.

### Easing handling

For `iterations: 1` + `direction: 'normal'` (the supported case), the end state is the to-state keyframe regardless of easing function — every CSS easing function (linear, cubic-bezier, steps, custom) maps offset=1.0 to value=1.0 by spec. The verifier never evaluates an easing function. `interpolation.ts` exists to encode this property explicitly: `valueAtFinalState(keyframes, timing)` returns the value at offset=1 with no easing math, or `null` for unsupported timing.

This is load-bearing for the math being trivial. If a future iteration adds mid-animation comparison, the same module is the natural home for an actual easing-curve evaluator.

## Event types

### New event type: `animation-prediction`

Add to `EventType` union in [`src/pipelines/temporal/collectors/types.ts`](../../../src/pipelines/temporal/collectors/types.ts):

```typescript
export type EventType =
  | ... existing ...
  | 'animation-prediction';
```

### New payload types

```typescript
export type SupportedProperty =
  | 'translateX' | 'translateY' | 'scale' | 'rotate'   // transform components
  | 'opacity'
  | 'width' | 'height'                                  // size
  | 'top' | 'left' | 'right' | 'bottom';                // position

export type PropertyUnit = 'px' | 'rad' | 'ratio' | 'scalar';

export interface PropertyPrediction {
  property: SupportedProperty;
  endValue: number;
  unit: PropertyUnit;
}

export type SkipReason =
  | 'no-keyframes'        // animation has no keyframes (defensive)
  | 'unsupported-only'    // animates only Tier-3 properties
  | 'unsupported-timing'  // iterations !== 1 or direction !== 'normal'
  | 'zero-duration'       // duration === 0 (mirrors existing collector gate)
  | 'resolve-failed'      // Animation.resolveAnimation race
  | 'no-target-node';     // animation has no target element

export interface AnimationPredictionPayload {
  animationId: string;
  expectedEndTimestamp: number;       // normalized (same clock as animation-start)
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  predicted: PropertyPrediction[];     // [] if skipped
  unsupportedProperties?: string[];    // Tier-3 props present but not predicted
  skipped?: { reason: SkipReason };
}
```

### Extended payload: `AnimationEndPayload`

```typescript
export interface AnimationEndPayload {
  animationId: string;
  reason: 'completed' | 'canceled';
  // NEW: present only when reason === 'completed' AND a prediction with at least one
  // predicted property existed AND observation succeeded.
  deviation?: {
    perProperty: Array<{
      property: SupportedProperty;
      predicted: number;
      observed: number;
      delta: number;                   // observed − predicted, in property's natural unit
      normalizedDelta: number;         // delta / SCALE[property], clamped to [0, 1]
    }>;
    score: number;                     // max(normalizedDelta) — worst-property aggregator
  };
}
```

### Why `deviation` is optional rather than nullable

`animation-end` is the end event; status of the prediction lives on the prediction event. The three cases that produce no `deviation` field (canceled, target-detached, fully-skipped) are already distinguishable by correlating to the prediction event via `animationId` and inspecting its `skipped` field plus `animation-end`'s `reason` field. Adding an inline `null` or status flag would duplicate information already in the timeline.

If downstream consumers find themselves re-implementing the same correlation logic in 3+ places, that's the trigger to add an inline status field — not a speculative day-one decision.

## Deviation normalization

The `normalizedDelta` field rescales each property's natural-unit delta into a comparable [0, 1] range. The `score` is `max(normalizedDelta)` across predicted properties — worst-case aggregation, because one wildly-off property matters as much as several. Mean aggregation would dilute signal in the common case where N-1 properties match and 1 fails.

Per-property scales (constants in `deviation.ts`, with comments justifying each):

| Property | SCALE (1.0 of normalizedDelta corresponds to…) | Rationale |
|---|---|---|
| `translateX`, `translateY` | 50 px | ~one frame at 3000 px/s, a clearly-visible miss |
| `scale` | 0.25 ratio | 25% size error is the threshold of "obviously wrong" |
| `rotate` | 0.5 rad (~30°) | Visible quadrant of rotation |
| `opacity` | 0.2 scalar | 20% of opacity range is a clear miss |
| `width`, `height` | 50 px | Same scale as translate |
| `top`, `left`, `right`, `bottom` | 50 px | Same scale as translate |

These are calibrated for *visible* deviations on typical UI elements (40–200px). They will need revisiting once #8 starts thresholding — that's the right time to learn from real data.

## Edge cases

| Case | Behavior |
|---|---|
| `resolveAnimation` race (animation gone before CDP call returns) | Emit prediction with `skipped: {reason: 'resolve-failed'}, predicted: [], boundingBox: null`. No Map entry. |
| `resolveAnimation` succeeds but the returned `Animation` has no `effect.target` (e.g., effect-less animations, document-targeted animations) | Emit prediction with `skipped: {reason: 'no-target-node'}, predicted: [], boundingBox: null`. No Map entry. |
| Target element detached before completion timer fires | `observe` Runtime call throws → return null. `animation-end` emitted with `reason: 'completed'`, no `deviation` field. Map entry dropped. |
| Animation animates only Tier-3 props | `skipped: 'unsupported-only'`, `predicted: []`, `unsupportedProperties: ['background-color']`. No Map entry; no end-time work. |
| Mixed Tier-1+Tier-3 animation | Predict Tier-1 properties only; list Tier-3 in `unsupportedProperties`. Deviation computed for predicted subset. |
| Animation with no keyframes | `skipped: 'no-keyframes'`. Defensive — WAAPI generally returns at least one keyframe. |
| `duration === 0` | `skipped: 'zero-duration'`. Mirrors the existing collector's gate that skips the setTimeout path for zero-duration animations. |
| `iterations !== 1` or `direction !== 'normal'` | `skipped: 'unsupported-timing'`. End-state math for these is real but out of v1 scope. |
| Page navigation mid-animation | `TemporalEventStream`'s `framenavigated` handler already calls `collector.detach()` → reattach. AnimationCollector's `detach()` is extended to call `verifier.clear()`. Pending predictions drop on the floor; no orphan state survives navigation. |
| Multiple concurrent animations on same element | Each has its own CDP `animationId` → independent Map entries; no interaction. |
| Composite transform across keyframes (e.g., `translateX(0)` → `translateX(100px) rotate(45deg)`) | `parseKeyframes` decomposes per-keyframe `transform` strings into components. Components absent from a keyframe default to identity (0 for translate/rotate, 1 for scale). |

## Testing

### Pure unit tests — `tests/unit/temporal/verifiers/animation/`

| File | Coverage |
|---|---|
| `keyframes.test.ts` | WAAPI raw keyframe array → normalized `PropertyPrediction[]`. Cases: transform composite (`translate + scale + rotate` decomposition), opacity-only, mixed Tier-1+Tier-3 (Tier-3 routes to `unsupportedProperties`), no-keyframes input. Fixtures: hand-authored objects mimicking `Animation.effect.getKeyframes()` output. |
| `interpolation.test.ts` | `valueAtFinalState(keyframes, timing)`. Verifies offset=1 = to-state for `iterations: 1` + `direction: 'normal'`. Negative tests: returns null for `direction: 'alternate'` w/ even iterations, `direction: 'reverse'`, `iterations: Infinity`. The file's existence proves "no easing function is evaluated." |
| `deviation.test.ts` | Per-property delta math + normalized score aggregator. Cases: all-zero deltas → score 0; one wildly-off property dominates score; mixed match+miss; observed property missing from observed map (drop from comparison rather than penalize). Verifies normalization constants. |
| `verifier.test.ts` | Orchestrator class with a mocked CDP session. State lifecycle: captureStart stores, observe reads + drops, discard drops, clear empties Map. No real Playwright. |

### Integration tests — `tests/integration/temporal/animation-verifier.test.ts`

Follows the existing AnimationCollector integration test pattern: static HTML fixture page with controllable animations, attach stream, drive the page, assert events.

| Scenario | Asserts |
|---|---|
| Button slides 100px via CSS animation | `animation-prediction` with `predicted: [{property: 'translateX', endValue: 100, unit: 'px'}]`, `boundingBox` non-null; `animation-end` with `deviation.score < 0.05` (tolerance for sub-pixel rounding) |
| Modal fades in (opacity 0→1) | Prediction `{property: 'opacity', endValue: 1, unit: 'scalar'}`; deviation score ~0 |
| Background-color-only transition | Prediction with `skipped: {reason: 'unsupported-only'}`, `unsupportedProperties: ['background-color']`; `animation-end` with no `deviation` field |
| Combined transform + background-color | Prediction with translateX in `predicted[]`, background-color in `unsupportedProperties`; deviation computed for translateX only |
| `iterations: infinite, direction: alternate` (spinner) | Prediction with `skipped: {reason: 'unsupported-timing'}`, no Map state retained |
| Animation canceled mid-flight (`el.style.animation = 'none'`) | `animation-end` with `reason: 'canceled'`, no `deviation`; verifier's pending Map empty afterward |
| Target detached before end | `animation-end` with `reason: 'completed'`, no `deviation`; no thrown exceptions in collector |
| Page navigation mid-animation | Verifier Map cleared via detach chain; no leaked events from the pre-navigation page |

### Performance budget

Each `captureStart` does two sequential CDP calls (resolveAnimation + callFunctionOn); each `observe` does one. Empirically these are sub-millisecond on a local CDP session. The concern is **wall-clock latency from CDP event arrival to prediction push** — not visible via the event's `timestamp` field (which derives from the CDP-reported `a.startTime`, not our code's execution time).

Budget: in the happy-path integration test, record `performance.now()` inside the `Animation.animationStarted` handler before delegating to the verifier, and again immediately after `stream.push('animation-prediction', …)`. Assert the difference is under 20ms. This is a regression guard against the verifier accidentally doing synchronous heavy work (e.g., parsing a massive keyframe set).

Note that `animation-start.timestamp` and `animation-prediction.timestamp` will be near-identical by construction — both come from the same `a.startTime` — and order in the buffer is what matters for downstream consumers, not the timestamp delta.

## Out of scope (explicit non-goals — repeated for emphasis)

1. **Imperative rAF-driven animations** — no `animationStarted` fires, no trigger. Future work in optical-flow extrapolation or design-system priors (#4).
2. **Tier-3 properties** (color, filter, clip-path) — emit `skipped: 'unsupported-only'` for now; possibly future visual-tier work.
3. **Mid-animation continuous comparison** — endpoint-only in v1.
4. **Optical-flow hybrid mode** — bbox is captured but not consumed; separate design pass.
5. **Configurable thresholds** — hardcoded constants for v1.
6. **Multi-iteration / alternate / reverse animations** — `skipped: 'unsupported-timing'`.
7. **Severity buckets** — policy belongs in #8.
8. **Pre-existing AnimationCollector bug for `iterations: Infinity`** (emits one premature `animation-end` after first iteration's duration). Pre-existing, out of scope. Worth a follow-up issue.

## Open questions / follow-ups

- **Calibrating the normalization SCALE constants.** The values listed are educated guesses; #8 will need empirical tuning once it starts thresholding the score. Likely a one-PR follow-up after #8 has a working trigger loop with real-app data.
- **Element bbox at end-time, not just start-time.** v1 captures bbox once at start. If future hybrid mode wants to compare predicted-end-bbox to observed-end-bbox (a geometric deviation in its own right), end-time bbox capture is one line away. Not in v1 because we'd need to define how it composes with the per-property deltas.
- **Animations with `pseudoElement` targets** (e.g., `::before`, `::after`). `resolveAnimation` should still work; `getBoundingClientRect` on a pseudo-element doesn't. Either skip with a new reason or fall back to the host element's bbox. Decide when a real test case appears.

## Implementation phasing (rough — full task breakdown in subsequent plan)

1. **Types + payload extensions** — `EventType` union, `AnimationPredictionPayload`, extended `AnimationEndPayload`. Pure file edits, builds without changing behavior.
2. **Pure helpers** — `keyframes.ts`, `interpolation.ts`, `deviation.ts` with their unit tests. No collector changes yet.
3. **Verifier class** — `verifier.ts` with mocked-CDP unit tests. Still no collector integration.
4. **Collector integration** — wire `verifier.captureStart` / `observe` / `discard` / `clear` into `AnimationCollector` lifecycle. Existing AnimationCollector tests must still pass.
5. **Integration tests** — static HTML fixtures, real Playwright. Verify full timeline shape.
6. **Docs + roadmap update** — flip the row in `docs/architecture.md`'s "Current implementation" table from "Not yet built" to a brief summary.

## References

- [`src/pipelines/temporal/collectors/animation.ts`](../../../src/pipelines/temporal/collectors/animation.ts) — existing collector being extended
- [`src/pipelines/temporal/collectors/types.ts`](../../../src/pipelines/temporal/collectors/types.ts) — EventType union + payload definitions
- [`src/pipelines/temporal/event-stream.ts`](../../../src/pipelines/temporal/event-stream.ts) — TemporalEventStream + ClockNormalizer
- [CDP Animation domain spec](https://chromedevtools.github.io/devtools-protocol/tot/Animation/) — `animationStarted`, `resolveAnimation`, `KeyframesRule`
- [WAAPI `Animation.effect.getKeyframes()`](https://developer.mozilla.org/en-US/docs/Web/API/KeyframeEffect/getKeyframes) — normalized per-property keyframe shape
- [WAAPI `Animation.effect.getComputedTiming()`](https://developer.mozilla.org/en-US/docs/Web/API/AnimationEffect/getComputedTiming) — iterations, direction
