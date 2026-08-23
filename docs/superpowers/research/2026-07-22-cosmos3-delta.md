# Cosmos 3 for UIPE — delta refresh (2026-06-12 → 2026-07-22)

**Date:** 2026-07-22
**Base report:** [`2026-06-12-cosmos3-for-uipe.md`](2026-06-12-cosmos3-for-uipe.md)
**Question:** What changed since the June report, and is the fit-(a) smoke test unblocked?
**Method:** 3 parallel research agents (endpoint availability / GUI-domain evidence / release delta), all load-bearing claims from direct fetches of primary sources.

## TL;DR

1. **The smoke test is unblocked.** build.nvidia.com exposes a real hosted OpenAI-compatible
   chat-completions endpoint for the Reasoner (this was the June report's open gate).
2. **Naming collision resolved — and it's good news.** The hosted/NIM "Cosmos3 Reasoner" line is the
   **Cosmos-Reason2 rebrand**, not the omnimodal 16B/64B HF models: NIM Nano = 8B (ex-Reason2-8B),
   NIM Super = 32B (ex-Reason2-32B). The hosted Reasoner is therefore **Qwen3-VL-8B-derived** — the
   family whose base explicitly advertises GUI grounding. Best-case candidate for our contract.
3. **GUI evidence: still zero, verified.** No GUI post-trains, no GUI-benchmark appearances, no
   community UI-screenshot experiments anywhere. Nobody has tested this; our smoke test is novel signal.
4. **One practical wrinkle:** the hosted endpoint caps inline base64 images at ~180 KB; bigger needs the
   NVCF asset-upload flow (not OpenAI-compatible). Our 1280x720 PNGs usually exceed that.

## 1. Endpoint availability (was UNRESOLVED in June)

| Provider | Verdict | Details |
|---|---|---|
| **build.nvidia.com** | **YES for the endpoint, NO for Cosmos (see §6)** | Base `https://integrate.api.nvidia.com/v1`, `POST /chat/completions` — both confirmed working with a real key 2026-08-23. But the Cosmos model itself is **not invokable on a default account**. Model id from the web page (`nvidia/cosmos3-nano-reasoner`) is **wrong for the API**; the catalog id is `nvidia/cosmos-reason2-8b`. **Caveat:** base64 data-URI images only under ~180 KB; larger requires `NVCF-INPUT-ASSET-REFERENCES` asset upload (breaks pure OpenAI shape). |
| DeepInfra | VERIFIED-NO for chat | `nvidia/Cosmos3-Nano`/`-Super` are live but **Generator-only** (`text-to-video`, $0.025–0.05/s via `/v1/inference/`). The June [S] claim was true but wrongly scoped — unusable as a vision backend. |
| OpenRouter | VERIFIED-NO | 0 cosmos matches in the full model list (nvidia/* = Nemotron only). |
| Lyceum Technology | VERIFIED-YES (single source) | `nvidia/Cosmos3-Super-Reasoner` (32B) per-token: $0.10/M in, $0.30/M out, 256K ctx, EU-only. Image input undemonstrated in their docs; small new vendor — verify at eval time. |
| Baseten | Dedicated deploy only | One-click deployment of "Cosmos 3 Nano (8B)" — note the 8B, confirming the rebrand. No serverless per-token API. |
| NIM self-hosted | VERIFIED | `nvcr.io/nim/nvidia/cosmos3-reasoner:1.7.0`, `NIM_MODEL_SIZE=nano|super`. Request shape is exactly what `HostedApiAnalyzer` sends (OpenAI content array with base64 `image_url`, PNG OK). |

**Rebrand evidence:** `build.nvidia.com/nvidia/cosmos-reason2-8b` 308-redirects to
`/nvidia/cosmos3-nano-reasoner`; NIM docs list Nano=8B / Super=32B; Baseten labels Nano as 8B.
The HF omnimodal `Cosmos3-Nano` (16B) / `Cosmos3-Super` (64B) are a **different** model line sharing
the name. Any eval config must record *which* "Nano" it hit.

## 2. GUI-domain evidence — UNCHANGED (verified absence)

- HF fine-tune trees of Reason2-2B/8B and Cosmos3-Nano: all robotics/AV/surgical; zero GUI.
- GitHub issue search (`GUI OR screenspot OR "computer use"`) across NVIDIA/cosmos + nvidia-cosmos org: 0 hits.
- No Cosmos model on any GUI grounding leaderboard (ScreenSpot-Pro, AutoGUI-v2, computer-use boards —
  Qwen3-VL appears, Cosmos never does).
- No published community experiment on UI screenshots (HN Algolia exhaustive: 0 hits; Reddit: nothing).
- NVIDIA roadmap remains exclusively robotic embodiments; "Agent Skills" (Jul 2026) = coding-agent
  automation for LoRA post-training, not GUI agents.

The June report's core unknown — did physical-AI post-training preserve Qwen3-VL's GUI grounding? —
remains empirically unanswered by anyone.

## 3. Release delta

- **NEW tier: Cosmos3-Edge (4B)**, 2026-07-20 — Jetson-class, no audio, 256p/480p only. Unveiled
  2026-07-15/16 (Tokyo); claims 15 Hz on-device control on Jetson Thor.
- **Reason2-32B now public + fully ungated** on HF; 2B/8B gates are auto-approve (were contact-review).
- **Serving path changed:** the `vllm-cosmos3` fork + `--hf-overrides` recipe from the June report is
  **gone**. Generator now via upstream `vllm-project/vllm-omni` (Docker `vllm/vllm-omni:cosmos3`);
  Reasoner via plain vLLM/Transformers; new SGLang + NIM paths.
- **Quantization arriving:** MXFP8/NVFP4 wired into cosmos-framework inference CLI (2026-07-15,
  PR #113); FP8/NVFP4 checkpoints still "coming soon". BF16-only pain is softening.
- DMD2-distilled 4-step Super samplers (Image2Video/Text2Image); Cosmos3-Action-Viewer space + 10 datasets.
- No Cosmos 3.1; Nano/Super base weights unchanged since launch. License unchanged (OpenMDW 1.1;
  Reason2 line still NVIDIA Open Model License).
- SIGGRAPH 2026 (07-20): Cosmos-Dreams (closed-loop simulators from a single frame) — direction is still
  one shared representation for understanding/prediction/simulation/action. Fit-(b) verdict unchanged: park.

## 4. Economics update

- Hosted Nano-Reasoner = **8B** (~18 GB BF16): fits a 24 GB 3090, tight — and Reason2-2B still fits
  anything. The June "Nano 16B doesn't fit a 3090" claim applies only to the omnimodal HF line.
- **Substrate decision still unaffected.** Smoke test runs from the Intel Mac with zero GPU.

## 5. Updated smoke-test plan

**Three blockers found by reading the code 2026-07-22 (all verified, none were in the June plan):**

1. **Env var names in the June report were wrong.** Verified against
   [`app/config.py`](../../../packages/vision-svc/app/config.py): the real names are
   **`VISION_API_BASE_URL`**, **`VISION_API_MODEL`**, `VISION_API_KEY`, `VISION_BACKEND`
   (June wrote `VISION_API_BASE` / `VISION_MODEL`, which are silently ignored → the run would
   have hit the Hyperbolic default base URL with a Qwen model id and looked like a Cosmos result).
2. **The 8 s handler timeout will fire before a hosted call returns, and no env var can raise it.**
   [`main.py:26`](../../../packages/vision-svc/app/main.py) calls `Config.from_env({})` — an *empty*
   mapping — so `inference_timeout_s` is pinned at the 8.0 default regardless of `VISION_TIMEOUT_S`.
   `HostedApiAnalyzer` allows httpx 60 s, but `asyncio.wait_for` cuts it at 8 s and returns
   `status=degraded, reason=inference_timeout`. A cold/rate-limited NVIDIA preview endpoint will
   very likely exceed 8 s → **a working model would read as a failure.** (`VISION_WARMING_RETRY_MS`
   and `VISION_RETRY_BACKOFF_MS` are dead in the served app for the same reason.)
   Workaround for the smoke test: drive `HostedApiAnalyzer` directly from a script (no handler,
   no 8 s ceiling). Real fix: thread `cfg.inference_timeout_s` into `create_app` from
   `build_default_app` — its own small PR, with a regression test.
3. **`bench/golden/` does not exist** (Task 11 was never done), so `bench/run_bench.py` has no data
   and the scored Unit-0-lite path cannot run. The smoke test is necessarily **eyeball/manual**
   comparison until the golden set lands.

**Image sizing — measured, not estimated.** `landing/screenshots/after-hero.png` is 2880x1800,
271 KB on disk → **362 KB base64, 2x over the ~180 KB inline cap.** Measured fits (Pillow 12.2.0 is
already in the venv):

| Transform | base64 | Fits |
|---|---|---|
| original PNG | 362 KB | ✗ |
| JPEG q75, full res | 280 KB | ✗ |
| JPEG q75, 0.75 scale (2160x1350) | 183 KB | ✗ (just over) |
| **JPEG q85, 0.6 scale (1728x1080)** | **165 KB** | **✓** |
| JPEG q75, 0.6 scale | 134 KB | ✓ |

Note `HostedApiAnalyzer.infer` hardcodes the `data:image/png;base64,` MIME prefix — a JPEG payload
under a PNG label. NIM docs list JPG/JPEG/PNG as accepted; if the endpoint sniffs the declared type,
send a downscaled *PNG* instead or parameterize the prefix.

**Steps:**

1. Dirk creates a build.nvidia.com API key (free rate-limited preview). Owner action — account signup.
2. Prepare a under-cap image (JPEG q85 @ 0.6 scale, or a downscaled PNG).
3. Drive `HostedApiAnalyzer` directly (bypasses blocker 2):
   `VISION_BACKEND=hosted VISION_API_BASE_URL=https://integrate.api.nvidia.com/v1 VISION_API_MODEL=nvidia/cosmos3-nano-reasoner VISION_API_KEY=…`
4. Run the identical script against the Qwen2.5-VL-7B baseline (Hyperbolic/DeepInfra key) on the same
   image. Compare: element recall, bbox tightness, label sanity, `parse_detection_output` failures.
5. Decision gate unchanged: build nothing unless it clearly beats the baseline.

**Caveat to record with any result:** a downscaled/recompressed image is not the project's lossless-PNG
standard, so a first-pass score is directional only — bbox tightness in particular is affected.

## 6. Smoke-test attempt 2026-08-23 — BLOCKED on account access

Ran it. Script: [`packages/vision-svc/bench/smoke_cosmos.py`](../../../packages/vision-svc/bench/smoke_cosmos.py)
(`.venv/bin/python -m bench.smoke_cosmos`). Result: **the endpoint works, Cosmos does not — the model is
listed but not invokable on a default build.nvidia.com account.**

**Evidence chain (all 2026-08-23, one real API key):**

1. `GET /v1/models` → 200, 102 models. Cosmos is present as **`nvidia/cosmos-reason2-8b`**.
   `nvidia/cosmos3-nano-reasoner` is **absent** — that string is the web-page slug, not an API model id.
   (The June/July "hosted Nano-Reasoner" naming still holds as *identity*; it just isn't the API id.)
2. `POST /v1/chat/completions` with `nvidia/cosmos-reason2-8b` → **404**:
   `{"status":404,"title":"Not Found","detail":"Function '<uuid>': Not found for account '<acct>'"}`
   That is an **NVCF function-access gate**, not a bad request — consistent with the page's `PREVIEW=true`.
3. **Control, same payload/path/key:** `meta/llama-3.2-11b-vision-instruct` → **200**, and
   `nvidia/nemotron-nano-12b-v2-vl` → **200**; both correctly described the UIPE landing page.
   So request shape, auth, base URL, and base64 image encoding are all verified correct.

**Corrections to §1/§5 above:** the model id was wrong, and "VERIFIED-YES" for build.nvidia.com was
over-stated — an embedded OpenAPI sample on a marketing page proves the *route*, not that any given
account may call the function. Verify invocability, not just documentation, before calling an endpoint available.

**Image sizing, measured for real:** the 180 KB cap is harsher than §5 estimated. `after-hero.png` is
**2880x1800 retina**; as lossless PNG it only fits at **0.3 scale → 864x540, 178 KB**. That is a severe
downscale for a UI-detection eval. **Better fix than downscaling: capture a fresh screenshot at the
project's 1280x720 viewport default** (per CLAUDE.md) instead of reusing the retina landing assets —
native resolution, no resampling, comfortably under the cap.

**Unblock options (Dirk's call):**
- a. Open `build.nvidia.com/nvidia/cosmos-reason2-8b` while logged in — check for a
  "request access"/enable control, or whether it is playground-only for now. Cheapest.
- b. Self-host **Cosmos-Reason2-2B** (~5 GB, HF gate now auto-approve) via vLLM on Modal/Cerebrium.
  Costs a little, no account gate, and keeps full-res PNG.
- c. Lyceum Technology's `nvidia/Cosmos3-Super-Reasoner` (32B, per-token, EU) — untested, small vendor.

**Free consolation prize:** `nvidia/nemotron-nano-12b-v2-vl` **is** invokable on this account and is a
current NVIDIA VLM. If the point is "is there a better hosted detector than Qwen2.5-VL-7B", it can be
benchmarked today at zero cost through the same script — just change `VISION_API_MODEL`.

## 7. Nemotron-Nano-12B-V2-VL trial 2026-08-23 — NOT VIABLE

**The Qwen baseline still has not run.** `GET /v1/models` on NVIDIA returns **no Qwen model at all**, and
`.env` holds no Hyperbolic/DeepInfra/OpenRouter key. So this is an *absolute* assessment, not a
comparison. Nemotron fails on its own merits, which makes the missing baseline moot for this candidate.

**Disqualifying findings** (image: `after-hero.png` → 864x540 PNG, 178 KB; `temperature=0`):

1. **Latency 34–119 s against an 8 s production cap.** Measured 34.6 s, 44.1 s, 51 s, 119 s across runs.
   That is 4–15x over the handler budget and far outside any perception-loop cadence.
2. **Non-deterministic at `temperature=0`.** Identical image and parameters produced a clean 19-element
   result (44 s) on one run and truncated, unparseable output (119 s) on the next. Unusable for a
   contract that must parse every time.
3. **`max_tokens=1024` truncates a full-page array**, and `parse_detection_output` then rejects the
   *entire* response ("no JSON array found") rather than salvaging the complete objects. 4096 helped but
   did not eliminate it — see finding 2.
4. **Bounding boxes fall outside the image.** On the 864 px-wide render, listed detections include
   `Pricing` at `x=976 w=50` (→ 1026) and `GitHub` at `x=946`, which also overlap each other. The model
   appears to emit coordinates in a different space than the image it was given. Fatal for a grounding
   task. (Observed in the element listing; the automated out-of-frame counter now in the script was added
   after, and the confirming run truncated before printing it — re-run to get the exact ratio.)
5. **No label discrimination.** All 19 elements came back `label: "text"`, including the nav items
   `Problem` / `How it works` / `Pricing` / `GitHub`, which are links. Only `is_interactable` (6 of 19)
   carried any affordance signal.

**What it did well:** OCR was accurate — `UIPE PERCEPTION ENGINE`, `BUILDING IN PUBLIC`,
`EARLY ACCESS SOON`, and the headline lines all extracted correctly. Text extraction is not the problem;
grounding and determinism are.

**Also tested:** `meta/llama-3.2-11b-vision-instruct` — returned repeated empty arrays (`[]\n\n[]\n\n…`)
for the detection prompt, at 61 s. Useless as a detector; dropped.

**Verdict: neither NVIDIA-hosted VLM replaces Qwen2.5-VL-7B.** The open question is unchanged — get a
DeepInfra/Hyperbolic/OpenRouter key and run the actual Qwen baseline through the same script
(`BASELINE_API_BASE_URL` / `BASELINE_API_MODEL` / `BASELINE_API_KEY`), so there is a number to beat.

**Code changes this trial (all behaviour-preserving, 33/33 pytest green):**
`app/hosted.py` gained optional `timeout_s=60.0` and `max_tokens=1024` constructor params — both default
to the previously hardcoded values, so production is untouched; the bench passes 180 s / 4096.

## Sources (accessed 2026-07-22)

- https://build.nvidia.com/nvidia/cosmos3-nano-reasoner — embedded OpenAPI spec (chat path, model id, free-preview terms) [V]
- https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/cosmos-reason3/api.html — NIM request shape, nano=8B/super=32B [V]
- https://deepinfra.com/nvidia/Cosmos3-Nano/api — Generator-only invocation + pricing [V]
- https://lyceum.technology/magazine/cosmos3-super-reasoner/ — Super-Reasoner per-token endpoint [V, single-vendor]
- https://huggingface.co/nvidia/Cosmos3-Edge — new 4B tier [V]
- https://huggingface.co/nvidia/Cosmos-Reason2-32B — public, ungated [V]
- https://github.com/NVIDIA/cosmos + NVIDIA/cosmos-framework — commits/releases since 06-12 (Edge sync, SGLang, vllm-omni, quantization PR #113) [V]
- https://github.com/vllm-project/vllm-omni/blob/main/recipes/cosmos3/Cosmos3-Nano.md — current serving recipe [V]
- https://arxiv.org/abs/2604.24441 (AutoGUI-v2) — evaluated-models list, no Cosmos [V]
- https://nvidianews.nvidia.com/news/japans-robotics-and-manufacturing-leaders-build-on-nvidia-cosmos-to-advance-physical-ai-frontier + https://huggingface.co/blog/nvidia/cosmos3edge — Edge announce [V]
- https://blogs.nvidia.com/blog/siggraph-news-2026/ — Cosmos-Dreams [V]
- HN Algolia, benchlm.ai/benchmarks/screenSpotPro, HF fine-tune trees — GUI-absence sweep [V/REPORTED per base-agent tagging]
