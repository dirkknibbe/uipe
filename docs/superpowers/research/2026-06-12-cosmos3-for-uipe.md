# NVIDIA Cosmos 3 for UIPE — research report

**Date:** 2026-06-12
**Question:** What is Cosmos 3, and does it fit UIPE as (a) a vision backend or (b) a world model?

## Provenance & confidence

Deep-research workflow run `wf_25f7e7aa-800` (98 agents, 5 search angles, 15 sources fetched). The
adversarial-verify phase died wholesale on an API session limit — every claim shows a `0-0` vote, so the
run's "all 25 claims refuted" summary is an **artifact** (zero votes were cast, nothing was actually
refuted). Instead of re-running ~75 verifier agents, all load-bearing claims below were **manually
re-verified 2026-06-12** against primary sources fetched directly.

Tags: **[V]** = verified by direct fetch of the primary source. **[S]** = single-source extraction from
the workflow run, not independently re-verified (treat as probable, check before relying on it).

## TL;DR

- **Cosmos 3** (released 2026-05-31) unifies NVIDIA's Cosmos world-foundation-model line — the old
  Predict / Transfer / Reason family split is replaced by **omnimodal** models with two runtime surfaces:
  a **Reasoner** (autoregressive VLM) and a **Generator** (diffusion video/audio/action). Open weights
  (OpenMDW 1.1), open training recipes, NIM container, vLLM serving. Everything is framed as Physical AI
  (robots, AVs, smart spaces); **zero GUI/screen/software-agent evidence anywhere in the primary sources**.
- **Fit (a) — vision backend: plausible, cheap to test, evidence-gated.** The Reasoner's native
  **2D-grounding workflow (image + prompt → JSON bounding boxes)** matches our detection contract's shape,
  and it serves behind an **OpenAI-compatible NIM endpoint** — so an eval is a config change on
  `HostedApiAnalyzer`, zero new code. Unknown: whether physical-AI post-training preserved the base model's
  UI grounding ability. Smoke test before building anything.
- **Fit (b) — world model: no near-term integration; park with revisit conditions.** The Generator predicts
  *physical-world video* conditioned on *robot-embodiment action vectors* (no click/scroll/type embodiment
  exists), at diffusion latency (seconds per generation) incompatible with perception-loop budgets. UIPE's
  #6 is scene-graph-shaped, not pixel-shaped — Cosmos 3 strengthens the thesis rather than replacing it.
- **Economics:** nothing here changes the pending substrate decision. Cosmos3-Nano (16B, BF16-only) does
  not fit a 24 GB 3090; Cosmos-Reason2-2B (~2.4B) fits trivially; hosted endpoints allow zero-GPU eval
  from the Intel Mac.

## 1. What Cosmos 3 actually is

Timeline of the Cosmos line (resolves the naming confusion):

| Date | Release | Source |
|---|---|---|
| CES 2025 → 2025 | Cosmos 1.x–2.x: separate **Predict** (video world model), **Transfer** (sim-to-real style transfer), **Reason** (physical-reasoning VLM) families | docs.nvidia.com [V] |
| 2025-12-19 | **Cosmos-Reason2** initial release (2B / 8B) | HF card [S] |
| 2026-01-05 | Reason 2 announcement; siblings at Predict 2.5 / Transfer 2.5. No "Cosmos 3" exists yet | HF blog [V] |
| 2026-03-10 | Improved Reason2-8B checkpoint | HF card [S] |
| 2026-05-01 | Official docs still enumerate the 7-component family split | docs.nvidia.com [S] |
| **2026-05-31** | **Cosmos 3** released on HF + GitHub (`Cosmos3` release tag on `NVIDIA/cosmos`) | HF card [V] |

**Architecture [V]:** Mixture-of-Transformers (MoT), two complementary towers — an **autoregressive
transformer** for discrete tokens (text/reasoning) and a **diffusion transformer** for continuous
modalities (image, video, audio, action), the reasoner feeding the generator unidirectionally. NVIDIA's
framing: it "subsumes vision-language models, video generators, world simulators, and world-action models
into a single framework."

**Two runtime surfaces [V]** (GitHub README table):

| Surface | Inputs | Outputs | Stated use cases |
|---|---|---|---|
| **Reasoner** | text, vision | text | world understanding, **grounding**, physical reasoning, task planning, action forecasting |
| **Generator** | text, vision, sound, action | vision, sound, action | world generation/simulation, future prediction, synthetic data, policy learning |

**Variants & parameters [V]** (HF card, exact): Cosmos3-Nano **16B**, Cosmos3-Super **64B**,
Cosmos3-Nano-Policy-DROID 16B (robot policy), Cosmos3-Super-Image2Video 64B, Cosmos3-Super-Text2Image 64B.

**License [V]:** OpenMDW 1.1 (HF weights), commercial use OK. (The build.nvidia.com page reportedly says
"NVIDIA Open Model License" [S] — that license verifiably governs the *Reason 2* line; for Cosmos 3 the HF
card's OpenMDW 1.1 is authoritative for the weights.)

**Availability [V]:** open weights on HF (`collections/nvidia/cosmos3`); code at `github.com/NVIDIA/cosmos`
(9.9k stars) + training framework at `NVIDIA/cosmos-framework`; technical report + website at
research.nvidia.com/labs/cosmos-lab/cosmos3. Serving: **NIM container** (`cosmos3-reasoner`, sizes
`nano`/`super`, needs NGC API key + nvcr.io login) exposing an **OpenAI-compatible** endpoint; hosted
browser playground at `build.nvidia.com/nvidia/cosmos3-nano-reasoner`; **vLLM** path via `vllm-cosmos3`
(`vllm serve nvidia/Cosmos3-Nano --hf-overrides '{"architectures": ["Cosmos3ReasonerForConditionalGeneration"]}'`).
DeepInfra lists Cosmos3-Nano [S]. Generator endpoint on build.nvidia.com is a video-generation API
(prompt → base64 MP4), **not** detection [S].

**Hardware [V]:** Ampere / Hopper / Blackwell; **Linux only**; **BF16 the only tested precision** (FP4/8/16
"not officially supported"); runtimes PyTorch, vLLM-Omni, HF Diffusers. NVIDIA's own testing on GB200/H100 [S].

**Domain scoping [V]:** use case is "Physical AI: robotics, autonomous vehicles, smart spaces." Action
conditioning supports **only physical embodiments** (camera motion 9D, AV 9D, egocentric 57D, Franka single
10D / dual 20D, Agibot 29D, …). GUI/screens/software agents appear **nowhere** — confirmed by targeted
search across the GitHub README, HF card, dev blog, and a grep of the technical report (the only "UI" hits
are an image-style enum and text-legibility eval rubrics).

## 2. The adjacent family: Cosmos Reason 2 (separate line, still current)

Not superseded by Cosmos 3 — a distinct product line, and possibly the better fit-(a) candidate because it
is small:

- **Post-trained from Qwen3-VL** [V]: Reason2-2B from Qwen3-VL-2B-Instruct (2,438,696,960 params, same
  architecture); Reason2-8B from Qwen3-VL-8B-Instruct. A 32B appears in benchmark tables [S].
- **Detection-native** [V]: 2D/3D point localization, **bounding-box coordinates**, trajectory data, OCR;
  256K-token context (up from Reason 1's 16K).
- **License:** NVIDIA Open Model License (commercial + derivatives OK), behind a HF contact-info gate [V].
- **Support matrix [V]:** Blackwell + Hopper only listed, BF16-only tested, Linux, Transformers runtime.
  The 8B card states a 32 GB GPU-memory minimum [S]. These read as NVIDIA support-matrix conservatism, not
  hard gates — the architecture is stock Qwen3-VL and runs wherever that runs.
- **Relevance to us:** our existing backend is **Qwen2.5-VL-7B-Instruct** (`app/config.py`), one generation
  behind the same family. The shared `parse_detection_output` seam and prompt are model-neutral by
  convention, so a Reason2 (or Cosmos 3 Reasoner) eval slots into the existing contract.

## 3. Fit (a): vision backend behind the Analyzer protocol

**Contract recap:** `analyze(VisionAnalyzeRequest) → VisionAnalyzeResponse` — screenshot in, elements out
(`label` from allowlist / `bbox` / `text` / `is_interactable`), via `app/prompt.py` + shared parser.

**What matches [V]:**
- Reasoner **2D grounding** workflow: image + prompt → **JSON boxes** — exactly our response shape.
- **Qwen3-VL-compatible message conventions** — same request shape `HostedApiAnalyzer` already sends.
- **OpenAI-compatible NIM endpoint** — `VISION_BACKEND=hosted` + base URL + model name + key. Zero new code
  for an eval; at most a prompt tweak.
- OCR support (Reason 2 explicitly [V]; Cosmos 3 Reasoner does captioning/describe-anything [V]) covers the
  `text` field. `is_interactable` is prompt-derived for every backend we have; no regression.

**What's unknown (the gate):**
- **UI grounding quality.** All post-training is physical-world video. The Qwen3-VL *base* advertises GUI
  grounding/agent ability (training-data knowledge — verify if it becomes load-bearing), but physical-AI
  post-training may have eroded it. No benchmark anywhere covers UI screenshots. **Only an empirical smoke
  test answers this.**
- Whether hosted endpoints (build.nvidia.com free credits, DeepInfra) expose the Reasoner chat-completions
  path publicly vs. playground-only — check at eval time; self-hosted NIM (needs NGC key + GPU) and vLLM on
  Modal/Cerebrium are fallbacks.

**Eval plan (zero/near-zero code):**
1. Get an endpoint: build.nvidia.com hosted Reasoner (or DeepInfra) for Cosmos3-Nano; HF weights via vLLM on
   Modal/Cerebrium for Reason2-2B if no public chat endpoint exists.
2. `VISION_BACKEND=hosted VISION_API_BASE=<endpoint> VISION_MODEL=<id> VISION_API_KEY=…` → POST our standard
   screenshot (`landing/screenshots/after-hero.png`) to `/v1/analyze`.
3. Compare against the Qwen2.5-VL-7B hosted baseline on the same image: element recall, bbox tightness,
   label sanity, parse failures. Formalize with the Task 12′ golden set when that lands.
4. **Decision gate:** add a backend/spec work only if it clearly beats the baseline on UI detection.

**Verdict: worth the smoke test (hours, ~$0); do not build until it passes.**

## 4. Fit (b): world model vs sub-project #6

**#6 as specced** (`docs/autopilot-program-roadmap.md`): a *small* model trained on UIPE's own
`(scene_graph_t, mcp_call, scene_graph_t+1, latency, success)` tuples — learns UI behavior grammar over
**structured scene graphs**. Depends on Track 3 data collection (not started).

**Why Cosmos 3 is not a drop-in:**
- **Wrong substrate.** Generator predicts *pixels* of the physical world; #6 predicts scene-graph
  transitions. Our perception stack exists precisely to compress UI state so a small model suffices —
  NVIDIA needs 16–64B params and H100s to do this in pixel space. Cosmos 3 validates the
  world-model-for-agents thesis at industry scale; it does not replace our shape of it.
- **Wrong action space.** Action conditioning is robot-embodiment vectors (joint positions, gripper state,
  camera pose) [V]. There is no click/scroll/type embodiment; UI interactions are not representable without
  post-training a new embodiment from scratch.
- **Wrong latency class.** Diffusion video generation runs in seconds+ per clip on H100-class hardware
  (Generator benchmarks are reported in seconds [V]); perception-loop prediction (#3-style) needs
  millisecond-class checks. Even hosted, per-prediction cost/latency is prohibitive in a loop.
- **No domain evidence.** Zero GUI/screen content in training domains or evals (verified absence, §1).

**The future hook [V]:** the release includes fully open SFT + action post-training recipes
(`NVIDIA/cosmos-framework`) explicitly for "adapting Cosmos 3 to new domains, **embodiments**, and
datasets" — forward dynamics, inverse dynamics, policy generation. A "UI embodiment" (screen video +
click/scroll/type action vectors) is *structurally* expressible in their framework. That becomes
interesting exactly when Track 3 has accumulated recorded sessions.

**Verdict: park.** Revisit triggers: (1) Track 3 data collection is live with months of recordings,
(2) NVIDIA or anyone ships GUI-domain Cosmos post-trains, or (3) #5/#6 reach the top of the roadmap.
Record as a decision; no spec.

## 5. Inference economics

| Model | Params | BF16 weights | Fits 24 GB 3090? | Paths |
|---|---|---|---|---|
| Cosmos3-Nano | 16B | ~32 GB | **No** (BF16-only policy; quantization unsupported) | NIM (NGC), vLLM on A100/H100 via Modal/Cerebrium, build.nvidia.com hosted, DeepInfra [S] |
| Cosmos3-Super | 64B | ~128 GB | No (multi-GPU) | hosted only, realistically |
| Cosmos-Reason2-2B | 2.4B | ~5 GB | **Yes, trivially** (any CUDA card; support matrix says Hopper/Blackwell) | HF weights (gated), Transformers/vLLM; CPU inference on the Intel Mac possible but slow |
| Cosmos-Reason2-8B | 8.8B | ~18 GB | Tight; card claims 32 GB min [S] | HF weights, hosted |

**Substrate impact: none.** The current roadmap (Qwen-7B-class) still fits a 3090; a hypothetical
Cosmos3-class commitment forces cloud GPUs regardless of which substrate wins. Hosted endpoints mean the
fit-(a) smoke test runs from the Intel Mac with no GPU at all.

## 6. Recommendation

1. **Run the fit-(a) smoke test** next session (hours): hosted Cosmos3-Nano Reasoner (and/or Reason2-2B)
   through `HostedApiAnalyzer` on our standard screenshots, side-by-side with the Qwen2.5-VL baseline.
   Evidence before any backend work.
2. **Park fit (b)** with the revisit triggers above; capture as a VFS decision.
3. **Substrate decision proceeds unaffected.**

## Sources (accessed 2026-06-12 unless noted)

- https://github.com/NVIDIA/cosmos — README: Cosmos 3 family, surfaces, Reasoner workflow table (2D
  grounding), NIM + vLLM quickstarts [V]
- https://huggingface.co/nvidia/Cosmos3-Nano — model card: variants/params, MoT architecture, OpenMDW 1.1,
  hardware/runtime, action embodiments, release dates [V]
- https://huggingface.co/nvidia/Cosmos-Reason2-2B — model card (gate page shows NVIDIA Open Model License;
  card content: Qwen3-VL-2B base, exact params, support matrix) [V]
- https://huggingface.co/blog/nvidia/nvidia-cosmos-reason-2-brings-advanced-reasoning — Reason 2 announce
  (2026-01-05): capabilities, family context (Predict/Transfer 2.5), deployment positioning [V]
- NVIDIA dev blog "Develop Physical AI Reasoning, World, and Action Models with NVIDIA Cosmos 3" — two-tower
  architecture, open training recipes [V, via workflow KB index]
- https://huggingface.co/nvidia/Cosmos-Reason2-8B — 8B card: base model, params, 32 GB min, support matrix
  [S, workflow extraction]
- https://build.nvidia.com/nvidia/cosmos3-nano — hosted Generator endpoint shape (prompt → MP4) [S; SPA
  resisted re-fetch]
- https://docs.nvidia.com/cosmos/latest/introduction.html — family enumeration as of 2026-05-01 [S]
- https://research.nvidia.com/labs/cosmos-lab/cosmos3/technical-report.pdf — technical report (GUI-absence
  grep) [S, workflow extraction]
- NIM API reference: https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/cosmos-reason3/api.html
  (not yet fetched — read at eval time)
