# Apple Silicon as UIPE's local substrate — research synthesis (2026-06-07)

> 4 parallel research agents (hardware / Qwen-on-Apple / CUDA-tension / buy-vs-cloud). Companion: an MLX analyzer code sketch at `docs/research/2026-06-07-qwen25vl-apple-silicon-mlx-sketch.py`. Prompted by considering an AI-dev-workstation purchase after Fly killed its GPUs.

## Verdict
**One Apple Silicon Mac CAN be the substrate for UIPE as currently scoped** — VLM inference (Qwen2.5-VL) is fully Apple-native, optical-flow has an Apple path, light fine-tuning works via MLX. The **only hard limit is CUDA-only work** (full/large training, multi-GPU, FlashAttention/Triton/bitsandbytes/TensorRT, CUDA-EP perf benchmarks) — for those you'd rent an *ephemeral* NVIDIA box. Those are future-phase, not blockers. So it's "one Mac + occasional cloud rental for CUDA bursts," not literally one box forever.

## 1. Hardware (2026 — note active DRAM shortage)
VLM inference is **bandwidth-bound** (tok/s ∝ GB/s). Mac Pro discontinued; Mac Studio is the ceiling; 512GB pulled; 64GB configs scarce; M5 Pro/Max shipped, M5 Ultra Studio rumored later 2026.
- **Entry (~$1,399):** Mac mini M4 Pro, 48GB, 273 GB/s — runs Qwen2.5-VL-7B well; no 70B.
- **Sweet-spot (~$3,499):** Mac Studio M4 Max, 128GB, 546 GB/s — 7B comfortably + 32-72B Q4 headroom + multiple services. **Pragmatic pick.**
- **Future-proof (~$6,000):** Mac Studio M3 Ultra, 256GB, 819 GB/s — 72B at speed, many models. Only if 70B-at-speed is near-term.
- Rule of thumb for "7B + headroom": ≥64GB, ≥500 GB/s.

## 2. Qwen2.5-VL on Apple — viable today
- **MLX / mlx-vlm** (recommended): mature, supports 7B/32B/72B, pre-converted `mlx-community` checkpoints, built-in OpenAI-compatible vision server. **Ollama** (GGUF+Metal): easiest (`ollama run qwen2.5vl:7b`, 6GB Q4). transformers+MPS: weakest.
- Footprint: 7B Q4 ~6GB / Q8 ~10GB / bf16 ~16GB. Speed ~30-50 tok/s on M4 Max (≈70 on M5 Max GGUF Q4) → **~2-6s per screenshot analysis**.
- Drop-in for our `Analyzer` protocol: replace `qwen.py`'s `device_map="cuda"` with an MLX load+generate (sketch saved).

## 3. The CUDA tension — what "no CUDA" costs
- **VLM inference:** fully Apple-native ✅.
- **Optical flow:** re-target the planned "CUDA-EP port" → **ORT CoreML execution provider** (GridSample IS supported in the MLProgram path — the common "RAFT grid_sample can't do CoreML" claim is OUTDATED) **or** Apple Vision `VNGenerateOpticalFlowRequest`. Caveats: partial CPU fallback on unsupported nodes; no published CoreML-EP-vs-CUDA-EP perf numbers (must benchmark). OpenCV CUDA dense-flow = CPU-only on Mac.
- **Light fine-tuning:** MLX LoRA/QLoRA ✅. Full/large/multi-GPU training = still CUDA.

## 4. Buy vs cloud — it's strategic, not financial
At ~300 screenshots/day (~9k req/mo): **Modal serverless ~$14.50/mo gross → ~$0 after the $30 free credit**; **Hyperbolic hosted API ~$3.42/mo**. Cloud is so cheap that pure-dollar break-even vs a Mac is **decades to never**.
So buying only makes sense when: **the Mac is a dual-purpose daily-driver dev machine you'd want anyway** (marginal "GPU" cost ≈ the RAM upgrade, ~$400-600), AND you value **privacy** (screenshots never leave the box) + **independence** (no Fly-style rug-pull). Recommendation: *buy the box you want as a dev machine (Studio M4 Max ≥64GB), run the VLM on it for ~free, keep a cloud fallback (Modal / rented A100) for CUDA bursts.* Don't buy a $6k box just to serve a 7B VLM.

## Key implication for vision-svc
Our `Analyzer` protocol makes the backend pluggable. The substrate becomes a **config choice, not a rewrite**: `HostedApiAnalyzer` (cloud, works on the current Intel Mac today), `MlxAnalyzer` (Apple Silicon), `QwenAnalyzer` (CUDA, already written for Modal). Pick per deployment.

## Sources
Hardware: apple.com/mac-studio/specs, tomshardware (512GB pull), macworld (M5 rumors). Qwen-on-Apple: github.com/Blaizzy/mlx-vlm, ollama.com/library/qwen2.5vl, hf qwen2_5_vl docs. CUDA: onnxruntime.ai CoreML-EP docs, pytorch/pytorch#141287 (MPS coverage), developer.apple.com VNGenerateOpticalFlowRequest, opencv #25025. Economics: modal.com/pricing, docs.hyperbolic.xyz pricing, fly.io GPU deprecation (Jul 31 2026), jmlab.net M5 benchmark.
