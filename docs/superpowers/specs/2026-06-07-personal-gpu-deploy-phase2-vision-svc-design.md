# Phase 2 — `vision-svc` (Qwen analyze track)

**Date:** 2026-06-07
**Status:** Design — approved in brainstorm, pending implementation plan
**Parent spec:** [`2026-05-31-personal-gpu-deploy-design.md`](2026-05-31-personal-gpu-deploy-design.md) — this is the detailed design for that spec's **Phase 2**. It inherits all locked program decisions (Fly.io, Qwen2.5-VL-7B, two-tier vision, A10, on-demand GPU, bearer auth, SSRF defense) and does **not** re-litigate them.

## Overview

Build and validate the VLM "analyze" vertical slice of the personal GPU deploy: a Python `vision-svc` serving `/v1/analyze` with Qwen2.5-VL-7B, the pinned `@uipe/contracts` `/v1` schema it speaks, and a real-GPU benchmark + golden eval that confirm Qwen on actual UIPE screenshots. The engine's Intel Mac cannot run Qwen, so all model work runs on an **ephemeral Fly A10** that is spun up for the bench/eval and torn down after.

This phase delivers a validated, contract-tested vision service in isolation. It does **not** wire the service into the engine (Phase 3) or stand up a persistent Fly deployment (Phase 4).

## Scope

**In:**
- **Fly A10 capacity/region verification** — gating prerequisite (parent risk #1). Confirm an A10 is allocatable in an acceptable region before sinking effort.
- **`packages/vision-svc/`** — Python FastAPI service: `/v1/analyze` + `/v1/health`, Qwen2.5-VL-7B, own CUDA Dockerfile.
- **`@uipe/contracts` `/v1` analyze schema** — fleshed out (response, status object, error) + canonical JSON fixtures + both-sides contract tests.
- **Unit-0-lite benchmark** — Qwen-first on a golden set of real UIPE screenshots, run on the ephemeral A10. Challenge with InternVL2.5 / Florence-2 only if Qwen misses the bar.
- **Golden-screenshot eval** — scores `/v1/analyze` output against expected labels; dogfoods the real serve path + contract.

**Out (deferred):**
- `/v1/flow` optical-flow ONNX CUDA-EP port — its own phase (lower-uncertainty deterministic port; sequenced after this VLM slice).
- Structured `VisualUnderstanding` ("understand" depth) — Phase 3, as an additive optional contract field.
- session-host wiring, persistent Fly deploy (`infra/fly/`), SSE transport, egress firewall — Phase 4.
- Pipeline adaptation / OmniParser tier removal — Phase 3.
- SEA-RAFT swap — after the optical-flow phase.

## Decisions locked (this brainstorm)

| # | Decision | Rationale |
|---|---|---|
| P2-1 | **GPU substrate = ephemeral Fly A10** (spin up → bench/eval → tear down) | Same substrate as the eventual production target; knocks out the Fly A10 availability prereq now. |
| P2-2 | **VLM analyze track only**; optical-flow CUDA-EP port → its own phase | One model type at a time; cleanest vertical slice; least GPU cost per iteration. |
| P2-3 | **Qwen-first benchmark**; challenge with InternVL2.5/Florence-2 only if Qwen misses the bar | Qwen is the inherited default; least GPU cost; vision-degraded escape hatch covers total failure. |
| P2-4 | **Detection-shaped `/v1/analyze` response** (`elements[]` + status); `VisualUnderstanding` deferred to Phase 3 | Smallest stable surface; additive-safe per the contract rule; golden eval scores element labels. |
| P2-5 | **Contract enforced via shared JSON fixtures**, validated both sides (TS + Pydantic) | No codegen; language-agnostic; drift on either side fails that side's fixture test. |
| P2-6 | **Status reported as an enum + discriminated `reason`**, not booleans | Makes `warming && degraded` unrepresentable; `reason` distinguishes transient from fatal. |

## Components

```
packages/vision-svc/            # NEW — Python, FastAPI. Python-managed (no package.json),
  app/                          #   outside the pnpm workspace graph, like sidecar/.
    main.py                     #   FastAPI app: POST /v1/analyze, GET /v1/health
    qwen.py                     #   model load + warmup + inference (Qwen2.5-VL-7B)
    mapping.py                  #   Qwen raw output -> /v1 contract DTO (the insulation layer)
    schema.py                   #   Pydantic models for /v1 (validated against shared fixtures)
    config.py                   #   env: model id, device, timeout, warmup
  bench/
    run_bench.py                #   Unit-0-lite: POST golden screenshots to /v1/analyze, score
    golden/                     #   real UIPE screenshots + expected-label JSON (the fixture set)
  Dockerfile                    #   CUDA base image, model weights, weights_only=True load
  requirements.txt              #   pip-audit floor set (same discipline as sidecar/omniparser)
  tests/                        #   pytest: Pydantic validates shared fixtures; mapping unit tests

packages/contracts/             # EXTENDED
  src/index.ts                  #   + VisionElement, VisionAnalyzeResponse, status/reason, VisionError
  fixtures/v1/                  #   canonical JSON: analyze.request.json, analyze.response.*.json,
                                #     *.invalid.json — the cross-language source of truth
  tests/                        #   vitest: each fixture validated against the TS types + a zod schema
```

`sidecar/omniparser/` is **untouched** in Phase 2 (it is removed in Phase 3 when the pipeline stops consuming it). `vision-svc` is new and parallel.

**Toolchain note:** `vision-svc` runs on Fly's Linux + CUDA A10, so it is **free of the torch 2.2.2 x86-macOS pin** that constrains the OmniParser sidecar (that pin is a Mac-hardware limit, not a code limit). It uses a current torch on a CUDA base image. `torch.load(weights_only=True)` is still enforced everywhere (carries forward the accepted-risk mitigation). A10's 24 GB VRAM fits a 7B VLM in fp16 (~16 GB) with headroom.

## The `/v1/analyze` contract

Wire format is **snake_case** — the contract is a wire DTO, not the engine's domain type. `core` maps it to its camelCase `VisualElement` (`bbox{w,h}` → `boundingBox{width,height}`, adds `id`, `visualProperties{}`) in Phase 3. Declaring the TS types in snake_case keeps the fixtures unambiguous and lets both validators check identical keys.

```ts
export const VISION_API_VERSION = 'v1' as const;
export interface BBox { x: number; y: number; w: number; h: number }

export interface VisionElement {
  label: string;            // "button" | "input" | "link" | "image" | "text" | "icon" | "dropdown" | ...
  confidence: number;       // 0–1
  bbox: BBox;
  text?: string;            // visible text
  is_interactable?: boolean;
  description?: string;
}

export type VisionStatus = 'ok' | 'warming' | 'degraded';
export type VisionReason =
  | 'model_loading'         // warming: load coroutine not finished at request time
  | 'inference_timeout'     // our timeout guard tripped (retryable)
  | 'inference_error'       // catch-all: model/processor/mapping threw (see message + logs)
  | 'unreachable';          // caller-synthesized (Phase 4) when the HTTP hop itself fails
  // 'oom' is intentionally NOT in v1 — added later once we confirm torch.cuda.OutOfMemoryError
  // catches cleanly on the real A10. Until then OOM surfaces as inference_error. Additive-safe.

export interface VisionAnalyzeRequest {
  api_version: typeof VISION_API_VERSION;
  png_base64: string;       // PNG screenshot, base64 (lossless — required for vision models)
  regions: BBox[];          // ROIs to classify; empty = whole-frame detection
  request_id?: string;      // optional caller correlation id; vision-svc generates one if absent
}

export interface VisionAnalyzeResponse {
  api_version: typeof VISION_API_VERSION;
  request_id: string;       // the caller's request_id, or one vision-svc generated; for log correlation
  status: VisionStatus;
  elements: VisionElement[];// [] when warming/degraded
  model_id: string;         // which model produced this (eval provenance)
  latency_ms: number;
  reason?: VisionReason;    // present when status != 'ok'
  retry_after_ms?: number;  // warming ETA, or backoff for a retryable degrade
  message?: string;         // human-readable, opaque, logs only — NEVER branched on
}

export interface VisionError {        // 4xx only — malformed request, bad api_version
  api_version: typeof VISION_API_VERSION;
  request_id: string;
  error: { code: string; message: string };
}
```

**Retryability is derived from `reason`** (`inference_timeout` / `unreachable` → retry; `inference_error` → don't), documented rather than carried as a redundant field.

### Failure classification (how `reason` is populated)

`vision-svc` is our own code, so we classify by **control-flow position + exception type — never by parsing error strings** (same lesson as the perception nav-error fix: structured signal over message regex). The handler is an ordered guard/except ladder:

```python
if not model_ready:                  return warming(reason="model_loading", retry_after_ms=...)
try:
    elements = await asyncio.wait_for(run_qwen(img, regions), timeout=cfg.timeout_s)
except asyncio.TimeoutError:         return degraded(reason="inference_timeout", retry_after_ms=...)
except Exception as e:               return degraded(reason="inference_error",
                                                     message=f"{type(e).__name__}: {e}")  # opaque
```

- `model_loading` is **not an error** — it is a readiness flag we own (the startup load coroutine has not set `model_ready`).
- `inference_timeout` is **our own** `asyncio.wait_for` guard firing — we set the deadline, so we know.
- `inference_error` is the **honest catch-all**. We do not invent sub-classification we cannot reliably detect; raw `type(e).__name__ + str(e)` goes into `message` and the full traceback into structured logs keyed by `request_id`.
- The **`reason` enum = exactly what we can structurally detect**, and grows additively as detection improves (e.g. `oom` once `torch.cuda.OutOfMemoryError` is confirmed catchable on the A10). It never shrinks (contract rule).
- `message` is opaque, best-effort, human/log only. No consumer parses it.

### Shared-fixture enforcement

`packages/contracts/fixtures/v1/` holds canonical JSON payloads (valid request, valid `ok`/`warming`/`degraded` responses, and invalid variants) as the cross-language source of truth:
- **TS side (vitest):** each fixture is validated against the TS types + a zod runtime schema — valid fixtures parse, invalid fixtures are rejected.
- **Python side (pytest):** `vision-svc` validates the *same files* against its Pydantic models.
- A schema drift on either side fails that side's fixture test. Both run in CI without a GPU.

## Bench / eval workflow (ephemeral A10)

1. **A10 capacity/region gate** — `fly` CLI check + a minimal GPU smoke deploy. If no A10 is allocatable in an acceptable region, escalate before proceeding.
2. **Golden set** — ~10–20 real UIPE screenshots (reuse engine fixtures / capture from the engine) hand-labeled with expected elements; lives in `vision-svc/bench/golden/`.
3. **Ephemeral deploy** — `fly deploy` `vision-svc` to a throwaway app.
4. **`run_bench.py`** (from the Mac) POSTs each golden screenshot to the real ephemeral `/v1/analyze` and scores output — **dogfooding the contract and serve path**.
5. **Decision** — Qwen passes the bar → confirmed. Else add InternVL2.5 / Florence-2, re-run, pick best, or trip the vision-degraded escape hatch (never block the deploy on model selection).
6. **Teardown** — destroy the ephemeral app; record the model decision + scorecard in `vision-svc/bench/`.

### Acceptance bar (starting numbers, tunable)

- **Interactable-element recall ≥ 80%** — of the hand-labeled interactable elements, ≥80% detected with the correct `label` and bbox IoU ≥ 0.5 against the expected box. (Interactable elements are what the affordance/fusion pipeline depends on; non-interactable text/decoration is lower stakes.)
- **bbox match = IoU ≥ 0.5** for a detection to count as "matched."
- **Warm-path p95 latency < 8 s** for `/v1/analyze` on a warm A10. (The program target is 3–5 s; 8 s is the v1 pass/fail floor, with 3–5 s as the aspiration to tune toward.)

These are explicit so the bench has a definition of "good"; they are tunable and the escape hatch covers total failure.

## Error handling / degradation

- **GPU booting** → `200 { status: 'warming', reason: 'model_loading', retry_after_ms, elements: [] }`. The caller treats it as no-vision-this-tick (graceful degradation), not an error.
- **Inference failure** → `200 { status: 'degraded', reason, elements: [] }`. Structural-only fallback downstream, matching the engine's existing graceful-degradation principle. Reserve `4xx VisionError` for malformed requests / bad `api_version`.
- **Timeout** — configurable (`cfg.timeout_s`); on trip the caller treats the result as degraded/retryable.
- **`torch.load(weights_only=True)`** everywhere; never load untrusted weights.

## Testing posture

1. **Contract fixtures, both sides (CI, no GPU)** — the primary defense. TS + Pydantic validate the same canonical JSON.
2. **`mapping.py` unit tests (no GPU)** — feed recorded raw Qwen outputs, assert the produced `/v1` DTO. This is where the model-specific parsing risk (parent risk #3) is pinned.
3. **Golden eval (real GPU, manual)** — quality check run on the ephemeral A10, not CI. Produces a scorecard. The only signal that validates real vision quality.
4. **`/v1/health`** — readiness probe (model loaded?), exercised by the smoke step.

No GPU in CI; the contract + mapping tests cover the CI surface. (The contract-conformant mock `vision-svc` for the Phase 4 docker-compose harness is enabled by these fixtures.)

## Sequencing within Phase 2

1. **A10 capacity/region gate** (escalate on failure).
2. **Contracts `/v1` schema + fixtures + both-sides tests** (TS now; Python side validated once `vision-svc` exists).
3. **`vision-svc` skeleton** — FastAPI, `schema.py`, `mapping.py`, `/v1/health`, CUDA Dockerfile, pip-audit floor.
4. **Qwen `/v1/analyze`** — load + warmup + inference + the classification ladder.
5. **Golden set assembly + `run_bench.py`.**
6. **Ephemeral A10 deploy → Unit-0-lite bench → confirm Qwen (or challenge) → golden eval scorecard.**
7. **Teardown; record the model decision + scorecard.**

## Risks / open questions

1. **Fly A10 availability/region** (parent risk #1) — owned here as the gating first step. If unavailable, the whole personal-deploy substrate assumption needs revisiting.
2. **Qwen output-format → contract mapping** (parent risk #3) — expect prompt iteration; pinned by `mapping.py` unit tests on recorded outputs + the golden eval.
3. **Acceptance-bar calibration** — the 80% / IoU 0.5 / 8 s numbers are first guesses; the first golden-eval run calibrates them.
4. **Ephemeral-GPU cost discipline** — each bench run is billable A10 time; the Qwen-first decision and teardown step keep it bounded.
5. **`vision-svc` under `packages/`** — it has no `package.json`, so pnpm's `packages/*` glob skips it; confirm pnpm emits no error (fallback: move to a top-level `vision-svc/` like `sidecar/`).
