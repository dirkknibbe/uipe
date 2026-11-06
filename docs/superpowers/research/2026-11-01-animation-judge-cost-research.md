# UIPE Animation-Taste Dataset: Decision Report (2026-11-01)

Each cited figure carries a source key such as `[G-PRICE]`, with **V** (VERIFIED, read on the primary source) or **R** (REPORTED, secondary source, or our own derivation). The full URLs are in §8. **Derived** means our own arithmetic on cited inputs. **⚠old** means the source is more than 12 months old.

---

## 1. Bottom line

The money is not the binding constraint. A 4-judge panel fits tens of thousands of clips per month into $100. What actually limits volume is (a) how many sites tolerate a crawler, (b) whether VLM judges can perceive motion at all, and (c) the Gemini price increases.

**Fixed costs.** The recording box is a Hetzner CX33 at $9.99 plus IPv4 at $0.60, so $10.59 [HETZ V, HETZ-IP V]. Storage is about $1 [R2 V]. We reserve $5 for pilot, calibration and escalation. That leaves **$83/month for judging**.

**Per-clip cost assumptions** (all derived): a 2s clip at **10 fps** (20 frames, the AniMINT minimum [ANIMINT V]), a 1,500-token rubric plus signals prompt, 300 output tokens, no thinking tokens, and batch pricing wherever the vendor offers it.

| Config | Panel | $/clip (batch) | Clips/mo = $83 ÷ $/clip |
|---|---|---|---|
| **Cheap** | Gemini 3.1 Flash-Lite (low res) + GPT-6-luna + Claude Haiku 5.5 + Qwen3.8-flash | 0.00058 + 0.00044 + 0.00045 + 0.00070 = **$0.00217** | **≈38,000** |
| **Quality** | Gemini 3.8 Flash (default res, **Jan-2027 price**) + Claude Sonnet 5.5 + GPT-6.1-terra + Qwen3.8-max | 0.0061 + 0.0090 + 0.0044 + 0.0092 = **$0.0287** | **≈2,900** |
| **Hybrid (recommended)** | Cheap panel on every clip, plus the quality panel on the 10% of clips where judges disagree | 0.00217 + 0.1 × 0.0287 = **$0.0050** | **≈16,500** |

**How each per-clip figure was computed** (derived):
- **Flash-Lite**: (1,320 frame + 1,500 text tokens) × $0.25/M + 300 × $1.50/M = $0.00116, halved by batch [G-PRICE V, G-VID V].
- **Luna**: 20 × 288 + 1,500 = 7,260 input tokens × $0.10/M + 300 × $0.50/M = $0.00088, halved by batch [O-PRICE V, O-VIS V]. The ×1.2 image multiplier for luna is assumed.
- **Haiku 5.5**: 20 × 299 + 1,500 = 7,480 × $0.10/M + 300 × $0.50/M = $0.00090, halved by batch [C-PRICE V, C-VIS V].
- **Qwen3.8-flash**: 10 × 11 × 20 + 1,500 = 3,700 × $0.15/M + 300 × $0.47/M = $0.00070. No batch discount [OR V, QWEN-HF V/derived].
- **Gemini 3.8 Flash**: (5,160 + 1,500) × $1.50/M + 300 × $7.50/M = $0.0122, halved by batch to $0.0061.
- **Sonnet 5.5**: 7,480 × $2/M + 300 × $10/M = $0.018, halved by batch to $0.009.
- **Terra**: 7,260 × $1/M + 300 × $5/M = $0.0088, halved by batch to $0.0044.
- **Qwen3.8-max**: 3,700 × $2/M + 300 × $6/M = $0.0092.

**Adjustments to these figures:**
- **Pairwise judging** (two clips per call, run in both orders) costs about 4× per comparison.
- **Uncapped thinking tokens** can multiply output cost 5–20× [C-PRICE V, billed as output].
- **Gemini 4 Argon** doubles to $4/$20 on 2026-12-01, and **Gemini 3.8 Flash** doubles to $1.50/$7.50 on 2027-01-01 [G-PRICE V]. The quality row already uses the 2027 price.

---

## 2. Recommended judge setup

| Lens | Primary signal | VLM role | Model tier |
|---|---|---|---|
| **Performance / jank** | **Objective only.** CDP trace frame timings, Long Animation Frames (50 ms threshold, Chrome 123+) [LOAF V ⚠old], the Lighthouse non-composited-animations failure reasons [LH V ⚠old], and layout shifts [LS V] | Turns the numbers into a verbal explanation only | Cheap tier, text-only |
| **Accessibility** | **Objective only.** The WCAG 2.3.1 general and red flash thresholds (≤3 flashes/s, 10% luminance delta, darker frame <0.80, plus the area rule) computed on the frames [WCAG V]. A reduced-motion diff from two recordings, one with `Emulation.setEmulatedMedia` prefers-reduced-motion [CDP V], compared by optical-flow magnitude | None for pass/fail | None |
| **Motion craft** | **Hybrid.** Declared timing and easing come from CDP `Animation` events (duration, delay, easing, keyframes; the domain is experimental) [CDP V]. Add the measured duration, an easing curve fitted from flow or bbox data, and the declared-vs-actual end-state gap, all as a text caption | Judges choreography (order, stagger, spatial coherence) from frames | Cheap panel; escalate on disagreement |
| **Purpose** | DOM and interaction context plus the measured-motion caption (the setup that performed best in AniMINT, with a small gain: acc 0.59 → 0.61) [ANIMINT V] | Primary | Cheap panel; escalate to the quality panel. Expect accuracy around 0.6: 0.64 was the best in AniMINT, and "Aesthetic" recall was 0.16 [ANIMINT V] |

**Input choices**
- **Frames or video.** Use frames: 10 fps sampled from a 60 fps capture, at a maximum of 480 px [ANIMINT V]. Native video showed no gain in AniMINT (Gemini-2.5-Pro: 0.63 on video vs 0.64 on frames) [ANIMINT V]. Gemini native video at low resolution (66 tokens/frame, custom fps in static mode only) is the cheapest input format if you want it [G-VID V].
- **Which models can take video.** Claude and OpenAI take images only. Claude reads only the first frame of a GIF [C-VIS V], and OpenAI accepts only non-animated GIFs [O-VIS V].
- **Jank is never a vision task.** A dropped frame at 60 Hz lasts about 16.7 ms (simple arithmetic; the cited Android source was unreachable, so use the Chromium jank doc [JANK, not read]). Frame sampling can skip it entirely. LoAF's 50 ms threshold also misses drops of 20–40 ms [LOAF V], so CDP frame timing is required.

**Discounts**
- The Batch API is 50% off at Gemini, Anthropic and OpenAI, and OpenAI's Flex tier is also 50% off [G-PRICE V, C-PRICE V, O-PRICE V].
- Caching the rubric saves only 10–25%, because frame tokens dominate the input [derived]. Cache reads cost 10% of input for Haiku and 5% for Sonnet, Opus and terra [C-PRICE V, O-PRICE V corrected].
- OpenRouter's `glm-5.3-flash:batch` is **more expensive** than the base model ($0.05/$0.18 vs $0.0285/$0.0923) [OR V corrected].

**Escalation.** Send a clip to the quality panel, or to Gemini 4 Argon or Sonnet 5.5, when any of these holds:
- the panel disagrees with itself;
- the verdict flips when the clip order is swapped;
- the VLM verdict contradicts the objective signals.

A calibrated abstain policy can guarantee a target level of human agreement on the clips it does score [TOE V ⚠old].

**Panel diversity.** A mixed-family panel of small models beat a single GPT-4 judge at more than 7× lower cost (April 2024 prices, text tasks) [POLL V ⚠old]. **Caveat:** in VGI-Bench, a Claude-Haiku-4.5 video judge scored near chance (47.9%), while Gemini-3-Flash reached 73.2% [VGI V]. Haiku 5.5 should earn its panel seat in the pilot, or be replaced by Gemma-4-26B ($0.068/$0.225; a :free variant exists) [OR V].

---

## 3. Hosting and storage

| Choice | $/mo | Notes |
|---|---|---|
| **Hetzner CX33** (4 vCPU / 8 GB, EU only: fsn1, nbg1, hel1) | $9.99 + $0.60 IPv4 = **$10.59** | Price as of 2026-06-15 [HETZ V, HETZ-IP V ⚠old page, still live, HETZ-LOC V]. Our estimate of 2–4 recording Chromes and about 1,000 clips/hr is **unverified** and needs a benchmark. VP9 encoding is heavier than the old VP8. |
| Burst alternative: **Modal** | $0 within the $30/mo credit | 2 cores + 4 GiB costs $0.126/hr, so the credit covers about 238 hr/mo [MODAL V] |
| Burst alternative: Cloud Run jobs | Free up to 240k vCPU-s/mo | [CR R] |
| Oracle A1 | $0 | Free allowance is 2 OCPU / 12 GB. Capacity is scarce, and idle instances can be reclaimed [ORCL V] |
| Avoid: Fly shared-cpu | — | 6.25% CPU baseline once the burst balance runs out [FLY-CPU V] |
| Avoid: Fly performance-2x | $66 | [FLY V] |
| Avoid: Railway (2 vCPU / 4 GB) | ≈$80 (derived from $20/vCPU + $10/GB) | [RAIL V] |
| **Storage: Cloudflare R2 Standard** | ≈$0.2–1 | $0.015/GB-mo, 10 GB free, no egress fees, 1M Class A operations free [R2 V]. Example: 38k clips × (0.64 MB webm + about 0.3 MB of keyframe PNGs) ≈ 36 GB, so about $0.39 for the month's data. This grows cumulatively each month. |
| Storage alternative: Backblaze B2 | ≈$0.25 | $6.95/TB-mo, 10 GB free [B2 V] |

**Clip format**
- Playwright 1.64+ encodes VP9 (commit 2c751825d, 2026-10-01). Bitrate is 1000k × (w·h·fps)/(800·450·25), which works out to **2.56 Mbps ≈ 640 KB per 2s clip at 1280×720@25** [PW-SRC V corrected]. The bitrate is not configurable [PW-DOC V].
- Store webm plus 3 lossless PNG keyframes per clip, at declared-start, middle and declared-end.
- Full PNG frame sequences would be about 30–180 GB per 10k clips, which is $0.30–2.60 on R2. This estimate comes from local UI PNGs, not a primary source [FRAME-LOCAL, corrected down 3–10×].
- **Optical flow on lossy VP9 is untested.** Consider running flow on CDP screencast frames instead.

**Free option, no source.** The Intel Mac itself can serve as a recorder for $0. It also uses a residential IP that belongs to the owner, which avoids datacenter-ASN blocks.

---

## 4. Budget table (hybrid config)

| Line item | $/mo | Assumptions | Source |
|---|---|---|---|
| Hetzner CX33 + IPv4 | 10.59 | EU, excludes VAT | [HETZ V, HETZ-IP V] |
| R2 storage and operations | 1.00 | Ceiling estimate for 16k–38k clips/mo; 0.94 MB/clip; ops within the free tier | [R2 V, PW-SRC V] |
| Bulk judging (cheap panel, batch) | 35.80 | 16,500 clips × $0.00217 | §1 derived |
| Escalation (quality panel, batch) | 47.40 | 10% of clips = 1,650 × $0.0287 | §1 derived |
| Calibration / pilot reserve | 5.00 | 150 pairs × 2 orders × 4 judges at quality price ×2 (two clips per call) ≈ $17 one-time; spread over the first months, with leftovers funding the fps/resolution pilots | derived |
| **Total** | **≈$99.80** | No thinking tokens; quality row uses Jan-2027 Gemini pricing | |

---

## 5. Panel calibration methodology

| Topic | Recommendation | Source |
|---|---|---|
| Order bias | Query both orders and convert conflicting answers into a tie (0.5). In MT-Bench, GPT-4 was only **65.0% consistent** on near-identical pairs, which is the closest analogue to same-kind clips. | [GENARENA V, MTB V ⚠old] |
| Structure of the bias | The bias is systematic, depends on the judge and the task, and gets worse as the quality gap between items narrows. Measure position consistency per judge. | [POS V] |
| Pairwise or pointwise | Pairwise. A video judge improved from 57.0% to 61.5% when switched to pairwise. | [GENARENA V] |
| Realistic ceiling | About 60–75% judge-human pairwise agreement (61.5% and 73.2% in the two studies). | [GENARENA V, VGI V] |
| Aggregation | Fit Bradley-Terry with bootstrap confidence intervals (resample pairs, refit, take the 2.5/97.5 percentiles). | [ARENA R ⚠old] |
| Pair selection | Choose pairs actively (for example by repeated sorting) rather than at random. The number of comparisons needed depends on the score gaps. | [MAYSTRE V ⚠old, HECKEL V ⚠old] |
| **Is 150 pairs enough?** | **Derived:** at p = 0.7, the 95% half-width is 1.96·√(0.21/150) = **±7.3 pp overall**. Split across 4 lenses (about 37 pairs each), it is **±15 pp**. Getting to ±5 pp needs 0.21·(1.96/0.05)² ≈ **323 pairs**. So 150 pairs supports a rough overall calibration, but cannot rank judges or separate lenses. Grow the set through spot-checks. The 200–400 figures in the practitioner blog are unreliable, because that post contradicts its own code. | [BLOG-N R, corrected] |
| Spot-checks | Route the abstained or escalated clips (selective evaluation) to the owner. Each agree/disagree verdict adds a calibration label. Exchangeability assumption: new site types can break the calibration guarantee. | [TOE V ⚠old] |

---

## 6. Prior art

| Item | What it offers | License | Use |
|---|---|---|---|
| AniMINT (ACL Findings 2026) | 300 UI animation clips (15.67% web), labelled for effect, meaning and 7 purposes. No quality labels. | **CC BY-NC-ND 4.0** | Evaluation and citation only; no derivatives [ANIMINT-HF V] |
| MotionLint v0.1 | Playwright audit of duration, easing, stagger and reduced-motion, plus VLM review of 16 frames over 750 ms. Self-reported cost $0.019–0.293 per review. | **MIT** | Seed the rubric from `docs/STANDARDS.md` [ML V] |
| GUI-World (ICLR 2025) | 12,379 GUI videos with QA labels | CC BY 4.0 | Possible pretraining or negatives [GUIW V ⚠old] |
| Mind2Web | More than 2,000 tasks across 137 sites (HTML plus actions) | CC BY 4.0 | URL and task seeds [M2W V] |
| WebLINX | More than 100k actions, with DOM and screenshots | CC BY-NC-SA 4.0 | Share-alike applies [WLX V] |
| Rico | Android transition GIFs (214 GB) | **Unclear** (the copyright link returns 404) | Avoid [RICO V] |
| Awwwards | Curated sites of "good" design | All rights reserved | Use as a URL list only; never redistribute its media [AWW V] |
| 60fps.design | UI animation gallery | Not checked | Reference only [60FPS R] |
| CDP Animation, LoAF, Layout Instability, Lighthouse | Objective timing, jank and compositing signals | Chromium / web specs | Core of the objective layer [CDP V, LOAF V, LS V, LH V] |
| PEAT / EPI LENS | Flash-risk checkers | PEAT's license restricts commercial use; EPI LENS is unverified | Implement WCAG 2.3.1 directly instead [PEAT R, EPI R] |

---

## 7. Risks and open questions

| Risk | Detail | Mitigation |
|---|---|---|
| **Judge credibility on motion** | AniMINT's results are on 2025-era models. Five of nine models scored 0 on a password-field shake [ANIMINT V]. Moment-Video's best model reached 39.6% on brief events [MOMENT V]. Nothing has been published on VLMs judging easing. | Objective-first lenses, a measured-motion caption in the prompt, and an in-house injected-frame-drop test at 10/15/30 fps |
| Price schedule | Gemini 4 Argon doubles on 2026-12-01; Gemini 3.8 Flash doubles on 2027-01-01 [G-PRICE V] | Keep the bulk tier on 3.1 Flash-Lite, which has no scheduled change |
| Thinking tokens | Billed as output, 5–20× [C-PRICE V] | Use non-thinking modes or cap the thinking budget |
| Unverified token accounting | GPT-6-luna and terra image multipliers are undocumented (1.2 assumed) [O-VIS V]. OpenRouter video billing for Qwen3.8 is provider-specific [OR V]. The Gemini doc gives 258 tokens as the "default" frame cost but also says the default is "low" [G-VID V corrected]. | Read the `usage` field from one real call per model |
| Bot blocking | Datacenter ASNs and headless browsers get challenged [BOT R], and a challenged page produces a clip of the challenge screen | Identify the crawler with a UA and contact URL, consider Cloudflare Web Bot Auth [CF-WBA R], use no evasion, and detect challenge pages |
| robots.txt and ToS | robots.txt is not access authorization. Re-fetch it every 24 h; on a 5xx response, assume everything is disallowed [RFC V ⚠old]. Meta v. Bright Data protected logged-out scraping, but it is a district-court ruling and Meta dropped the case [META R ⚠old]. Awwwards' terms do not address scraping [AWW V]. | Stay logged out, crawl politely, honor robots.txt |
| Copyright of clips | Recorded clips copy third-party designs | Keep the dataset private or research-only and do not redistribute raw clips. Get a legal review before any commercial use. |
| Throughput unverified | 2–4 Chromes per CX33, 1–2 GB per browser [blog R] | Benchmark before scaling |
| Headless timing fidelity | Headless compositor timing may differ from headed Chrome. Behaviour on arm64 is unknown. | Validate against headed Chrome on the Mac |
| Free tiers | Gemini free-tier rate limits are unchecked, and free-tier data may be used for training [G-PRICE V]. The GitHub Actions acceptable-use policy for crawling is unchecked [GHA V]. | Don't depend on free tiers for the bulk work |

---

## 8. Sources

- **G-PRICE** https://ai.google.dev/gemini-api/docs/pricing
- **G-VID** https://ai.google.dev/gemini-api/docs/video-understanding
- **C-PRICE** https://platform.claude.com/docs/en/about-claude/pricing
- **C-VIS** https://platform.claude.com/docs/en/build-with-claude/vision
- **O-PRICE** https://developers.openai.com/api/docs/pricing
- **O-VIS** https://developers.openai.com/api/docs/guides/images-vision
- **OR** https://openrouter.ai/api/v1/models
- **QWEN-HF** https://huggingface.co/docs/transformers/model_doc/qwen3_vl
- **ANIMINT** https://arxiv.org/html/2604.26148v3
- **ANIMINT-HF** https://huggingface.co/datasets/pubacc/AniMINT/blob/main/README.md
- **MOMENT** https://arxiv.org/abs/2606.02522
- **GENARENA** https://arxiv.org/html/2602.06013
- **VGI** https://arxiv.org/html/2608.19583
- **WCAG** https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- **JANK** https://chromium.googlesource.com/chromium/src/+/00b1750b7cc977e46ff486e2543f45dc706040a6/docs/graphics/scrolling/scroll_jank_metric.md
- **HETZ** https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- **HETZ-IP** https://docs.hetzner.com/general/others/ipv4-pricing/
- **HETZ-LOC** https://docs.hetzner.com/cloud/general/locations/
- **MODAL** https://modal.com/pricing
- **CR** https://cloud.google.com/run/pricing
- **FLY** https://docs.fly.io/about/pricing
- **FLY-CPU** https://docs.fly.io/machines/cpu-performance
- **RAIL** https://railway.com/pricing
- **GHA** https://docs.github.com/en/billing/concepts/product-billing/github-actions
- **ORCL** https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
- **R2** https://developers.cloudflare.com/r2/pricing/
- **B2** https://www.backblaze.com/cloud-storage/pricing
- **PW-SRC** https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/videoRecorder.ts and https://github.com/microsoft/playwright/commit/2c751825d
- **PW-DOC** https://playwright.dev/docs/videos
- **FRAME-LOCAL** /Users/dirkknibbe/uipe/ui-perception-engine/landing/screenshots/
- **RFC** https://www.rfc-editor.org/rfc/rfc9309.html
- **META** https://www.fbm.com/post/102kqw7/
- **CF-WBA** https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/index.md
- **BOT** https://dev.to/agenthustler/how-anti-bot-systems-detect-scrapers-in-2026-and-how-to-get-past-them-5fpp
- **MTB** https://arxiv.org/html/2306.05685v4
- **POS** https://arxiv.org/abs/2406.07791
- **POLL** https://arxiv.org/html/2404.18796
- **TOE** https://arxiv.org/abs/2407.18370
- **ARENA** https://arxiv.org/pdf/2403.04132
- **MAYSTRE** https://arxiv.org/abs/1502.05556
- **HECKEL** https://ar5iv.labs.arxiv.org/html/1606.08842
- **BLOG-N** https://dev.to/maya_andersson_dev/your-llm-as-judge-eval-set-is-too-small-here-is-the-math-2iac
- **CDP** https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json
- **LOAF** https://developer.chrome.com/docs/web-platform/long-animation-frames
- **LH** https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations
- **LS** https://developer.mozilla.org/en-US/docs/Web/API/Layout_Instability_API
- **RICO** https://www.interactionmining.org/archive/rico
- **M2W** https://huggingface.co/datasets/osunlp/Mind2Web/blob/main/README.md
- **WLX** https://huggingface.co/datasets/McGill-NLP/WebLINX
- **GUIW** https://huggingface.co/datasets/shuaishuaicdp/GUI-World/blob/main/README.md
- **AWW** https://www.awwwards.com/terms/
- **ML** https://github.com/bobaba99/motionlint
- **PEAT** https://trace.umd.edu/?p=705
- **EPI** https://gh.r-mj.com/Pi-0r-Tau/EPI-LENS
- **60FPS** https://www.abduzeedo.com/60fps-curated-library-ui-animation-design
