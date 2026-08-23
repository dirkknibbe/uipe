# Checkpoint: Phase 2 — post-Fly substrate pivot — 2026-06-07

Continues from `docs/plans/2026-06-07-phase2-vision-svc-kickoff.md`. This session
shipped the Phase-2 CPU implementation, then pivoted hard when Fly killed its GPUs.

## What we did
1. **Implemented Phase-2 Tasks 2–10 (CPU TDD) → PR #22, MERGED to `master`.** Subagent-driven (Opus implementer per task, controller review). Contracts `/v1` snake_case + zod; canonical cross-language JSON fixtures (validated by BOTH zod and Pydantic); the `packages/vision-svc/` Python package (config, schema, mapping, FastAPI handler with the status/reason classification ladder, lazy `QwenAnalyzer`, CUDA Dockerfile + fly.toml, bench scoring). 26 CPU pytest green, workspace tsc clean.
   - **Caught + fixed a latent plan bug:** Task 8's `app = None` would shadow the PEP 562 `__getattr__`, so `uvicorn app.main:app` would serve `None`. Dropped it, added `tests/test_entrypoint.py`, corrected the plan doc.
2. **Fly is DEAD as a substrate.** Tried to deploy: capacity gate hit "organization is not allowed to use GPU machines"; emailed billing@fly.io; reply = **Fly GPUs are deprecated, gone after Aug 1 2026** (https://fly.io/blog/wrong-about-gpu/). Abandoned Fly for all phases.
3. **Ran 3 research workflows** (reports committed in `docs/superpowers/research/`):
   - **Cloud substrate → Modal #1** (serverless GPU, scale-to-zero, no approval gate, strongest vendor stability — GPU IS its business). RunPod serverless #2.
   - **Apple Silicon →** runs the VLM beautifully (MLX) + most of the roadmap (optical-flow via ORT **CoreML EP** — the "RAFT grid_sample can't do CoreML" claim is a MYTH for the MLProgram path), but **NO CUDA**.
   - **AI homelab hardware → used RTX 3090 (24GB) DIY tower ~$1,950 #1** — the paved x86_64 CUDA-12 path runs our `qwen.py` AS-IS + the RAFT/ORT optical-flow sidecar + bitsandbytes LoRA. **DGX Spark $4,699** runner-up (quiet/128GB but aarch64/sm_121 ORT source-build tax). Honest econ: cloud is ~$0–3/mo, a homelab NEVER breaks even — it's a privacy/independence/learning bet.
4. **Built `HostedApiAnalyzer`** (a 3rd pluggable backend) so the substrate becomes a config flag, not a rewrite.

## Current state
- **Branch `feat/personal-gpu-deploy-phase2-bench` → PR #23 MERGED to `master`** (2026-06-07): hosted-API backend + 3 research docs + `run_bench.py`/README. 30/30 vision-svc pytest. (Checkpoint previously said OPEN — corrected.)
- **2026-06-08: Fly-removal amendment WRITTEN + SHIPPED to PR #24** (next step 4 ✅): `docs/superpowers/specs/2026-06-08-phase2-substrate-pivot-amendment.md` — the live source of truth for the substrate pivot (Fly-dead rationale, the 3-option decision matrix with choice PENDING, substrate-agnostic Task 1′/9′/12′ replacing the Fly ops tasks, decision-record deltas). Program spec, Phase-2 spec, Phase-2 plan carry `⚠️ SUPERSEDED` banners.
- **PR #24 OPEN** (`feat/phase2-substrate-pivot-amendment`, base `master`, branched off `master` because PR #23 was squash-merged): https://github.com/dirkknibbe/uipe/pull/24. Two commits: (1) `a48cb95` the amendment + banners; (2) `9088e47` **context-hygiene excision** — per Dirk's call, the runnable `fly …` command blocks were EXCISED from the plan's Tasks 1/9/12 + bench runbook (chunked-retrieval poison risk: a retrieved mid-file chunk would show dead infra as runnable). SUPERSEDED markers kept; verbatim originals preserved in git history at `2da9816` (PR #21). **Dockerfile in Task 9 STAYS** (runs on Modal/3090); only `fly.toml`+Fly steps removed. Specs keep prose notes (low poison). **3rd commit `aa461e0`** (Dirk asked): neutralized the plan's remaining Fly PROSE too — Goal/Architecture/Tech-Stack/file-structure/Definition-of-done + the Task 8 note now substrate-agnostic; also fixed the **shipped `run_bench.py` module docstring** (dropped "ephemeral Fly A10" + the `.fly.dev` usage example → substrate-neutral `--base-url`). 30/30 vision-svc pytest still green. Specs still keep their prose (Dirk's "command blocks" scope was for the excision; the plan-prose cleanup was a follow-up he requested).
- **vision-svc has 3 pluggable backends:** `HostedApiAnalyzer` (cloud/local, no GPU, works on the Intel Mac), `QwenAnalyzer` (CUDA — runs on Modal OR a 3090 unchanged), MLX (only if Apple — NOT built).
- **Decisions still OPEN:** the substrate/hardware choice (lean: 3090 homelab to own it, else Modal/hosted-API cloud) and the actual deploy. Hardware purchase is Dirk's to mull — **no rush** ("test today" was deprioritized; cloud is ~$0–3/mo).
- The Phase-2 spec + plan still carry stale **Fly** assumptions — they need a substrate-pivot amendment + a new deploy plan (replaces the old Fly Tasks 1/9/12).

## Key files & context
- `packages/vision-svc/app/hosted.py` — `HostedApiAnalyzer` (OpenAI-compatible VLM); `app/prompt.py` — shared `DETECTION_PROMPT`; `app/main.py:80` — `build_default_app` `VISION_BACKEND=hosted|qwen` switch.
- `docs/superpowers/research/2026-06-07-{gpu-substrate,apple-silicon-local-substrate,ai-homelab-hardware}-research.md` — the 3 reports.
- `docs/research/2026-06-07-qwen25vl-apple-silicon-mlx-sketch.py` — MLX analyzer sketch (if Apple).
- **Gotchas (in VFS `gotchas.md`):** rebuild `@uipe/contracts` (`pnpm -F @uipe/contracts run build`) before workspace tsc or `core` reads stale `dist/`; CoreML EP supports GridSample (RAFT-on-Apple is viable); local Mac python is 3.9 — vision-svc uses the 3.11 venv at `packages/vision-svc/.venv`.
- **Deferred decision (VFS):** scrub on-wire error `message` at Phase 4 — `decisions/phase2-onwire-error-message-scrub-deferred.md`.

## Next steps
1. **Decide the substrate** with Dirk: 3090 homelab (own it; runs `qwen.py` as-is) vs Modal (cloud, scale-to-zero) vs stay-hosted-API. No rush. (Matrix is now in the amendment §3.)
2. If homelab: Dirk buys the ~$1,950 used-3090 rig (parts list in the homelab report); when it arrives, run `qwen.py` locally (CUDA, unchanged) — no new code.
3. If/when validating now: get a provider API key → `VISION_BACKEND=hosted VISION_API_KEY=… .venv/bin/python -m uvicorn app.main:app` → POST `landing/screenshots/after-hero.png` to `/v1/analyze`.
4. ✅ **DONE 2026-06-08** — substrate-pivot amendment written (`docs/superpowers/specs/2026-06-08-phase2-substrate-pivot-amendment.md`); spec/plan banners + Task 1′/9′/12′. (Uncommitted; commit on a fresh branch.)
5. ✅ **DONE** — PR #23 merged 2026-06-07.
6. Golden set for the scored eval (`bench/golden/` + `expected/*.json`) remains a TODO for when the model is actually running.
7. ✅ **DONE 2026-06-08** — amendment committed + excision on `feat/phase2-substrate-pivot-amendment` → **PR #24 OPEN** (awaiting Dirk's review/merge). gitleaks clean, no Claude trailer.

## Resume prompt
```
Read ui-perception-engine/docs/plans/2026-06-07-phase2-post-fly-substrate-pivot.md
in full. It's a checkpoint from my last session on "Phase 2 — post-Fly substrate
pivot". Catch up on what we did and the current state, then continue from the
"Next steps" section. Start by confirming your understanding of where we left off —
PR #22 (CPU impl) is merged, Fly is dead as a GPU substrate, the research points to
Modal (cloud) / a used-3090 rig (homelab), and PR #23 (hosted-API backend +
research) is open — before making changes. The hardware purchase is mine to decide;
don't assume it.
```
