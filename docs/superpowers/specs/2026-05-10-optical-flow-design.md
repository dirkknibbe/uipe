# Optical Flow Pipeline — Design

**Date:** 2026-05-10
**Status:** Draft — pending user review
**Roadmap entry:** [`docs/autopilot-program-roadmap.md`](../../autopilot-program-roadmap.md) — sub-project #1
**Architecture source:** [`docs/architecture.md`](../../architecture.md) §"Techniques to borrow, ranked by impact" #1

## Goal

Make UI motion **measurable** rather than just **diffed**. The current cheap-tier signal (pHash Hamming distance) tells UIPE *that* a region changed; this pipeline tells it *how* the pixels moved. Output lands on the existing `TemporalEventStream` (shipped via PR #5), queryable through the existing `get_timeline` MCP tool, so questions like "show me everything that slid in from the right in the last second" become first-class.

## Primary consumer

**Me, the developer.** This is built for the first user who matters: someone who wants to read the timeline and *see* motion. Success criterion is that querying `get_timeline` for an `optical-flow.*` event during a real animation feels delightful — I see what happened, classified and timestamped, without the noise of raw vector dumps. This framing is load-bearing: it justifies optimizing for *introspectability* over throughput, and for *future-proof architecture* (neural flow, Rust, swappable backend) over time-to-ship.

## Non-goals (v1)

- Dense per-pixel flow as a consumer-facing artifact. Raw flow is intermediate; what surfaces on the timeline is region- and pattern-level abstractions.
- A complete motion taxonomy. v1 names four patterns and lets composites emerge from queries over stored kinematic primitives.
- Animation video / motion-graphics analysis. The architecture admits it later; v1 targets web-app UIs.
- 60Hz raw flow emission. Gated by pHash; runs only when something has actually changed.
- Hardware-tuning for the Intel Mac CPU dev box. Performance on CPU is acceptable but not the optimization target; the architecture is built for the future of GPU-equipped MCPaaSTA boxes and animation-rich UIs.

## Architecture

```
+----------------------+
| FrameCapture         |   existing — temporal/producers/frame-capture.ts
| produces frame PNGs  |
+----------+-----------+
           |
           v (PNG bytes per keyframe)
+----------------------+
| FlowProducer (TS)    |   NEW — temporal/producers/optical-flow.ts
| - pHash gate         |
| - spawns/manages     |
|   uipe-vision binary |
| - reads ndjson out   |
+----------+-----------+
           | spawn + stdin/stdout pipe
           v
+----------------------+
| uipe-vision (Rust)   |   NEW — crates/uipe-vision/
| - ort + RAFT-small   |
|   INT8 ONNX          |
| - DBSCAN clustering  |
| - primitives extract |
| - pattern classifier |
+----------+-----------+
           |
           v (ndjson lines)
+----------------------+
| FlowCollector (TS)   |   NEW — temporal/collectors/optical-flow.ts
| - implements         |
|   Collector iface    |
| - normalizes via     |
|   ClockNormalizer    |
+----------+-----------+
           |
           v
+----------------------+
| TemporalEventStream  |   existing
+----------------------+
```

## Components

### 1. `uipe-vision` Rust sidecar — `crates/uipe-vision/`

Single-binary Rust service. Reads PNG-encoded frames from stdin, emits primitives + classified events on stdout as newline-delimited JSON.

**Internal stages (per accepted frame):**
1. **PNG decode** — `image` crate → ndarray tensor
2. **Pre-processing** — normalize, resize to model's input shape
3. **Flow inference** — bundled RAFT-small INT8 ONNX via `ort`; pairs current frame with prior frame; returns flow field `[2, H, W]`
4. **Region clustering** — DBSCAN over `(x, y, vx, vy)` feature vectors. Output: list of coherently-moving regions with bounding box + cluster stats
5. **Primitive extraction** — per region: mean velocity vector, divergence (∇·v), curl (∇×v), velocity-magnitude variance, point count
6. **Pattern classification** — heuristic rules over current primitives + short region history; emits start/end events for the v1 pattern set

**Build:** Cargo workspace member at the repo root. Cross-compiles for `x86_64-apple-darwin` and `x86_64-unknown-linux-gnu`. ORT shared library bundled via the `ort` crate's distribution helpers.

**Model:** RAFT-small ONNX, post-training INT8 quantized. Source: community export (PINTO model zoo or similar) validated for our use, or self-exported from the original RAFT repo. Stored at `crates/uipe-vision/models/raft-small-int8.onnx`. Committed via Git LFS — repo-internal, deterministic for CI, simpler than first-run downloads.

**Inference budget:** 500ms per frame max. Frames exceeding the budget are dropped with a counter increment. Sustained drop rate >50% over 30s logs a perf warning.

### 2. `FlowProducer` — TypeScript, `src/pipelines/temporal/producers/optical-flow.ts`

Spawns and manages the `uipe-vision` subprocess. Subscribes to `FrameCapture` for new keyframes, applies pHash gating, writes qualifying frames to sidecar stdin, parses ndjson from sidecar stdout.

**pHash gating:** uses the pHash already computed by the visual pipeline. If Hamming distance below the configured threshold (default 5) **and** not in a burst window, the frame is dropped before reaching the sidecar. Burst windows are triggered by recent user input — the visual pipeline's existing event-driven keyframe strategy still applies.

**Lifecycle:**
- Sidecar started on first frame, kept warm thereafter (avoids ONNX session re-init cost)
- Crash → exponential backoff restart (1s, 2s, 4s, capped at 30s)
- Three consecutive failed restarts → permanent disable for the session, logged warning, optical-flow signal marked unavailable to MCP consumers. Rest of UIPE keeps running (graceful degradation rule)

**Rate limiting:** raw events emitted at most 10Hz to the collector. Region and motion events emit whenever the sidecar produces them — their natural cadence is already sparse.

**Frame-pair handling:** the sidecar pairs each accepted frame with the most recent prior accepted frame. If pHash drops several intermediate frames, the pair spans the gap — accepted on the principle that "motion that crossed N skipped frames" is still real motion. This may introduce velocity-magnitude inflation for fast events; flagged as an open question for empirical tuning.

### 3. `FlowCollector` — TypeScript, `src/pipelines/temporal/collectors/optical-flow.ts`

Implements the existing `Collector` interface (same shape as `InputCollector`, `MutationCollector`, `NetworkCollector`, `AnimationCollector`, `PHashCollector`). Subscribes to `FlowProducer`'s parsed events, normalizes timestamps via `ClockNormalizer`, pushes into the `TemporalEventStream` ring buffer. Wired in `server.ts`'s `ensureStreamAttached`.

### 4. Three event kinds

Added to the existing `TemporalEvent` discriminated union — additive only, no changes to existing event types (per the shared-types contract rule from `CLAUDE.md`).

```typescript
interface OpticalFlowRawEvent {
  kind: 'optical-flow.raw';
  ts: number;                   // monotonic, normalized
  frameTimestamp: number;       // raw frame capture timestamp
  // Sparse representation: top-K keypoints with strongest flow
  keypoints: Array<{
    x: number; y: number;
    vx: number; vy: number;
    magnitude: number;
  }>;
  // Coarse grid summary covering the full viewport
  gridSummary: {
    cols: number;
    rows: number;
    vectors: number[];          // flattened (vx, vy) pairs, length = 2 * cols * rows
  };
}

interface OpticalFlowRegionEvent {
  kind: 'optical-flow.region';
  ts: number;
  frameTimestamp: number;
  regionId: string;             // stable across frames where the region persists
  bbox: { x: number; y: number; w: number; h: number };
  primitives: {
    meanVelocity: { vx: number; vy: number };
    divergence: number;         // ∇·v — positive = expansion, negative = contraction
    curl: number;               // ∇×v — sign indicates rotation direction
    speedVariance: number;
    pointCount: number;         // count of flow vectors clustered into this region
  };
}

type MotionPattern = 'translation' | 'scale' | 'rotation' | 'stillness';

interface OpticalFlowMotionEvent {
  kind: 'optical-flow.motion';
  ts: number;                   // phenomenon start time
  endTs?: number;               // populated on phenomenon end; absent while ongoing
  regionId: string;
  pattern: MotionPattern;
  params: TranslationParams | ScaleParams | RotationParams | StillnessParams;
  confidence: number;           // 0-1, heuristic confidence
}

interface TranslationParams {
  direction: { vx: number; vy: number }; // unit vector
  speedPxPerSec: number;
  durationMs?: number;          // populated on end
}

interface ScaleParams {
  sign: 'expand' | 'contract';
  centroid: { x: number; y: number };
  rate: number;                 // divergence value
}

interface RotationParams {
  sign: 'cw' | 'ccw';
  centroid: { x: number; y: number };
  angularSpeedRadPerSec: number;
}

interface StillnessParams {
  durationMs: number;           // sustained stillness window
}
```

The MCP `get_timeline` tool already supports `kind` filtering, so consumers can request `kind: 'optical-flow.motion'` to skip the lower layers by default and drop down to `optical-flow.region` / `optical-flow.raw` when debugging or doing power-user queries.

## Algorithm choice rationale

**Why Rust:** single-binary deploy, no venv juggling, type system pays off in the clustering + classification layer, cross-compile story is clean for the MCPaaSTA cloud path. The actual flow math runs in C++ (via ONNX Runtime) regardless of binding language — Rust is the *integration* language, not the math language.

**Why RAFT-small over Farneback:**
- **Future-proof for the animation explosion.** AI-era UIs (v0, Lovable, Framer-generated content, generative interfaces) push toward large displacements, occlusions, and non-rigid motion — exactly where classical methods break and neural methods earn their cost.
- **Fine-tuning is the long-game moat.** Architecture doc #6 (world model) depends on session-data accumulation. RAFT can absorb that data via fine-tuning; Farneback's polynomial expansion cannot. Shipping classical forecloses on this from day one.
- **Domain expansion path.** RAFT was designed for general video; the animation-video use case lands cleanly in its home turf.
- **Same architectural shape.** Sidecar + ndjson + Rust producer/collector are identical regardless of backend, so the algorithm choice is reversible — a model-file swap, not a rewrite.

**Why INT8 quantization:** brings CPU inference into the 30-100ms range per 720p frame on the Intel Mac dev box. Acceptable given pHash gating means flow runs only when something changed. Quality validation on synthetic test pairs is a prerequisite (open question #2 below).

**Why DBSCAN for clustering:** density-based, doesn't require knowing the number of regions ahead of time, handles arbitrary region shapes, well-studied. Linfa or hand-rolled — implementation choice deferred to writing-plans.

**Classifier philosophy: kinematic primitives + minimal named patterns.** Primitives (divergence, curl, mean velocity, variance) are mathematical and complete — they carry the *information* of what's happening. Pattern names are *interpretation* on top, prone to taste calls and category-boundary regret. v1 names only the four primitives map cleanly to: `translation` (mean velocity), `scale` (divergence), `rotation` (curl), `stillness` (all below threshold). Composites (`pulse`, `shake`, `bounce`, `morph`, `fade`, `wipe`) emerge as heuristics over stored primitive series in later sub-projects, no pipeline changes required.

## Sidecar binary protocol

**Input (stdin):**
```
[4-byte big-endian length prefix][PNG bytes]
[4-byte big-endian length prefix][PNG bytes]
... (continuous stream of frames)
```

The sidecar internally maintains the prior frame and pairs each new frame with it. The producer never sends pairs explicitly — that's the sidecar's responsibility, so the producer doesn't carry frame-pair state.

**Output (stdout):** one JSON object per line. Schemas mirror the TypeScript event types in §"Three event kinds", with the addition of internal-only debug fields the producer strips before forwarding (e.g. raw flow tensor statistics, timing metadata). All fields use camelCase to match TS conventions.

**Stderr:** structured log lines (newline-delimited JSON with `level`, `msg`, `ts`). Producer forwards to the existing logger.

**Control channel:** none in v1. If model-swap-at-runtime is needed later, it lands as a typed command envelope on stdin. Punt to a follow-up.

## Data flow (per frame)

1. User interacts → `FrameCapture` produces a keyframe PNG
2. `FrameCapture` emits to subscribers including `FlowProducer`
3. `FlowProducer` computes pHash diff vs prior accepted frame; if below threshold and not in a burst window, drops
4. Qualifying frame written length-prefixed to sidecar stdin
5. `uipe-vision` pairs with prior accepted frame, runs flow → cluster → primitives → classify
6. Sidecar emits ndjson: 0–N region events, 0–1 raw event (rate-limited), 0–N motion events (start/end transitions)
7. `FlowProducer` reads ndjson, strips debug fields, hands typed events to `FlowCollector`
8. `FlowCollector` normalizes timestamps via `ClockNormalizer`, pushes to `TemporalEventStream`
9. Events available via `get_timeline` MCP tool

## Error handling / graceful degradation

- **Sidecar binary missing** (build artifact not present): `FlowProducer` logs a clear error pointing to the build command, disables itself, marks the signal unavailable in MCP responses. UIPE continues.
- **ONNX model file missing or invalid**: hard fail at sidecar startup with stderr message naming the expected path. Producer treats as unrecoverable.
- **Sidecar crash mid-session**: exponential backoff restart (1s, 2s, 4s, cap 30s). Three consecutive failed restarts → permanent disable for the session.
- **Inference timeout** (>500ms): frame dropped, counter incremented. >50% drop rate over a rolling 30s window → perf warning.
- **stdin/stdout pipe break**: treated as sidecar crash.
- **Malformed ndjson from sidecar**: log + drop the line; don't crash the producer.

## Testing

**Rust unit tests (`crates/uipe-vision/tests/`):**
- Synthetic frame pairs with programmatically-injected motion (pure translation, pure rotation, pure scale, mixed) → assert primitives match expected values within tolerance
- DBSCAN clustering on injected vector fields → assert region boundaries and counts
- Heuristic classifiers given crafted primitive sequences → assert correct pattern + params
- Stdin protocol: length-prefix parsing, partial-read handling, malformed input rejection

**TypeScript unit tests (`src/pipelines/temporal/__tests__/`):**
- Mock sidecar (writes canned ndjson) → assert events reach the collector
- pHash gating: below-threshold drops, burst windows override
- Lifecycle: crash → restart, max-retries → permanent disable, signal-unavailable propagation to MCP
- Event-type filtering integrity (raw rate-limit, region/motion pass-through)

**Integration tests:**
- Real sidecar binary spawned with a deterministic stub ONNX model returning fixed flow fields → end-to-end event flow verified
- Recorded UI animation fixtures (5–10 short clips: modal slide-in, dropdown reveal, button press, spinner, toast pop-in) → assert expected motion events appear with correct patterns

**Evaluation script (`bench/optical-flow-eval.ts`):**
- Runs the pipeline over the fixture corpus
- Reports: events/second by kind, classifier confusion on labeled fixtures, median primitive values per fixture, p50/p95 sidecar latency
- Hand-inspected for v1; precursor to the formal evaluation track (roadmap §"Evaluation")

## Implementation order

1. Cargo workspace + `uipe-vision` crate skeleton; `ort` dep wired; hello-world ONNX inference verified
2. PNG decode → tensor → inference → flow field, validated against synthetic frame pair
3. DBSCAN clustering + primitives extraction
4. Heuristic classifiers for the four v1 patterns
5. stdin length-prefixed protocol + stdout ndjson emission
6. Rust unit tests
7. TS `FlowProducer` with pHash gating + lifecycle management
8. TS `FlowCollector` + `TemporalEventStream` wiring + `server.ts` registration
9. TS unit tests
10. Integration tests with stub ONNX
11. Fixture corpus + evaluation script
12. README/doc updates (DEVELOPMENT.md build commands for the Rust binary; `docs/mcp-tools.md` if any new schemas surface; architecture doc table flips this row from "Not yet built")

## Open questions / risks

1. **RAFT-small ONNX provenance.** Community exports vary in quality. If we can't find a clean import-ready one, the fallback is self-export from the original PyTorch repo — adds ~1–2 days. The spec doesn't pick a specific source; writing-plans will.
2. **INT8 quantization quality.** Post-training quantization can degrade flow accuracy meaningfully on some inputs. Validation on synthetic test pairs is a prerequisite before committing to INT8. Fallback: fp16 or fp32 with the inference budget relaxed.
3. **Frame-pair timing under pHash gaps.** When pHash drops intermediate frames, pairing with the prior accepted frame may inflate velocity magnitudes. Plan is to ship as-is and tune based on real-fixture results.
4. **Git LFS vs first-run download for the ONNX model.** Spec picks Git LFS for simplicity; can revisit if the repo bloat becomes annoying.
5. **MCPaaSTA upgrade path is asserted but not validated.** When GPU lands, the assumption is that swapping the `ort` execution provider config is a one-line change. Validated only when MCPaaSTA actually gets there.

## Future expansion

- **SEA-RAFT swap** — drop-in model file replacement once ONNX export is available; same producer/collector interfaces
- **Fine-tuning on recorded UIPE sessions** — feeds the world-model long game (architecture doc #6)
- **Additional motion patterns** — `pulse`, `shake`, `bounce`, `morph`, `fade`, `wipe`, easing classifiers — added as heuristics over stored primitive series, no pipeline changes
- **Camera-move detection** for video-animation scope — whole-frame primitive aggregation, same shape as region detection at a coarser scale
- **GPU execution provider** — CoreML on Apple Silicon, CUDA on Hetzner; one-line `ort` config change
- **Per-region pHash hash signature** — pair flow-detected regions with element identity for object permanence across mutations (lines up with architecture-doc autopilot mapping: "object permanence")

## Connection to broader roadmap

- **Feeds #3 Predictive verification.** The `optical-flow.region` event's velocity time-series is exactly what predictive-vs-observed comparison needs. Predicted endpoint from CDP Animation API ↔ observed endpoint from flow region.
- **Feeds #7 Hierarchical loops.** pHash + flow constitute the cheap "frame loop" at ~16ms cadence the architecture doc specifies for rate-tiered perception.
- **Feeds #8 Anomaly-triggered attention.** Motion magnitude is a primary salience signal; flow deviating from predicted (via #3) becomes the formalized anomaly trigger.
- **Begins data collection for #6 World model.** Region trajectories accumulated over many sessions are a usable training corpus for the long-game moat.

Optical flow is the wedge that makes the rest of the autopilot stack legible. Without it, UIPE knows *that* the screen changed; with it, UIPE knows *how* — and the rest of the perception loop builds directly on the answer.
