# AI dev homelab hardware research — UIPE (2026-06-07)

> 14-agent research workflow (run `wf_b9e0acf0-c6a`). Companion to the cloud-substrate + Apple-Silicon research docs.

**Recommendation:** Buy a single used RTX 3090 (24GB) in a DIY tower - budget ~$1,700-2,000 all-in (card ~$1,050 + ~$650-900 host). It is the rational #1 for UIPE specifically because the workload is a single-tenant, intermittent 7B VLM (which 24GB at 936 GB/s serves in well under your 2-6s budget) and because the whole reason to weigh CUDA heavily is your roadmap - and the 3090 gives you the EASY, fully-paved x86_64 CUDA-12 path. That matters more than it sounds: your optical-flow sidecar (crates/uipe-vision) runs RAFT through ONNX Runtime (ort 2.0.0-rc.9), and on a 3090 the CUDA execution provider, bitsandbytes/PEFT LoRA, and OpenCV's NVOFA hardware optical-flow engine all just pip-install and work. No aarch64/sm_121 source-builds (the DGX Spark tax), no ROCm Preview-tier porting (the AMD/Apple tax). You unblock the exact two roadmap tracks Apple Silicon can't - at the lowest entry price of any CUDA option, which is the honest way to make a privacy/independence/learning bet: minimize the sunk cost. The single-card 72B ceiling is a non-issue today; the tower is upgradeable, so add a second 3090 for 48GB only if/when the 72B + training phase actually materializes. Mitigate the one real weakness - noise/heat in a home - by repadding the GDDR6X on arrival, undervolting (~875-925mV), and siting it in a closet/office rather than a bedroom.

**Runner-up:** NVIDIA DGX Spark (GB10, 128GB unified, $4,699). It is the only box that satisfies the entire roadmap at once in a quiet, ~25W-idle, palm-sized home appliance: full CUDA (optical-flow + LoRA unblocked, unlike Apple/AMD), 128GB unified for the 32B/72B headroom goal, turnkey DGX OS. Pick it OVER the 3090 if you weight three things heavily: (1) living-space friendliness - it is near-silent and tiny where a 3090 tower is large and audible; (2) single-box 72B capacity without going multi-GPU; (3) wanting to learn the genuine NVIDIA datacenter stack (same toolchain as GB200). Accept three real costs: it's the most expensive option, its 273 GB/s bandwidth makes big-model decode slow (load-not-speed; fine for your intermittent 7B job, painful for fast 70B serving), and - the one that should give you pause given your exact stack - the aarch64 + sm_121 + CUDA-13 ecosystem is fragile in 2026: vLLM had sm_121 gaps and ONNX Runtime GPU must be built from source for aarch64, which directly hits your ort/RAFT optical-flow sidecar. NGC containers are the clean path. If that early-platform friction sounds like a feature (learning) rather than a bug, the Spark is a defensible #1; if it sounds like yak-shaving, the 3090 wins.

**CUDA vs unified-memory call:** The central trade is: CUDA frictionlessness vs unified-memory capacity + home-friendliness - and for UIPE, CUDA frictionlessness wins, but the BEST CUDA is the boring x86 discrete-GPU kind, not the unified-memory kind.

Why CUDA is weighted heavily (and correctly): your roadmap's two forward tracks - the optical-flow CV pipeline (#1, today a Rust sidecar; the CUDA future is RAFT via ONNX Runtime's CUDA execution provider, confirmed by ort in crates/uipe-vision) and LoRA fine-tuning for the world-model track (#6) - are CUDA-native. Apple Silicon (MLX/Metal) and AMD Strix Halo (ROCm/gfx1151, Preview-tier) both serve the 7B VLM fine but force a port for those tracks with no NVOFA hardware optical-flow equivalent. That is the same gap on both, so neither unified non-CUDA box solves the problem you're trying to escape - they just relocate it from MLX to ROCm.

But 'has CUDA' splits into two very different experiences. A discrete NVIDIA GPU (3090/4090/5090, x86_64, CUDA-12) is the mature, universally-supported path: vLLM, ONNX Runtime CUDA/TensorRT, PyTorch, bitsandbytes all pip-install and just work. The DGX Spark is also CUDA - but the awkward aarch64 + sm_121 + CUDA-13 corner, where PyPI lacks GPU wheels for many packages, vLLM had sm_121 gaps, and ORT-GPU must be source-built. So the Spark gives you CUDA AND 128GB AND silence, but charges an early-platform-fragility tax that lands squarely on your ort optical-flow sidecar.

Net call: the workload (intermittent single-tenant 7B, 2-6s budget) needs neither flagship bandwidth nor 128GB. So the right axis to optimize is 'cheapest frictionless CUDA that serves the 7B now and unblocks the roadmap.' That is a used 3090 (24GB, x86 CUDA-12) for ~$1,700-2k. Unified memory's headroom (72B in one box) is a real but premature advantage - defer it: get it later via a second 3090 (48GB) or, if you value silence + one-box 72B + datacenter-stack learning, pay the DGX Spark premium and eat the aarch64 friction. Apple wins ONLY if you decide the CUDA tracks live in the cloud or get dropped - at which point the Mac is the best VLM-serving box and best home citizen, full stop.

**Vs Apple / vs cloud:** VS APPLE-ONLY: Apple Silicon is the better pure-VLM-serving box and the better home citizen - silent, ~7-10W idle, MLX runs Qwen2.5-VL beautifully, and its 546 GB/s (M4 Max) actually decodes big models faster than DGX Spark. If serving the 7B VLM were the WHOLE job, an Apple machine would win outright. It loses only on the axis you weighted: no CUDA means the optical-flow (NVOFA/ort-CUDA) track and CUDA LoRA need an MPS/Metal port. Practical 2026 wrinkle: the 128GB Mac Studio is supply-discontinued (max 96GB new). Choose Apple only if you decide UIPE's CV/training future runs in the cloud; choose the 3090/Spark to own that future locally. VS STAYING CLOUD: cloud is ~$0-3/month (~$0-110 over 3yr); a homelab is $1,700-9,000 up front + electricity and NEVER breaks even on cost. The legitimate reasons are privacy (UI screenshots stay home), independence (no Fly-style rug-pull), and CUDA learning. Do not justify the spend as cloud savings - that math never closes. The 3090 makes the bet at the lowest sunk cost.

**Builds by tier:** ~$2,000 TIER - "Single used RTX 3090, frictionless CUDA" (THE RECOMMENDATION)
- GPU: Used RTX 3090 24GB (gaming/OEM pull, avoid mining listings) ~$1,050 (eBay, Jun 2026)
- CPU: AMD Ryzen 5 7600 (AM5) ~$200
- Motherboard: B650 ATX ~$150
- RAM: 64GB DDR5-5600 (2x32GB) ~$160
- PSU: Corsair/Seasonic 850W 80+ Gold ~$120
- Storage: 2TB NVMe Gen4 ~$120
- Case: mid/full tower with good airflow ~$90
- Cooler: Thermalright Peerless Assassin air ~$40
- Thermal repad kit (for GDDR6X) ~$20
=> ALL-IN ~$1,950. Serves Qwen2.5-VL-7B bf16 with KV headroom (<2-6s), full x86 CUDA-12 for ort/RAFT optical-flow + bitsandbytes LoRA, runs 32B-Q4. Upgrade path: drop in a 2nd 3090 later for 48GB.
[Turnkey ~$2k alternative if you drop local CV/training: Apple Mac mini M4 Pro 96GB or Strix Halo Beelink GTR9 Pro 128GB (~$1,900-2,000) - quiet/efficient but NO CUDA.]

~$4,000 TIER - two honest choices, pick by priority:
A) "Dual used RTX 3090, 48GB, local-70B + LoRA" (max capability/$, max DIY/learning)
- 2x Used RTX 3090 24GB ~$2,100
- CPU: Ryzen 9 7900 (more cores) ~$330
- Mobo: X670E with two spaced PCIe x16 slots ~$300
- RAM: 128GB DDR5 ~$330
- PSU: Seasonic/Corsair 1200W 80+ Platinum ~$240
- Storage: 2TB NVMe ~$120
- Case: full tower / open frame + extra fans ~$150
- (Plan: power-limit to 280W/card OR add a 360mm+ AIO budget)
=> ALL-IN ~$3,700-4,000. 48GB runs 72B-Q4, real LoRA room, full CUDA. Loudest/hottest - site in basement/closet, power-limit from day one.
B) "DGX Spark, quiet roadmap-complete appliance" (turnkey, silent, 128GB, the runner-up)
- NVIDIA DGX Spark GB10 128GB Founders Edition $4,699 (turnkey; OEM GB10 boxes can run ~$1k less)
=> ALL-IN $4,699. Full CUDA + 128GB (32B/72B quantized) + ~25W idle + near-silent. Eat the aarch64/sm_121 source-build friction on the ort optical-flow track.

~$7,000+ TIER - "Cover the whole roadmap, money-no-object"
RTX PRO 6000 Blackwell MAX-Q (96GB, 300W) DIY tower - home-livable pro path
- GPU: RTX PRO 6000 Blackwell Max-Q 96GB (300W blower) ~$8,500-9,200
- CPU: Ryzen 9 9950X ~$550
- Mobo: X670E/X870E ~$300
- RAM: 128GB DDR5 ~$330
- PSU: 1000W 80+ Platinum ~$180
- Storage: 4TB NVMe Gen5 ~$300
- Case + cooling ~$200
=> ALL-IN ~$10,400-11,100. 96GB ECC at 1.79 TB/s, full CUDA + NVOFA, 72B comfortable, fast LoRA, and the 300W Max-Q is genuinely quiet for a home (vs the 600W Workstation Edition's ~918W-system, 12k-RPM fan). Honest note: impossible to justify on cost for an intermittent 7B VLM - a 'one box for the entire roadmap forever' buy.
[A single RTX 5090 build (~$4,200-5,000) sits between tiers - fastest CUDA, but 32GB can't single-card 72B and the 575W/12VHPWR heat+safety profile is the worst here; not recommended unless you specifically want max compute and accept the downsides.]

**Key risks:** USED-CARD RISK (3090 picks): no warranty, possible ex-mining wear; GDDR6X runs hot - repad thermal pads on arrival, undervolt to ~875-925mV, verify fan health. DRAM crunch has pushed used 3090 prices UP to ~$1,050 (from $600-800 a year ago) and they're trending higher, so buying sooner is mildly favored.

NOISE/HEAT IN A HOME (all towers): single 3090 (~350W) is manageable in an office/closet but audible under load; DUAL 3090 (700W GPU) is impractical to air-cool 24/7 - plan power-limiting (280W/card) or water from day one; the 5090 (575W) is the loudest/hottest and carries a real 12VHPWR connector MELTING risk that is WORSE than the 4090 (cable temps ~150C; one source: not recommended for unattended 24/7) - power-limit to ~540W and use a PSU with per-connector thermal shutdown if it runs unattended.

DGX SPARK SOFTWARE FRAGILITY: aarch64 + sm_121 + CUDA-13 is genuinely rough in 2026 - broken PyPI wheels, vLLM sm_121 gaps, ONNX Runtime GPU must be source-built for aarch64. This lands directly on your ort/RAFT optical-flow sidecar - budget real setup time (NGC containers are the clean path). Also: 273 GB/s caps decode (big-model 'headroom' is load-not-speed), $4,699 and rising, zero upgradeability (soldered).

VRAM CEILINGS: single 24GB (3090/4090) and 32GB (5090) cannot single-card a 72B (~38-44GB); 16GB cards can't even do 32B-Q4 and force 4-bit on the 7B. If 72B is a firm near-term requirement, that argues for dual-3090 (48GB), DGX Spark/Strix-Halo (128GB), or a pro card.

NO-CUDA OPTIONS (Apple, Strix Halo): structurally fail the optical-flow/CUDA + training roadmap; ROCm gfx1151 is Preview-tier; the 128GB Mac Studio is supply-discontinued (96GB max new). Fine only if CV/training moves to cloud.

MOTIVATED-REASONING RISK: do not rationalize $4k+ hardware as cloud savings - at ~$0-3/mo it never pays back. The honest justification is privacy + independence + learning; if those don't matter, cloud is strictly cheaper.

PRICE/SUPPLY VOLATILITY: the 2026 DRAM/GDDR7/LPDDR5x crunch is inflating EVERYTHING (5090 toward $5k, Spark +18%, Strix Halo SKUs +$1,100, Apple cutting high-mem configs) and isn't expected to normalize before ~2028 - verify live prices before buying.

---

# UIPE AI-Dev-Homelab Hardware: Ranking & Recommendation (June 2026)

## TL;DR

- **#1: Single used RTX 3090 (24GB) DIY tower, ~$1,950 all-in.** Cheapest *frictionless* CUDA. Serves Qwen2.5-VL-7B in well under your 2-6s budget, and gives the mature x86_64 CUDA-12 path that just-works for your `ort`/RAFT optical-flow sidecar and bitsandbytes/PEFT LoRA. Minimizes the sunk cost of a privacy/independence/learning bet; upgradeable to 48GB later.
- **Runner-up: NVIDIA DGX Spark (GB10, 128GB, $4,699).** The only box that covers the *entire* roadmap in one quiet, ~25W-idle, palm-sized appliance - at the cost of price, bandwidth-limited decode, and a fragile aarch64/sm_121 software corner that hits your ONNX-Runtime optical-flow track.
- **Honest economics:** cloud is ~$0-3/mo at this volume; a homelab **never** breaks even on cost. Buy it for **privacy** (UI screenshots stay home), **independence** (no Fly-style rug-pull), and **CUDA learning** - not savings.

## The central call: CUDA-vs-unified-memory

Your workload today (single-tenant, intermittent 7B VLM, 2-6s/analysis) is trivially served by *every* option here. So the decision is driven entirely by the **roadmap** - and the roadmap is where CUDA earns its weight:

1. **Optical-flow CV track (#1):** today a Rust sidecar; the CUDA future is RAFT via **ONNX Runtime's CUDA execution provider**. Confirmed in the codebase: `crates/uipe-vision/Cargo.toml` pins `ort = 2.0.0-rc.9`, and `src/inference.rs` runs RAFT ONNX inference.
2. **LoRA fine-tuning (toward world-model #6):** CUDA-native (bitsandbytes/PEFT/Unsloth).

Apple Silicon (MLX/Metal) and AMD Strix Halo (ROCm/gfx1151, *Preview*-tier in Feb 2026) both serve the 7B VLM fine but **force a port** for those two tracks, with **no NVOFA hardware optical-flow equivalent**. That's the *same* gap on both - they relocate the problem from MLX to ROCm rather than solving it.

But "has CUDA" splits in two:

| | **Discrete NVIDIA GPU** (3090/4090/5090) | **DGX Spark** (GB10) |
|---|---|---|
| ISA / target | x86_64, CUDA-12, sm_86/sm_120 | **aarch64**, CUDA-13, **sm_121** |
| `pip install vllm / ort-gpu / torch` | Just works | Wheels missing; **ORT-GPU built from source for aarch64**; vLLM sm_121 gaps |
| Optical-flow sidecar (`ort`) | Drop-in CUDA EP | Source-build ORT for aarch64 (NGC containers = clean path) |

**Net call:** optimize for *cheapest frictionless CUDA that serves the 7B now and unblocks the roadmap* -> **used 3090**. Unified-memory's 72B-in-one-box headroom is real but **premature** - defer it (second 3090 for 48GB, or pay the Spark premium and eat the aarch64 friction if you value silence + one-box 72B + datacenter-stack learning). **Apple wins only if you decide the CV/training tracks live in the cloud.**

## Comparison table

| Rank | Option | All-in price (2026) | VRAM / bandwidth | CUDA | 7B VLM (2-6s?) | 72B headroom | Power | Home noise/heat | Effort |
|---|---|---|---|---|---|---|---|---|---|
| **1** | **Single used RTX 3090 tower** | **~$1,950** | 24GB / 936 GB/s | Yes (x86 CUDA-12, easy) + NVOFA | Yes, comfortable | No single-card (->48GB w/ 2nd) | 350W card / ~500W sys | Audible under load; OK in office | DIY (low) |
| **2** | **NVIDIA DGX Spark (GB10)** | **$4,699** | 128GB / **273 GB/s** | Yes, but aarch64/sm_121 (fragile) | Yes, fine | Loads 72B (slow decode) | ~25W idle / 240W peak | **Best** (near-silent, tiny) | Turnkey HW, DIY-ish SW |
| 3 | Dual used RTX 3090 (48GB) | ~$3,700-4,000 | 48GB / 936 GB/s ea | Yes (x86 CUDA-12) | Yes (use 1 card) | Yes, 72B-Q4 | ~700W GPU / ~900W sys | **Worst** (loud/hot; water or power-limit) | DIY (high) |
| 4 | Single RTX 5090 tower | ~$4,200-5,000 | 32GB / 1,792 GB/s | Yes (x86 CUDA, FP4) | Yes, overkill | No single-card | 575W card / ~900W sys | Loud/hot; **12VHPWR melt risk** | DIY (high) |
| 5 | RTX PRO 6000 Max-Q (96GB) | ~$10,400-11,100 | 96GB ECC / 1.79 TB/s | Yes (CUDA + NVOFA) | Yes, overkill | Yes, comfortable | 300W card / ~450W sys | Good (300W blower) | DIY |
| 6 | AMD Strix Halo (128GB) | ~$2,000-3,400 | 128GB / ~212 GB/s | **No** (ROCm Preview) | Yes, fine | Loads (slow) | ~120-180W sys | Excellent | Turnkey HW, ROCm SW friction |
| 7 | Apple Mac Studio M4 Max | ~$3,500 (96GB; 128GB EOL) | 96-128GB / 546 GB/s | **No** (MLX/Metal) | Yes, excellent | Yes (fast decode) | ~7-10W idle | Excellent (silent) | Turnkey |
| 8 | RTX 4090 tower | ~$2,800-3,200 | 24GB / 1,008 GB/s | Yes (x86 CUDA + FP8) | Yes | No single-card | 450W card | Loud/hot | DIY |
| 9 | 16GB cards (5080/4080S/5070Ti/5060Ti) | ~$1,000-1,800 | 16GB | Yes (CUDA) | Yes (4-bit only) | No (no 32B) | 180-360W | Good (5060 Ti) | DIY |
| 10 | Datacenter/pro (A100, P40/V100, A6000, 6000 Ada) | $200-9,500 | 16-80GB | Yes (P40/V100 aging) | Yes | varies | 250-400W | Mostly poor (passive/server) | High |

*Prices reflect the 2026 DRAM/GDDR7/LPDDR5x shortage and are trending up; verify live before buying. Shortage not expected to normalize before ~2028.*

## #1 recommendation - single used RTX 3090

Right-sized for the *actual* job and the *cheapest* way to own real CUDA. The 7B VLM is not a tight fit on 24GB; the single-tenant intermittent pattern means latency (not throughput) is what matters, and a 3090 lands it with margin. Crucially, the optical-flow `ort`/RAFT sidecar, bitsandbytes/PEFT LoRA, and OpenCV's NVOFA optical-flow engine all **pip-install and work** on x86 CUDA-12 - none of the aarch64 (Spark) or ROCm-Preview (AMD) porting. The tower is upgradeable, so 48GB/72B is a *later* decision, not a now-cost.

**Mitigate the one weakness (home noise/heat):** repad the GDDR6X on arrival, undervolt (~875-925mV), site it in an office/closet not a bedroom.

## Runner-up - NVIDIA DGX Spark

Pick it over the 3090 if you weight: (1) living-space friendliness (near-silent, tiny, ~25W idle), (2) one-box 72B capacity without multi-GPU, (3) learning the genuine NVIDIA datacenter stack. Accept: $4,699 (most expensive; rose 18% on the memory crunch), 273 GB/s caps big-model **decode** (load-not-speed - fine for your 7B, painful for fast 70B serving), and **aarch64+sm_121+CUDA-13 fragility** that lands on your `ort` sidecar (NGC containers are the clean path). If that friction reads as "learning," it's a defensible #1; if it reads as yak-shaving, the 3090 wins.

## Positioning

- **vs Apple-only:** Apple is the better *pure VLM-serving* box and best home citizen (silent, MLX, 546 GB/s decodes big models faster than the Spark). It loses only on the axis you weighted - no CUDA -> MPS port for optical-flow/training, no NVOFA. Plus the 128GB Mac Studio is supply-discontinued (96GB max new, 9-10wk lead). Choose Apple **only** if CV/training moves to cloud.
- **vs staying cloud:** ~$0-3/mo, ~$0-110 over 3yr. Hardware **never** pays back here. Legitimate reasons = **privacy** (screenshots are UIPE's raw input + Track-3 data), **independence** (post-Fly rug-pull), **CUDA learning**. Don't rationalize the spend as cloud savings - that math never closes. The 3090 makes the bet at minimal sunk cost.

## Builds by tier

**~$2,000 - Single used RTX 3090 (the recommendation):** 3090 24GB ~$1,050 + Ryzen 5 7600 ~$200 + B650 ~$150 + 64GB DDR5 ~$160 + 850W Gold ~$120 + 2TB NVMe ~$120 + case ~$90 + air cooler ~$40 + repad kit ~$20 = **~$1,950**. (Turnkey ~$2k alternative if you drop local CV/training: Mac mini M4 Pro 96GB or Strix Halo Beelink GTR9 Pro 128GB ~$1,900 - quiet/efficient, **no CUDA**.)

**~$4,000 - pick by priority:**
- **A) Dual 3090 (48GB):** 2x 3090 ~$2,100 + Ryzen 9 7900 ~$330 + X670E ~$300 + 128GB DDR5 ~$330 + 1200W Platinum ~$240 + 2TB NVMe ~$120 + full tower/open frame ~$150 = **~$3,700-4,000**. Runs 72B-Q4 + real LoRA; loudest/hottest - power-limit 280W/card or water-cool from day one.
- **B) DGX Spark (turnkey, quiet):** **$4,699**. Full CUDA + 128GB + silence; eat the aarch64 friction.

**~$7,000+ - money-no-object roadmap-complete:** RTX PRO 6000 Blackwell **Max-Q** (96GB, 300W) ~$8,500-9,200 + 9950X ~$550 + X870E ~$300 + 128GB DDR5 ~$330 + 1000W Platinum ~$180 + 4TB Gen5 ~$300 + case/cooling ~$200 = **~$10,400-11,100**. 96GB ECC at 1.79 TB/s, NVOFA, fast LoRA, and the 300W Max-Q is home-livable (vs the 600W edition's ~918W-system, 12k-RPM fan). Impossible to justify on cost for a 7B VLM - a "one box forever" buy. *(A single 5090 build at ~$4,200-5,000 is faster CUDA but 32GB can't single-card 72B and the 575W/12VHPWR heat+safety profile is the worst here - not recommended unless you specifically want max compute.)*

## Sources

- DGX Spark price/specs: [Tom's Hardware ($4,699, +18%)](https://www.tomshardware.com/desktops/mini-pcs/nvidia-dgx-spark-gets-18-percent-price-increase-as-memory-shortages-bite-founders-edition-now-usd4-699-up-from-usd3-999), [TechPowerUp](https://www.techpowerup.com/346833/nvidia-raises-dgx-spark-pricing-to-usd-4-700), [NVIDIA Developer Forums price change](https://forums.developer.nvidia.com/t/2-23-2026-price-change-announcement/361713), [NVIDIA Marketplace](https://marketplace.nvidia.com/en-us/enterprise/personal-ai-supercomputers/dgx-spark/)
- DGX Spark performance/bandwidth: [LMSYS GB10 review (273 GB/s, decode bottleneck)](https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark/), [Ollama Spark benchmarks](https://ollama.com/blog/nvidia-spark-performance), [vLLM on DGX Spark](https://vllm.ai/blog/2026-06-01-vllm-dgx-spark), [idle-power firmware update](https://www.tomshardware.com/tech-industry/artificial-intelligence/nvidia-dgx-spark-update-cuts-idle-power-by-32-percent-or-more-hot-plug-detection-on-connectx-nic-makes-for-a-more-efficient-ai-workstation)
- DGX Spark aarch64/sm_121 software friction: [vLLM issue #36821](https://github.com/vllm-project/vllm/issues/36821), [ONNX Runtime GPU build guide for GX10](https://forums.developer.nvidia.com/t/onnx-runtime-gpu-inference-on-dgx-spark-gx10-build-guide-and-prebuilt-binaries/366157)
- Used RTX 3090 price: [BestValueGPU 3090 tracker (~$1,050, Jun 2026)](https://bestvaluegpu.com/history/new-and-used-rtx-3090-price-history-and-specs/), [XDA used 3090 best value](https://www.xda-developers.com/used-rtx-3090-still-best-for-local-ai-in-value/), [D-Central used 3090 for LLMs 2026](https://d-central.tech/used-rtx-3090-for-llms-2026/)
- 3090 single-card serving: [dev.to vLLM on single 3090 production guide](https://dev.to/ever9998/achieving-maximum-throughput-on-vllm-with-a-single-rtx-3090-a-production-guide-for-7b-llms-2g6e), [vLLM Qwen2.5-VL recipe](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen2.5-VL.html)
- Dual 3090 / multi-GPU + cooling: [compute-market multi-GPU guide 2026](https://www.compute-market.com/blog/multi-gpu-local-llm-setup-guide-2026), [bestgpuforllm dual 3090 (NVLink not needed for inference)](https://bestgpuforllm.com/articles/how-to-run-two-rtx-3090s-for-llm/), [FormulaMod dual-3090 cooling](https://www.formulamod.net/blogs/new/dual-rtx-3090-nvlink-70b-llm-cooling-guide)
- RTX 5090 price/power/connector: [BestValueGPU 5090 tracker](https://bestvaluegpu.com/history/new-and-used-rtx-5090-price-history-and-specs/), [GDDR7 cost impact](https://dasroot.net/posts/2026/05/rtx-5090-gddr7-costs-impact-local-inference/), [575W TDP (TechPowerUp)](https://www.techpowerup.com/330459/nvidia-geforce-rtx-5090-features-575-w-tdp-rtx-5080-carries-360-w-tdp), [12VHPWR melting tracker (WCCFtech)](https://wccftech.com/roundup/nvidia-rtx-5090-16-pin-connector-melting-issues-tracker/), [Tom's Hardware fire report](https://www.tomshardware.com/pc-components/gpus/nvidia-rtx-5090-power-wire-reportedly-caught-fire-despite-using-the-original-cable), [5090 build cost](https://www.buildmypconline.us/build-guides-for-custom-pcs/rtx-5090-pc-build-cost-for-llm/)
- RTX PRO 6000 Blackwell (Workstation/Max-Q): [Thunder Compute pricing](https://www.thundercompute.com/blog/nvidia-rtx-pro-6000-pricing), [StorageReview (918W system, noise)](https://www.storagereview.com/review/nvidia-rtx-pro-6000-workstation-gpu-review-blackwell-architecture-and-96-gb-for-pro-workflows), [Max-Q vs Workstation](https://www.bestgpusforai.com/gpu-comparison/rtx-pro-6000-blackwell-server-vs-workstation-vs-max-q-edition), [Vadi Taslim benchmarks](https://www.vaditaslim.com/blog/ai/local-llm-benchmarks-rtx-pro-6000)
- AMD Strix Halo: [llm-tracker AI Max+ 395 perf (~212 GB/s)](https://llm-tracker.info/AMD-Strix-Halo-(Ryzen-AI-Max+-395)-GPU-Performance), [ROCm gfx1151 strixhalo guide](https://rocm.docs.amd.com/en/latest/how-to/system-optimization/strixhalo.html), [ServeTheHome AMD Ryzen AI Halo dev box $3,999](https://www.servethehome.com/amd-details-ryzen-ai-halo-ai-dev-mini-pc-pre-orders-in-june-for-3999/), [Framework Desktop](https://frame.work/desktop)
- Apple Mac Studio: [WillItRunAI M4 Max 128GB (546 GB/s, Qwen2.5-VL-72B ~15 tok/s)](https://willitrunai.com/macs/m4-max-128gb), [Apple power table](https://support.apple.com/en-us/102027), [128GB Mac Studio discontinued (Tom's Hardware)](https://www.tomshardware.com/desktops/apple-quietly-axes-128gb-mac-studio-amid-supply-constraints-and-local-ai-frenzy-highest-memory-capacity-reduced-to-96gb-two-months-after-discontinuation-of-512gb-model), [MacRumors RAM cuts](https://www.macrumors.com/2026/05/05/apple-mac-studio-mac-mini-ram-cuts/)
- NVOFA optical-flow on NVIDIA HW: [NVIDIA OpenCV optical-flow blog](https://developer.nvidia.com/blog/opencv-optical-flow-algorithms-with-nvidia-turing-gpus/), [Optical Flow SDK](https://developer.nvidia.com/optical-flow-sdk)
- Economics / electricity: [EIA electricity monthly](https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=table_5_03), [local-LLM power consumption](https://www.promptquorum.com/local-llms/local-llm-power-consumption)
- UIPE codebase (load-bearing for the ort/RAFT CUDA-track claim): crates/uipe-vision/Cargo.toml (ort = 2.0.0-rc.9), crates/uipe-vision/src/inference.rs (RAFT ONNX inference), docs/autopilot-program-roadmap.md (#1 optical-flow, #6 world-model training)