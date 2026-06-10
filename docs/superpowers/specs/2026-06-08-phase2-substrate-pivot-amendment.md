# Amendment — Phase 2 substrate pivot (Fly is dead)

**Date:** 2026-06-08
**Status:** Active amendment — **substrate choice PENDING (Dirk's call, no rush)**
**Amends:**
- [`2026-05-31-personal-gpu-deploy-design.md`](2026-05-31-personal-gpu-deploy-design.md) — program spec (was "UIPE on Fly")
- [`2026-06-07-personal-gpu-deploy-phase2-vision-svc-design.md`](2026-06-07-personal-gpu-deploy-phase2-vision-svc-design.md) — Phase 2 design
- [`../plans/2026-06-07-personal-gpu-deploy-phase2-vision-svc.md`](../plans/2026-06-07-personal-gpu-deploy-phase2-vision-svc.md) — Phase 2 plan

This document is the **live source of truth** for everything substrate-related in the
three docs above. Where they say "Fly", "A10", "approval gate", "ephemeral A10
deploy", or name Tasks 1 / 9 / 12, **this amendment overrides them.** Those docs keep
their original text as the decision trail; the Fly-specific work items are marked
`⚠️ SUPERSEDED` inline and replaced here.

---

## 1. Why this amendment exists

Fly.io is **no longer a viable GPU substrate** — for any phase, not just the earlier
approval gate.

- The Phase-2 deploy attempt hit the org capacity gate: *"organization is not allowed
  to use GPU machines."*
- Fly billing's reply: **Fly GPUs are deprecated and gone after July 31 2026**
  ([announcement](https://community.fly.io/t/gpu-migration-fly-io-gpus-will-be-deprecated-as-of-july-31-2026/27110),
  [blog](https://fly.io/blog/wrong-about-gpu/)).

So the program-spec premise ("UIPE on Fly") and every Fly-locked decision (program-spec
D2 = "Hosting platform = Fly.io"; Phase-2 P2-1 = "ephemeral Fly A10") are dead. The
two criteria Fly burned us on — **vendor stability (GPU as a core business, not a side
bet)** and **no approval gate** — now dominate substrate selection. `flyctl` v0.4.58 is
installed but unused.

## 2. What still stands (NOT affected by the pivot)

The pivot is **substrate-only**. Everything the contract/CPU work produced is
substrate-independent and already merged:

- **PR #22** (CPU impl, Tasks 2–10) merged to `master`: `@uipe/contracts` `/v1`
  snake_case schema + zod, cross-language JSON fixtures (zod + Pydantic), the
  `packages/vision-svc/` Python package (config, schema, mapping, FastAPI handler +
  status/reason classification ladder, lazy analyzer, bench scoring). 26 CPU pytest +
  contracts green.
- **PR #23** (this branch) merged to `master`: `HostedApiAnalyzer` + 3 research reports
  + `run_bench.py`/README. 30/30 vision-svc pytest.
- **The `/v1/analyze` contract, the status/reason enum, the classification ladder, the
  fixture-driven cross-language tests, `mapping.py`** — all unchanged. The substrate
  does not touch the wire format.
- **Three pluggable analyzer backends** (the duck-typed `Analyzer` protocol makes the
  substrate a **config flag, not a rewrite**):
  - `HostedApiAnalyzer` — OpenAI-compatible hosted VLM (Hyperbolic / DeepInfra /
    OpenRouter). No GPU, runs anywhere incl. the Intel Mac. `app/hosted.py`.
  - `QwenAnalyzer` — CUDA. Runs unchanged on Modal **or** a local 3090. `app/qwen.py`.
  - `MlxAnalyzer` — Apple Silicon only. **Not built** (sketch at
    `docs/research/2026-06-07-qwen25vl-apple-silicon-mlx-sketch.py`).
  - Switch: `VISION_BACKEND=hosted|qwen` in `build_default_app` (`app/main.py`).

The `Dockerfile` stays as the portable CUDA reference image (works on Modal and a 3090
unchanged); only `fly.toml` is now dead.

## 3. The substrate decision (matrix — choice PENDING)

Research ran as 3 parallel workflows on 2026-06-07; full reports in
`docs/superpowers/research/`. Honest framing up front: **at UIPE's volume (single-tenant,
intermittent, a few hundred screenshots/day) cloud is ~$0–3/mo and a homelab NEVER
breaks even on cost.** The homelab is a *privacy / independence / learning* bet, not a
savings play. Don't justify hardware as cloud savings — that math never closes.

### 3a. The three live options

| Option | What it is | $ at our volume | CUDA for optical-flow later? | No-rewrite? | Key caveat |
|---|---|---|---|---|---|
| **Hosted API** (built, ready now) | `HostedApiAnalyzer` → Hyperbolic / DeepInfra / OpenRouter | **~$3.42/mo** (Hyperbolic ~$0.20/M tok); OpenRouter free 7B for throwaway | ❌ token API can't serve optical-flow | ✅ already built | No weight/version control (eval drift); screenshots leave the boundary |
| **Modal** (cloud serverless) | Declarative GPU in a `@function`/ASGI decorator; `QwenAnalyzer` runs as-is | **~$0–10/mo** ($30/mo free credit ~zeroes it; A10 $1.10/hr, L4 $0.80/hr, idle=$0) | ✅ same substrate serves both tracks | ✅ near-verbatim FastAPI | Cold-start on each burst (snapshots mitigate; benchmark the 7B before Phase 4) |
| **Used RTX 3090 rig** (homelab) | DIY x86_64 CUDA-12 tower, 24 GB | **~$1,950 up front**, then electricity | ✅ frictionless — `ort`/RAFT + bitsandbytes LoRA just pip-install | ✅ `qwen.py` runs unchanged | Never pays back vs cloud; noise/heat (undervolt, repad, site in a closet) |

**Decision matrix detail (from the research):**

- **Cloud serverless ranking:** **#1 Modal** — the only substrate that maxes every
  weighted criterion at once: verified scale-to-zero by default, verified **no approval
  gate** (free Starter ships 10 GPU concurrency, only a Stripe card required), strongest
  stability ($355M Series C @ $4.65B, ~$300M ARR, **GPU inference IS the product**), 24 GB
  A10/L4 self-serve, $30/mo credit, best FastAPI DX. **#2 RunPod Serverless** (verified
  scale-to-zero, ~$0.68/hr, same account gives raw CUDA Pods for optical-flow; loses on
  billed cold-starts, no free credit, handler-wrapper porting, seed-stage). #3 Cloud Run
  GPU, #4 Baseten, #5 Cerebrium. **Avoid: Azure ACA, Fal-custom — real approval gates
  (Fly-shaped).**
- **Homelab ranking:** **#1 used RTX 3090 (24 GB) ~$1,950** — cheapest *frictionless*
  CUDA; the boring x86 discrete-GPU path that "just works" for `ort`/RAFT + LoRA;
  upgradeable to 48 GB with a 2nd card. **Runner-up DGX Spark $4,699** (128 GB unified,
  near-silent, but aarch64/sm_121/CUDA-13 forces an ORT **source-build** that lands right
  on the optical-flow sidecar). Parts list in the homelab report.
- **Apple Silicon:** runs the VLM beautifully (MLX) and *most* of the roadmap
  (optical-flow via ORT **CoreML EP** — the "RAFT grid_sample can't do CoreML" claim is a
  **myth** for the MLProgram path), but has **no CUDA** for full training / CUDA-EP perf
  benchmarks. Buy a Mac only if it's a dev machine you'd want anyway (then the marginal
  "GPU" cost is the RAM upgrade). Not a recommendation to buy hardware *for UIPE*.

### 3b. Recommended sequence (research's strategic call — NOT a committed decision)

The optical-flow roadmap, not cost, breaks the tie. A token API can serve `analyze`
cheaply forever but **fundamentally cannot serve the optical-flow CUDA track** — so a
self-host substrate is eventually non-optional. Given that:

1. **Now (validate Phase 2):** run the eval on the **hosted API** — already built, idle=$0,
   no GPU ceremony. Hyperbolic/DeepInfra for the real 7B; OpenRouter's free 7B for
   throwaway A/B + provider failover.
2. **When you need your own `/v1/analyze` detection-shaped output that a token API won't
   give, OR the optical-flow CUDA port begins:** stand up **Modal** (cloud) so both tracks
   share one stable, no-gate, scale-to-zero substrate — *or* buy the **3090 rig** if you
   want to own the box (privacy/independence/learning).

**This is a recommendation, not a lock.** The hardware purchase is Dirk's to mull, no
rush. The amendment stays substrate-agnostic until he picks; §4 below works for whichever
he chooses.

## 4. Substrate-agnostic deploy plan (replaces Fly Tasks 1 / 9 / 12)

The old plan's three ops tasks were Fly-specific. Replacements below are written so the
**body is identical regardless of substrate** and only a per-substrate "bring-up"
appendix differs. None of these are started; they cost money/hardware, so they wait on
the §3 decision.

### Task 1′ — Substrate bring-up (replaces "Fly A10 capacity/region gate")

The old Task 1 verified Fly A10 capacity. The pivot's equivalent is: **stand up the
chosen substrate and confirm a 24 GB-class CUDA GPU (or hosted endpoint) answers a
trivial inference.** Pick one bring-up path:

- **Hosted API:** get a provider key → set `VISION_BACKEND=hosted`,
  `VISION_API_KEY=…`, `VISION_HOSTED_BASE_URL`, `VISION_HOSTED_MODEL` → no capacity gate
  exists. Done when `/v1/health` is ready and one screenshot round-trips.
- **Modal:** `modal token new` (Stripe card on file; no approval gate) → wrap the FastAPI
  app in a Modal ASGI function requesting an A10/L4 → `modal deploy`. Done when the
  deployed URL serves `/v1/health` and a cold `/v1/analyze` returns within the warming
  budget. Benchmark the real 7B cold-start before relying on it for Phase 4.
- **3090 rig:** assemble the box, install CUDA-12 + the model deps, run `app/qwen.py`
  locally (CUDA, unchanged). Done when `nvidia-smi` shows the card and `/v1/analyze`
  returns on a real screenshot.

**Acceptance:** a reachable `/v1/analyze` (cloud URL or `localhost`) returns a valid
`VisionAnalyzeResponse` for one golden screenshot. No `fly.toml`, no capacity escalation
path needed (Modal/hosted have no gate; the 3090 is owned hardware).

### Task 9′ — Deploy config (replaces "Dockerfile (CUDA) + Fly config")

The CUDA `Dockerfile` **stays** as the portable reference image. The Fly-specific
`fly.toml` is **dead** — leave it in the tree as a historical artifact or delete it
(low stakes; it's 254 bytes). The replacement config is per-substrate:

- **Hosted API:** no image, no infra config — just env vars.
- **Modal:** a small `modal_app.py` (the `@app.function(gpu="A10G")` + `@modal.asgi_app`
  wrapper returning `create_app(QwenAnalyzer(cfg))`). Reuses the `Dockerfile`/requirements
  via `modal.Image.from_dockerfile(...)` or an equivalent image spec.
- **3090 rig:** a `systemd` unit (or `docker run --gpus all`) running
  `uvicorn app.main:app` against the local card. Reuses the `Dockerfile` directly.

### Task 12′ — Deploy → Unit-0-lite bench → golden eval → (teardown) (replaces the ephemeral Fly deploy)

Same shape as the old Task 12, minus Fly's spin-up/`fly apps destroy` teardown:

1. Bring up the substrate (Task 1′).
2. `python bench/run_bench.py --base-url <substrate-url-or-localhost>` against the golden
   set (golden set is still a TODO — see §5).
3. Score; record the model decision + scorecard in `bench/SCORECARD.md`.
4. **Teardown is substrate-specific:** Modal/hosted scale to zero automatically (no
   `fly apps destroy` step — idle = $0); the 3090 just idles. The "destroy to stop
   billing" step from the Fly plan **no longer applies**.

`run_bench.py` is already substrate-agnostic — it takes `--base-url`, so it points at a
Modal URL, a hosted gateway (via the service), or `localhost` with no code change.

## 5. Still TODO (unchanged by the pivot)

- **Golden set** for the scored eval (`bench/golden/` + `expected/*.json`) — ~10–20 real
  UIPE screenshots hand-labeled with expected elements. Blocked until a model is actually
  running (any backend). Reuse `landing/screenshots/` + engine fixtures as the seed.
- **The actual deploy + eval run** (Task 12′) — waits on the §3 substrate decision.
- **Phases 3 (pipeline adaptation) and 4 (session-host + persistent deploy + egress)** —
  still high-level only. The Fly-specific parts of the program spec (private-net routing,
  Fly egress CIDR firewall, Fly secrets for the bearer token) need their own re-spec
  against the chosen substrate when Phase 4 starts. The SSRF *app-layer* defense is
  substrate-independent and stands; the *network-layer* egress firewall was Fly-specific
  and must be re-designed for the new substrate.

## 6. Decision-record deltas (what changed in the amended docs)

| Original | Status after this amendment |
|---|---|
| Program-spec **D2** "Hosting platform = Fly.io" | **Superseded** — substrate PENDING (§3). |
| Phase-2 **P2-1** "GPU substrate = ephemeral Fly A10" | **Superseded** — replaced by §3 matrix + §4 substrate-agnostic plan. |
| Phase-2 spec toolchain note "runs on Fly's Linux + CUDA A10" | **Amended** — runs on the chosen CUDA substrate (Modal/3090) or a hosted API; still free of the torch-2.2.2 Mac pin; `weights_only=True` still enforced. |
| Plan **Task 1** (Fly A10 capacity gate) | **Superseded** → Task 1′ (§4). |
| Plan **Task 9** (Dockerfile + `fly.toml`) | **Amended** — Dockerfile stays; `fly.toml` dead → Task 9′ (§4). |
| Plan **Task 12** (ephemeral Fly deploy + `fly apps destroy`) | **Superseded** → Task 12′ (§4); teardown step removed (scale-to-zero). |
| Program-spec Fly egress CIDR firewall / private net / Fly secrets | **Deferred to Phase 4 re-spec** against the new substrate (§5). |

All other Phase-2 decisions (P2-2 … P2-6, the contract, the classification ladder, the
testing posture) are **unchanged**.
