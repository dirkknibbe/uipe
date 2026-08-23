# MCPaaSTA — MCP as a Service to Agents

**Date**: 2026-04-14
**Status**: Design spec — revised after review
**Author**: Dirk Knibbe + Claude

## Overview

MCPaaSTA is the hosted cloud offering of UIPE (UI Perception Engine). It exposes all 12 UIPE MCP tools as a remote MCP server that agents connect to natively. Agents get temporal perception of any web UI without running Playwright, vision models, or any local infrastructure.

Paid tier uses x402 micropayments (USDC on Base). A generous free tier requires only a user identifier (email or GitHub handle) — no payment setup needed. This separates product-market-fit discovery from payment rail adoption.

## Goals

1. All 12 UIPE tools available as a remote MCP service
2. Sub-agent implementable — clean boundaries, independently testable units
3. Secure by default — agent requests run in isolated containers, no access to internal infrastructure
4. Observable — operational metrics, cost tracking, and behavioral analytics from day one
5. Discoverable — listed in MCP registries, x402 Bazaar, with a landing page
6. Low fixed cost at launch — optimize for discovery, scale infrastructure with demand

## Non-Goals

- Landing page visual design (separate sub-project, own design cycle)
- Custom/enterprise features (no per-customer allowlists, no SLAs)
- Self-hosted vision models as a cost optimization (deferred — launch with Qwen2.5-VL on GPU + Anthropic Messages API with image blocks, referred to throughout as "Messages API")

---

## Decision Log

Every major design decision, why it was made, and what was rejected. Sub-agents implementing this spec should treat these as load-bearing — do not optimize away without consulting the spec author.

### D1: Payment Rail

**Chosen:** x402 for paid tier + free tier for discovery
**Rejected:** Stripe, Stripe + x402 dual-rail

**Reasoning:** We initially planned Stripe as a fallback alongside x402 to widen the audience. But when we analyzed the economics, Stripe's per-transaction fee ($0.30 + 2.9%) makes micropayments at $0.03-0.12 impossible — you'd pay more in fees than the session costs. We considered workarounds: prepaid credit wallets ($5 minimum load, amortizing fees), monthly subscriptions, and usage-based monthly invoicing. All add billing complexity for marginal gain. Rather than bolt on a second payment system that fights the price point, we committed to x402 as the native agent payment protocol — it's a positioning advantage. The free tier (D13) exists specifically to decouple PMF discovery from x402 adoption friction.

### D2: Hosting Platform

**Chosen:** Fly.io (container platform)
**Rejected:** Self-managed VPS (Hetzner/OVH), Browserless/Browserbase

**Reasoning:** The manifesto originally assumed Hetzner CPX22 instances (~$8/mo, ~3 concurrent sessions). Cheapest per-session, but you own all ops: scaling, health checks, browser crashes, security patches. That's incompatible with sub-agent implementability — ops burden can't be delegated to code agents. Browserless/Browserbase would eliminate browser ops entirely but adds per-session cost and removes control over the UIPE pipeline. Fly.io is the middle path: auto-scaling, zero-downtime deploys, Machines API for per-session containers, and you skip most ops work while keeping full control of what runs inside the container.

### D3: API Surface

**Chosen:** All 12 MCP tools
**Rejected:** Single `perceive_flow` endpoint, curated subset (e.g., navigate + get_scene + act + analyze_visual)

**Reasoning:** The manifesto's original Phase 3 vision was a single evaluation endpoint. A curated subset of browser-dependent tools was also considered. But first impressions matter for discovery — if an agent finds MCPaaSTA and half the tools don't work, they won't return. Full parity with the local server means agents can swap `local-server` for `MCPaaSTA` in their MCP config with zero tool-call changes. The session model makes this feasible: all 12 tools operate on the same Playwright browser in the session container.

### D4: Transport

**Chosen:** Remote MCP server (SSE/streamable HTTP)
**Rejected:** REST API, REST + MCP wrapper

**Reasoning:** We considered a REST API (`POST /v1/navigate`, etc.) with a thin MCP wrapper on top for dual-audience reach. But maintaining two API surfaces doubles the integration surface area. Native MCP is the simplest path, matches "MCP as a Service" positioning, and means agents add one URL to their MCP config — that's it. Non-MCP clients (curl, Postman) can't use it, but the target audience is MCP-native agents. REST wrapper can be added later if non-MCP demand appears. Security concern noted: SSE/long-lived connections are harder to rate-limit than stateless REST — addressed in the security section.

### D5: Session Model

**Chosen:** Stateful (explicit `create_session`)
**Rejected:** Stateless per-request, implicit session on first tool call

**Reasoning:** UIPE's 12 tools have implicit dependencies — `navigate` opens a page, then `get_scene`, `act`, `get_console_logs` all operate on that open page. Stateless per-request would require re-navigating on every call (slow, expensive, and makes multi-step workflows like `navigate → act → get_scene` impossible). Stateful sessions are necessary. We then chose explicit `create_session` over implicit (first tool call auto-creates a session) because explicit makes the billing moment transparent — the agent sees the 402 response, pays, and knows exactly when a session starts. Implicit would hide the charge.

### D6: Pricing Structure

**Chosen:** Tiered sessions (Scan/Deep) + free tier
**Rejected:** Flat per-session fee, session fee + per-call metering

**Reasoning:** With stateful sessions where an agent might call 2 tools or 20, flat pricing gets tricky (agent holds session open and hammers 50 calls). Per-call metering (session open fee + per-tool charge) would be fairest but makes costs unpredictable for agents. Tiered sessions preserve the Scan/Deep mental model from the manifesto, give agents a predictable upfront price, and let us cap resource exposure per tier. "I need a quick look" → Scan. "I need to explore and interact" → Deep. Clean story for agents.

### D7: Price Points

**Chosen:** $0.03 Scan (deliberate loss leader at launch) / $0.12 Deep
**Rejected:** $0.01 Scan / $0.03-0.05 Deep (manifesto originals), cost-plus pricing at discovery-phase utilization

**Reasoning:** The manifesto's pricing was based on CPU self-hosting at ~$0.003/eval with no vision model inference. We recalculated with cloud GPU costs: Scan amortized floor is ~$0.008-0.013 (Playwright container + Qwen2.5-VL inference), Deep amortized floor is ~$0.035-0.068 (add Messages API image-block calls). Deep was originally a range ($0.10-0.15) — fixed at $0.12 as the midpoint because x402 needs an exact price.

**Scan is a deliberate loss leader during discovery, not a margin product.** The "55-73% margin" figure only holds at >30% GPU utilization. Below that (the entire launch phase), per-inference cost is 5-20x amortized, making Scan break-even or negative. Sub-agents implementing this spec should not treat Scan margin as load-bearing — optimizing for it at discovery-phase utilization is optimizing for a number that doesn't exist yet. Scan's job at launch is ease of first-time payment (sub-cent hesitation), not revenue. Deep carries the real margin because Messages API image-block cost dominates and is already per-call (not GPU-hour amortized).

### D8: Vision Pipeline (provisional, confirmed by Unit 0)

**Provisionally chosen:** Two-tier (Qwen2.5-VL + Messages API)
**Rejected:** Three-tier (OmniParser + Ollama/llava + Messages API), Messages API only

**Reasoning:** The local UIPE has a three-tier vision pipeline, but that was constrained by hardware — Intel Mac, CPU-only, no CUDA, PyTorch 2.2.2 max. OmniParser handled detection because llava:7b was too slow. On cloud GPU, Qwen2.5-VL-7B is expected to do both element detection and visual understanding in one pass (~3-5s on A10G), eliminating OmniParser as a separate service. We asked: does the two-tier map to the manifesto's two-tier pricing? Yes — Scan uses the self-hosted model only (cheap), Deep adds Messages API when needed (higher cost but higher value). Messages API-only was rejected because it would make every vision call an external API expense, killing Scan margins.

**Provisional status:** Unit 0 benchmarks Qwen2.5-VL-7B against alternatives (InternVL2.5-8B, Florence-2) on real UIPE screenshots. **If Unit 0 rejects Qwen2.5-VL, the blast radius is material** — updates needed in:

- Cost Floor tables (Scan + Deep) — inference time and $/call both shift
- Latency Budget — per-call latency and caching cutoffs
- Monthly infrastructure cost table — GPU utilization math
- D8 reasoning text
- Unit 4b adapter work (the pipeline is model-specific)

Unit 0 explicitly owns producing these updates as part of its deliverable. The two-tier architecture is load-bearing; the specific standard-tier model is not. Sub-agents working on Units 1-3 can proceed in parallel with Unit 0 — they don't depend on the model choice. Units 4a/4b are gated on Unit 0 closing.

**Plan C — if all three candidates fail the bar:** launch with **Messages-API-only** for Deep tier (no standard tier). Scan tier ships **vision-degraded** (structural-only UIPE pipeline, no visual analysis). Revisit open-weight vision models quarterly as the landscape evolves (Llama 3.2 Vision, newer Qwen versions, open releases from Anthropic/Meta/Alibaba). This is a worse product but a shippable one — better than blocking launch on model selection indefinitely. Update D7 pricing: Scan drops to $0.01 (reflects structural-only scope), Deep stays at $0.12.

### D9: Architecture

**Chosen:** Three-layer (proxy + session container + vision service)
**Rejected:** Gateway + monolith ("Monolith-to-Split"), single fat container, gateway-first (two services)

**Reasoning:** Three approaches were evaluated. "Gateway-First" (two services: gateway + UIPE) keeps existing code intact but the gateway is a single point of failure. "Monolith-to-Split" (one deployable, split later) is fastest to ship but harder to split later and colocates security concerns (billing logic next to browser execution). "MCP Proxy" (three layers) has the cleanest security boundaries — proxy never touches browsers, browsers never touch billing, vision never sees user identity — and these are load-bearing for the trust model.

**Sub-agent implementability was a secondary tiebreaker, not the primary criterion.** The security boundaries and independent scaling alone justify three layers on their own merits; parallel build by multiple agents is a nice outcome but not the reason. A future reader who inherits this spec with different staffing (e.g., one human engineer rather than multiple AI agents) should not collapse the three-layer split — the security argument still holds. Flagged explicitly so "sub-agent friendly" doesn't ossify into artificial complexity.

### D10: Vision Service Topology

**Chosen:** Shared service, on-demand at launch
**Rejected:** Per-session sidecar, always-on from day one, bundled in session container

**Reasoning:** Vision models are stateless (image in, result out) and GPU-expensive. Bundling in the session container would mean every session pays for GPU allocation even if it never uses vision. Per-session sidecars waste GPU time on idle sessions. Shared service means fewer GPU instances and better utilization — the vision service never needs session context, it just analyzes images. On-demand (boot on first vision request, 10 min idle shutdown) keeps fixed costs at ~$20-40/mo during discovery vs $150-300/mo always-on. Trade-off: first vision call of the day has ~30-60s GPU cold start. Acceptable during discovery; switch to always-on when utilization justifies it (D14).

### D11: Container Strategy

**Chosen:** Warm pool of pre-booted machines, assigned per session, destroyed after
**Rejected:** Cold-boot per session, shared browser pool

**Reasoning:** Review feedback identified that cold-boot latency (1-5s for Playwright containers on Fly) was never quantified in the original spec — a meaningful UX hit for agents. Shared browser pool would be cheapest but creates SSRF/data-leak risk (cookies, localStorage from one session leaking to the next). Warm pool solves both: pre-booted machines give sub-second assignment, and each machine is destroyed after use (never recycled) preserving full isolation. Cost: ~$0.18/day for 3 warm machines at Fly shared-CPU. Pool size auto-adjusts based on utilization.

### D12: Onboarding

**Chosen:** Tiered: free tier / bring-your-own wallet / CDP provisioned wallet / testnet
**Rejected:** x402 only with no onboarding help

**Reasoning:** x402 adoption is early. Research found that agent-side setup requires an EVM wallet + USDC on Base + `@x402/fetch` — ~5 min for crypto-native devs, 20-30 min for everyone else (KYC, exchange accounts, bridging). Coinbase CDP Server Wallets provide custodial managed wallets via API (no private key handling), and the x402 repo has explicit CDP integration examples. Landing page can auto-provision a CDP wallet and offer Coinbase Pay for fiat-to-USDC on-ramp. Testnet mode uses the free x402 testnet facilitator for integration testing. Free tier (D13) removes the payment barrier entirely for evaluation.

### D13: Free Tier

**Chosen:** 10 Scan + 2 Deep per user per day at launch (loosen from data), no payment required
**Rejected:** x402-only, testnet-only, generous launch quotas (25/5)

**Reasoning:** Review feedback identified the core risk: coupling PMF discovery to an immature payment rail means you can't tell if low usage is because the product isn't valuable or because x402 is too much friction. Testnet alone isn't sufficient — evaluators know it's not real and behave differently. Free tier separates these signals.

**Why 10/2 at launch, not 25/5:** Loosening a launch quota is a config change; tightening after users have built workflows around it creates churn and bad press. 10 Scan + 2 Deep is still enough for an evaluator to integrate the service into a real workflow for a day. With 30-day-old GitHub OAuth requirement, a motivated actor with 10 aged accounts caps at ~$1.30/day of subsidy — manageable. At 25/5 the same actor reaches ~$13/day, uncomfortable. Cost at fully-utilized ceiling at 10/2: ~$0.27/day/user. Expected at ~50%: ~$0.13/day/user. Loosen to 25/5 once observability shows no farming pattern after ~4 weeks.

### D14: GPU Scaling Strategy

**Chosen:** On-demand at launch, always-on at scale
**Rejected:** Always-on from day one

**Reasoning:** A persistent GPU machine costs $150-300/mo. During discovery phase with potentially zero paying users, that's burning cash for idle GPU. On-demand (boot on first vision request, idle shutdown after 10 min) reduces fixed cost to ~$20-40/mo. Trade-off: first vision call of the day has ~30-60s cold start. Acceptable during discovery. When the vision service is cold, session containers degrade gracefully to structural-only results with a `vision_degraded: true` flag. Switch to always-on when GPU is running >50% of the day — at that point the cold-start penalty affects enough sessions to justify the fixed cost.

---

## Architecture

Three independently deployable services:

```
Agent (Claude Code, Cursor, etc.)
  |
  |  MCP protocol (SSE / streamable HTTP)
  v
+-----------------------------+
|       MCP Proxy             |
|  - Free tier / x402 payment |
|  - Session lifecycle        |
|  - URL validation           |
|  - Rate limiting            |
|  - Tier enforcement         |
|  (Stateless, horizontally   |
|   scalable)                 |
+-------------+---------------+
              |  Internal API (REST, versioned /v1/)
              v
+-----------------------------+
|   Session Container (1:1)   |
|  - Playwright browser       |
|  - UIPE structural pipeline |
|  - DOM, a11y, CSS capture   |
|  - Console/network capture  |
|  (Ephemeral Fly machine,    |
|   from warm pool,           |
|   isolated per session)     |
+-------------+---------------+
              |  Vision requests (HTTP, versioned /v1/)
              v
+-----------------------------+
|   Vision Service (shared)   |
|  - Qwen2.5-VL on GPU       |
|  - Messages API proxy  |
|  - Stateless: image->result |
|  (On-demand at launch,      |
|   always-on at scale)       |
+-----------------------------+
```

### Key Boundaries

- Proxy never touches a browser or vision model
- Session containers never handle billing or auth
- Vision service never sees URLs, sessions, or user identity — **but it does receive screenshot pixels**. The isolation is identity-only, not data-only. A compromised vision service could exfiltrate page contents via screenshots. Mitigation: vision service runs on locked-down images, no outbound network beyond Messages API (firewalled), audit logging on model output volume.
- Each service has its own health check and deploys independently

### Why This Structure

Each layer has one job. Sub-agents can build and test each layer in isolation. The security model is clean — the proxy never touches a browser, the browser never touches billing. Each layer scales independently.

### API Versioning

All internal APIs are versioned in the URL path (`/v1/analyze`, `/v1/forward`). When a breaking change is needed, deploy the new version alongside the old. Session containers and vision service can be updated independently — the proxy routes to the correct version based on the session's creation-time API version. This prevents mid-session breaking changes.

### Graceful Deploys

- **Proxy**: Rolling deploy with connection draining. Active SSE connections are not terminated — new connections go to the new version, existing connections finish on the old version. Fly supports this natively.
- **Session containers**: Never redeployed mid-session. Each session gets a machine from the warm pool running the current image version. The machine is destroyed when the session ends.
- **Vision service**: Rolling deploy. In-flight requests complete on the old instance before it's drained. Stateless, so no session affinity needed.

**Why this matters:** For a paid service, "your session died because we deployed" destroys trust. These guarantees ensure active sessions are never interrupted by infrastructure changes.

---

## Session Lifecycle

### Flow

```
Agent                    Proxy                  Session Container
  |                        |                          |
  |-- create_session ---->>|                          |
  |   (tier: scan/deep)    |-- validate auth ------>> |
  |                        |-- assign warm machine -->>|
  |<<-- session_id, ttl --|                          |
  |                        |                          |
  |-- navigate(session_id)>|-- forward ------------>>|
  |<<-- scene graph -------|<<-- result --------------|
  |                        |                          |
  |-- act(session_id) ---->|-- forward ------------>>|
  |-- get_scene(session_id)|   ...                    |
  |   ...                  |                          |
  |                        |                          |
  |  (idle timeout or      |                          |
  |   tool call limit)     |-- tear down machine -->>| X
  |<<-- session_closed ----|                          |
```

### Session Creation

**Free tier:**
1. Agent calls `create_session(tier: "scan" | "deep")` with `Authorization: Free <user_id>` header
2. Proxy checks daily quota for this user (25 Scan / 5 Deep)
3. If within quota: proxy assigns a warm Fly machine
4. Returns `session_id` + `ttl` + `tools_available`

**Paid tier (x402):**
1. Agent calls `create_session(tier: "scan" | "deep")`
2. Proxy returns `402 Payment Required` with price and payment instructions
3. Agent pays via x402 (USDC on Base)
4. Agent retries with `X-402-Payment` header
5. Proxy verifies via Coinbase hosted facilitator
6. Proxy assigns a warm Fly machine (cold-boot fallback if pool empty)
7. Returns `session_id` + `ttl` + `tools_available`

### Cold Start Targets

| Scenario | Target | Mechanism |
|---|---|---|
| Warm pool available | <1s | Pre-booted machine assigned, not booted |
| Warm pool empty (fallback) | <5s | Cold-boot Fly machine |
| Vision service (on-demand, cold) | ~30-60s first call of the day | GPU machine boot — acceptable during discovery phase |
| Vision service (warm) | <1s routing + 3-5s inference | Already running |

**Why warm pool (see D11):** Cold-boot latency of 1-5s for Playwright containers is a meaningful UX hit for agents. Pre-booted machines eliminate this. Cost: ~$5/mo for 3 warm CPU machines at Fly shared-CPU rates. Each machine is assigned to exactly one session and destroyed after — full isolation preserved.

**Warm pool sizing algorithm** (explicit, not "auto-adjust"):
- Every 60s, compute 5-minute rolling `arrivals_per_sec`
- Target pool size = `ceil(arrivals_per_sec × avg_boot_seconds × 3)` (3× safety factor)
- Floor: 2 machines. Ceiling at launch: 10 machines (prevents runaway cost).
- Scale-up: add 1 machine if current pool < target
- Scale-down: remove 1 machine if current pool > target AND all machines have been idle >10 min
- Burst handling: if pool empties mid-burst, fall back to cold boot (5s) rather than block or reject. Log "pool underrun" metric for algorithm tuning.

### Session Termination Triggers

- Max duration reached
- Max tool calls reached
- Idle timeout (no tool calls within window)
- Agent explicitly calls `close_session`
- Container crash (proxy detects health check failure)

### Failure Modes

| Failure | What happens | Agent experience |
|---|---|---|
| Fly machine fails to boot | Proxy calls facilitator RELEASE on the reserved payment (see x402 Payment State Machine); funds never leave the payer's wallet. Free tier: no quota deduction. | Error response with retry suggestion |
| Target URL unreachable (DNS error, timeout) | Session stays alive. `navigate` returns an error with details. Agent can retry with a different URL or close session. | Tool call error, session still usable |
| Vision service unavailable | Session container returns structural-only results with a `vision_degraded: true` flag. Agent gets DOM/a11y/CSS data without visual analysis. | Degraded but functional — agent can decide whether to retry or accept structural-only |
| Vision service overloaded (queue timeout) | Same as unavailable — structural-only with degradation flag. | Same as above |
| Container crash mid-session | Proxy detects via health check failure. Session marked as terminated. For paid tier: no refund (x402 is atomic). For free tier: quota restored for that session. | Session terminated error. At $0.03-0.12 per session, cost of occasional crashes is tolerable. Observability tracks crash rate. |

**Why no refunds on container crash (paid tier):** x402 payments are atomic and settled at session creation. Implementing partial refunds would require a separate payment channel. At $0.03-0.12 per session, the cost of occasional crashes is trivially low. If crash rate exceeds 1%, that's an infrastructure problem to fix, not a billing problem to solve.

### Connection Drops & Reconnection

SSE connections are fragile — proxies, load balancers, and mobile networks can drop long-lived connections. MCPaaSTA decouples the MCP transport connection from session liveness:

- **Session lives in the proxy, not on the connection.** Sessions are keyed by `session_id` and persist independently of any SSE connection.
- **Reconnect with the same `session_id`** to resume. The proxy validates the session is still active (not timed out, not terminated) and reattaches.
- **Reconnection window:** up to the session's remaining TTL. If the session has timed out server-side, reconnect returns an error pointing to `create_session`.
- **No grace period on payment** — the paid-for time is the session TTL, reconnection doesn't reset it.
- **Reconnect authentication:** the reconnecting client must re-present the same auth that created the session — GitHub OAuth token (free tier) or the original `tx_hash` from the x402 payment (paid tier). The proxy verifies the auth matches the session's stored `identity` field before reattaching. Without this, any party knowing a `session_id` could hijack the session. `session_id` alone is insufficient authorization.

### Tool Call Idempotency

Every tool call carries a client-generated `request_id`. The proxy tracks `request_id → result` for the session's lifetime:

- **In-flight when connection drops:** agent reconnects and re-sends the same `request_id`. If the call completed, the proxy returns the cached result. If still in-flight, the proxy waits on the existing execution instead of starting a new one.
- **Quota counting:** a `request_id` counts as exactly one tool call regardless of retries. Agents cannot be double-charged or double-billed for transient network issues.
- **Side-effect safety:** matters most for `act` — without idempotency, a retried click could submit a form twice. The session container tracks executed `request_id`s and returns the prior result for duplicates.

**Why this matters:** without this, a network blip during a mid-flight `act` leaves the agent guessing whether to retry. Idempotency keys make the answer mechanical.

### Explicit Session Creation

`create_session` is an explicit tool call. If an agent calls any tool without a session, the proxy returns a clear error with instructions — never silently fails.

**Why explicit, not implicit (see D5):** Implicit session creation on first tool call was considered. Rejected because it hides the billing moment — the agent wouldn't know it was charged until after the fact. Explicit creation makes the 402 → pay → session flow transparent and predictable.

---

## Pricing

### Tiers

| | Free-Scan | Free-Deep | Paid-Scan | Paid-Deep |
|---|---|---|---|---|
| **Price** | $0 | $0 | $0.03 | $0.12 |
| **Daily limit** | 10/user | 2/user | Unlimited | Unlimited |
| **Max duration** | 60s | 5 min | 60s | 5 min |
| **Max tool calls** | 5 | 25 | 5 | 25 |
| **Vision** | Qwen2.5-VL only | Qwen2.5-VL only | Qwen2.5-VL only | Qwen2.5-VL + Messages API |
| **Idle timeout** | 30s | 60s | 30s | 60s |
| **Auth** | GitHub OAuth | GitHub OAuth | x402 | x402 |

**Why these idle timeouts:** LLM agents commonly take 5-20s between tool calls for inference. Original spec had 15s/30s which would kill sessions during normal agent thinking time. 30s/60s gives agents comfortable headroom. Monitor for abuse and tighten if needed — easier to tighten than to lose legitimate sessions.

### Free Tier Scale-Up Triggers

Launch starts **tight** (10 Scan / 2 Deep). Loosen from data:

| Trigger | Action |
|---|---|
| 4 weeks post-launch, no observed farming pattern | Loosen to 15 Scan / 3 Deep |
| 8 weeks post-launch, still clean + positive feedback on quota complaints | Loosen to 25 Scan / 5 Deep |
| Farming pattern detected (velocity alarms fire) | Hold current quota, add additional friction (account age 60d, email verification) |
| Free users with production workflows | Prompt conversion to paid |
| GPU utilization >50% of day from free tier | Hold quota, evaluate always-on GPU switch |

### Cost Floor (cloud GPU)

**Important caveat:** inference cost is GPU-hour cost ÷ inferences per hour. That ratio is only favorable at sustained utilization. During the discovery phase (on-demand GPU, low volume), each Scan session may be the only one using the GPU for minutes — cost-per-inference can be 5-20x the amortized numbers below. **Scan sessions are likely break-even or negative during discovery.** This is priced in deliberately: discovery burn is capped by free-tier ceilings and GPU idle shutdown. Margins improve as utilization rises.

**Scan session** (~5 tool calls, 60s), amortized at >30% GPU utilization:

| Component | Cost |
|---|---|
| Playwright container (60s, Fly.io shared CPU) | ~$0.002 |
| Qwen2.5-VL inference (1-2 calls, amortized A10G) | ~$0.005-0.008 |
| Proxy CPU + egress | ~$0.001-0.003 |
| **Total** | **~$0.008-0.013** |

Margin at $0.03 (amortized): ~55-73%. **At <10% GPU utilization: per-inference cost ~$0.05-0.08, margin negative.**

**Deep session** (~20 tool calls, 5 min), amortized:

| Component | Cost |
|---|---|
| Playwright container (5 min, Fly.io) | ~$0.008 |
| Qwen2.5-VL inference (3-5 calls, amortized) | ~$0.015-0.025 |
| Messages API (1-2 calls) | ~$0.01-0.03 |
| Proxy CPU + egress | ~$0.002-0.005 |
| **Total** | **~$0.035-0.068** |

Margin at $0.12 (amortized): ~43-70%. At low utilization, Deep is still positive because Messages API cost dominates and is already per-call.

### Latency Budget

Deep sessions cap at 5 min = 300s. If every tool call triggers Qwen2.5-VL at 3-5s, vision alone consumes:
- 5 vision calls × 4s = 20s (6.7% of budget) — fine
- 10 vision calls × 4s = 40s (13%) — acceptable
- 20 vision calls × 4s = 80s (27%) — vision becomes the bottleneck

**Mitigation:** session container caches last vision result per page state; `act` only invalidates cache if the DOM changed materially (mutation observer signal). Rapid `act → get_scene` sequences reuse cached vision unless the page actually changed. Without this, agents doing rapid interaction loops will exhaust the time budget on vision latency, not useful work.

### Monthly Infrastructure Cost

Assumes launch quotas (10/2) and ~50% average utilization per free user (~$0.13/day/user):

| Stage | Warm pool | GPU (idle + partial boots) | Free tier sessions | Total | Revenue |
|---|---|---|---|---|---|
| **Launch** (GPU on-demand, 3 warm CPU machines) | ~$5/mo | ~$15-35/mo (occasional boots + idle burn) | ~$0 | ~$20-40/mo | $0 |
| **10 free users** | ~$5/mo | ~$30-50/mo (more boots, ~20% util) | ~$40/mo | ~$75-95/mo | $0 |
| **25 free users, 5 paid** | ~$10/mo | ~$50-80/mo (~40% util) | ~$100/mo | ~$160-190/mo | ~$25 |
| **50 free, 30 paid** (quotas loosened to 25/5 if safe) | ~$15/mo | ~$170-320/mo (GPU always-on) | ~$500/mo | ~$685-835/mo | ~$200 |
| **Breakeven** (~50 free at 10/2, ~100 paid) | ~$15/mo | ~$170-320/mo | ~$200/mo | ~$385-535/mo | ~$650 |

**Reconciliation:** warm pool (CPU-only) is ~$5/mo at 3 machines, GPU is the dominant fixed cost. The "$20-40/mo launch" figure is GPU idle burn + occasional boots, not warm pool. Free-tier cost per user at launch quotas: ~$0.13/day at 50% quota utilization, ~$0.27/day at ceiling.

### Quota Calibration

Launch quotas (tool calls, vision calls, durations) are initial estimates. Observability data from the first week of usage will drive adjustments. See Observability section.

---

## Payment Rails

### Free Tier (no payment)

- **Identity: GitHub OAuth, not email or handle.** Agent presents a token obtained via GitHub OAuth device flow. The proxy verifies the token against GitHub's API and keys quota off the GitHub user ID.
- **Proxy tracks daily usage per GitHub user_id in Redis.** In-process maps are not an option — the proxy is horizontally scalable (D9) and in-process state would double-count across replicas.
- No payment infrastructure needed
- Rate limited by daily quota only

**Why GitHub OAuth, not email/handle (updated from review):** "email or handle" with no verification is trivially farmed — one actor with 100 throwaway emails gets 2,500 Scan sessions/day (~$25/day of free cost). GitHub OAuth requires an actual GitHub account; creating 100 accounts is meaningfully harder and leaves audit trails. Device flow is agent-friendly (no browser redirect dance), and the developer audience already has GitHub accounts.

**Minimum GitHub account age: 30 days (launch requirement).** Newly created GitHub accounts are nearly free to farm and the playbook is well-known — waiting for abuse to appear post-launch is strictly worse than gating at launch. Accounts younger than 30 days get a clear error message pointing at the paid tier (testnet works from any account, so evaluators aren't blocked). 30 days is tight enough to block trivial farming, loose enough that a real developer who just made a GitHub account isn't permanently excluded.

**Why free tier exists (see D13):** Coupling PMF discovery to x402 adoption means you can't distinguish "product isn't valuable" from "payment rail is too much friction." Free tier separates these signals.

**Cost per fully-utilized free user** (hitting daily max at launch quotas of 10 Scan + 2 Deep): `10 × $0.013 + 2 × $0.068 = ~$0.27/day`. Expected at ~50% utilization: ~$0.13/day/user. **Launch starts conservative; loosen from data.** Going from 10/2 → 25/5 once the abuse picture is clear is a one-line config change; going the other way after users have grown attached is not.

### x402 Paid Tier

**Server side (MCP Proxy):**
- `@x402/mcp` middleware on the proxy
- Receiving wallet address (no private key needed server-side)
- Coinbase hosted facilitator for payment verification (`api.cdp.coinbase.com/platform/v2/x402`)
- No facilitator infrastructure to run ourselves

**Payment flow:**
1. Agent calls `create_session(tier: "scan" | "deep")`
2. Proxy returns `402 Payment Required` with price ($0.03 or $0.12) and payment instructions
3. Agent pays (USDC on Base via x402)
4. Agent retries with `X-402-Payment` header
5. Proxy verifies via facilitator, creates session
6. No refunds — atomic payment, session is the product

### Agent Onboarding

| User type | Path | Time to first call |
|---|---|---|
| Evaluator (free tier) | GitHub OAuth device flow | ~1 min |
| Crypto-native dev (paid) | Bring own wallet + `@x402/fetch` | ~5 min |
| Non-crypto dev (paid) | Landing page provisions CDP wallet, fund via Coinbase Pay | ~10 min |
| Integration tester | Testnet mode with free testnet USDC | ~2 min |

### Testnet Mode

- Parallel testnet endpoint
- Uses x402 testnet facilitator (`x402.org/facilitator`)
- Same tools, same experience, fake money
- For testing x402 integration before funding real wallets

---

## Security & Hardening

### URL Validation (on every `navigate` call)

- Block private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
- Block `file://`, `data://`, `javascript:` schemes
- Block cloud metadata endpoints (169.254.169.254, metadata.google.internal, etc.)
- Allow only `http://` and `https://`

**DNS rebinding protection:** URL validation at the application layer is insufficient — DNS can resolve differently between validation time and Playwright's actual connection (TOCTOU). Container egress firewall rules must block private IP ranges at the network level regardless of DNS resolution. This is configured in the Fly machine networking, not in application code.

**Verify before Unit 7:** Fly Machines' egress networking must support deny-by-CIDR at the network layer (not just application-level rules). If Fly does not support this natively, fall back to per-container iptables rules applied at container startup, or use a Fly Private Network with an egress proxy that enforces the blocklist. This is a Unit 7 prerequisite — confirmed before implementation begins.

### Container Isolation

- Fresh Fly machine from warm pool per session — no shared browser state
- No persistent storage — container is ephemeral, destroyed on session end
- Network egress restricted: session containers can reach public internet (to navigate URLs) and the vision service, nothing else
- Egress firewall blocks private IP ranges at network level (DNS rebinding protection)
- Resource caps per machine:
  - Scan: 1 vCPU, 2GB RAM
  - Deep: 2 vCPU, 2GB RAM

**Why fresh machine per session, not pooled (see D11):** A shared browser pool would be cheaper (reuse warm containers) but creates security risk. An agent could navigate to a page that sets cookies or local storage, and the next session on that container would inherit that state. Fresh machines guarantee zero cross-session contamination.

**Why 2GB RAM for Scan (raised from 1GB):** Playwright alone can consume 500MB+ on heavy pages. Add DOM extraction, a11y tree building, CSS computation, and serialization — 1GB is too tight for complex SPAs. 2GB provides headroom without significant cost increase.

### Rate Limiting (at the proxy)

- Per-identity rate limits (x402 payer address or free tier user_id)
- Max concurrent sessions per identity (e.g., 3 Scan, 2 Deep)
- Global circuit breaker if total active sessions exceed capacity
- Free tier: daily quota enforcement (25 Scan / 5 Deep per user)

### Vision Service Protection

- Request size limits (max image 1920x1080, downscale larger)
- Per-session vision call quotas (Scan: 5, Deep: 10 — launch generous, calibrate from data)
- Queue with 10s timeout — fail fast if overloaded
- Messages API daily/monthly spend cap (alerts at 80%)

### Vision Service Degradation

When the vision service is unavailable (down, overloaded, cold GPU booting), session containers fall back to structural-only results. The response includes a `vision_degraded: true` flag so the agent knows visual analysis was skipped.

**Why degrade instead of fail:** UIPE's structural pipeline (DOM, a11y tree, CSS) is still valuable without vision. Failing entirely when vision is down would make every session dependent on GPU uptime. Degradation preserves most of the value and keeps sessions functional.

### First-of-Day Latency for Free Tier

Cold GPU boot (30-60s) happens once per idle-shutdown cycle. If the first free-tier evaluator of the day hits this, their entire impression of the product is "it took a minute to respond" — the worst possible first touchpoint. Mitigation:

- **Landing-page pre-warm:** when a user visits the landing page and clicks "Get Started", the page fires an async `POST /internal/prewarm` to the proxy, which issues a synthetic vision request. By the time the user completes GitHub OAuth device flow (~1-2 min), the GPU is warm.
- **Canary schedule:** a proxy-scheduled synthetic request every 8-9 minutes during daytime hours in the primary user timezone. Keeps the GPU warm during working hours at marginal cost (~$2-5/day).
- **Explicit `vision_warming: true` flag** in free-tier session response if the GPU is still cold — agent can display a one-time "first request warming up vision model, ~30s" hint.

Pre-warm + canary should make the cold-start-on-first-request case rare (<5% of free sessions). Drop canary once always-on GPU ships.

### Paid Sessions and Vision Cold Boot

Degradation is acceptable for free tier. For **paid** sessions, paying $0.03 for DOM-only when the agent wanted vision is a trust-eroding outcome — the agent thinks it paid for full capability. Policy:

- **Paid session creation is blocked when vision service is cold-booting.** Proxy returns `503 VISION_WARMING` with an ETA (typical: 30-60s). Payment is not reserved — no out-of-band refund needed.
- **Free session creation proceeds** during cold boot with advance warning in the session response (`vision_warming: true`). Free users knowingly trade latency for price.
- **Mid-session vision unavailability** (service was up at creation, goes down or queue overflows during the session): degradation with `vision_degraded: true` applies to both tiers. `analyze_visual` auto-credits a vision-call quota slot back (returns error, no quota charge — already in the per-tool contract).
- **Auto-credit threshold for paid sessions:** if >50% of vision calls in a session return degraded, session is eligible for full auto-credit (scheduled refund). Logged automatically, processed in batch.

**Why this asymmetry:** blocking at creation is a clean signal ("come back in 30s"); mid-session blocking is worse than degradation because the agent has already committed. Auto-credit on majority-degraded sessions keeps the trust model intact without refund-per-degradation overhead.

---

## Vision Service

Shared, stateless, GPU-accelerated. Session containers call it — it never knows about sessions or users.

### Architecture

- Fly GPU machine(s) (A10G or similar)
- **On-demand at launch:** first vision request boots the GPU machine, shuts down after 10 min idle. Fixed cost: ~$20-40/mo.
- **Always-on at scale:** switch when GPU utilization exceeds 50% of the day. Fixed cost: ~$150-300/mo.
- Single HTTP API: `POST /v1/analyze`
- Horizontally scalable behind a load balancer

### Two-Tier Vision Routing

| Tier | When used | What happens |
|---|---|---|
| **Standard** | Every visual tool call | Image to Qwen2.5-VL. Element detection, layout description, visual state. ~3-5s on GPU. |
| **Deep** | Deep sessions only, when standard is insufficient | Image to Messages API. Complex reasoning, nuanced analysis. ~2-5s. Billed per-token by Anthropic. |

The session container decides which tier — not the agent, not the vision service.

- Scan sessions: always Standard (Qwen2.5-VL only)
- Deep sessions: Standard first. Escalate to Messages API for `analyze_visual` or when structural pipeline detects ambiguity (canvas/WebGL, complex animation state).

### Internal API (versioned)

```
POST /v1/analyze
{
  "image": "<base64 PNG>",
  "tier": "standard" | "deep",
  "prompt": "Describe the interactive elements and their states"
}

Response:
{
  "elements": [...],
  "description": "...",
  "model_used": "qwen2.5-vl-7b" | "claude-vision",
  "inference_ms": 3200
}
```

### Vision Model Choice

Local development used llava:7b due to Intel Mac / CPU-only constraints. Cloud GPU unlocks better options:

| Model | Why chosen |
|---|---|
| **Qwen2.5-VL-7B** | Strong general vision + UI understanding, ~3-5s on A10 GPU, replaces both OmniParser and llava from the local pipeline |
| **Messages API** | Deep analysis fallback for complex visual reasoning — already an API call, no infra needed |

This collapses the local three-tier pipeline (OmniParser + llava + Messages API) to a cleaner two-tier (Qwen2.5-VL + Messages API).

**Why not keep three tiers (see D8):** The local three-tier pipeline existed because of hardware constraints (Intel Mac, CPU-only, PyTorch 2.2.2 max). OmniParser handled detection because llava:7b was too slow for it. On cloud GPU, Qwen2.5-VL-7B does both detection and understanding in one pass (~3-5s), eliminating the need for OmniParser as a separate service. Fewer services = less infra, simpler deployment, easier for sub-agents to implement.

### Cost Controls

- Daily spend cap on Messages API (configurable, alerts at 80%)
- Per-session vision call quotas
- Image size limits (max 1920x1080)
- Queue with 10s timeout
- On-demand GPU shutdown after 10 min idle (launch phase)

### Scaling

- Start with 1 GPU machine, on-demand
- Switch to always-on when GPU utilization >50% of the day
- Monitor queue depth — add machines when p95 wait > 5s
- Messages API scales automatically (API call)

---

## Observability & Analytics

### Operational Metrics

**Proxy-level (billing & usage):**

| Metric | Purpose |
|---|---|
| Sessions created (by tier, by time, free vs paid) | Demand, revenue, free-to-paid funnel |
| Session duration (actual vs max) | Are quotas too tight/generous? |
| Tool calls per session (distribution) | Natural usage patterns |
| Vision calls per session (standard vs deep) | Vision cost per session, quota calibration |
| 402 -> payment -> session success rate | Onboarding funnel health |
| Payment failures / abandoned 402s | x402 flow friction |
| Free tier quota exhaustion rate | Is the free tier generous enough? |
| Rejection reasons (URL blocked, rate limited, quota hit) | Security posture, quota tuning |

**Session container (performance):**

| Metric | Purpose |
|---|---|
| Navigate latency (time to page load) | Session quality baseline |
| Tool call latency (per tool type) | Optimization targets |
| Warm pool assignment time | Cold start target verification (<1s) |
| Cold boot fallback rate | Is the warm pool sized correctly? |
| Container memory/CPU usage | Right-sizing machine specs (was 1GB enough? is 2GB headroom?) |
| Container crashes / OOM kills | Stability, resource cap tuning |
| Structural pipeline extraction time | DOM/a11y/CSS capture performance |

**Vision service (cost & quality):**

| Metric | Purpose |
|---|---|
| GPU cold boot frequency and duration | On-demand vs always-on decision |
| Inference latency (Qwen2.5-VL, p50/p95/p99) | GPU capacity planning |
| Messages API calls (count, tokens, cost) | Spend tracking, escalation rate |
| Queue depth and wait time | Scaling trigger |
| Escalation rate (standard -> deep) | Is Qwen2.5-VL sufficient for most tasks? |
| Vision degradation events (structural-only fallback) | Vision service reliability |
| Vision call failures / timeouts | Reliability |

### Behavioral Analytics

Agent behavior patterns that feed product decisions:

| Signal | What it reveals |
|---|---|
| Tool call sequences per session | Common workflows — what are agents trying to do? |
| Which tools are never/rarely used | Documentation gaps or removal candidates |
| Time between tool calls within a session | Agent thinking (long gaps) vs scripting (rapid fire) |
| Session tier choice vs actual usage | Pricing signal — are Scan users hitting limits? |
| URLs evaluated (domain-level only) | What kinds of sites? E-commerce, SaaS, portfolios? |
| Repeat visits to same domain | Agents iterating (build -> evaluate -> fix -> re-evaluate) |
| Sessions that end early (agent calls close_session) | Satisfaction — got what they needed quickly |
| Sessions that hit limits then open a new one | Quota too tight |
| Vision escalation triggers | What pushes beyond Qwen2.5-VL? Canvas, WebGL, animations? |
| Error -> retry patterns | Which failures agents recover from vs abandon |
| Free-to-paid conversion paths | What usage pattern precedes first payment? |

**Aggregate product intelligence:**

| Signal | Purpose |
|---|---|
| Peak usage hours/days | Developer work cycle correlation |
| Scan-to-Deep conversion rate | Trial -> paid usage funnel |
| Free-to-paid conversion rate | Is the free tier driving paid adoption? |
| Retention (same identity returning) | Sticky value vs curiosity |
| Tool call count growth per returning user | Deepening usage over time |

**Privacy:** All behavioral data is aggregated/anonymized. No page content, screenshots, or scene graphs stored beyond the session. Domain-level URL tracking only (e.g., "agent evaluated 3 pages on shopify.com"), never full paths. Even domain-level tracking could reveal competitive intelligence about what agents are testing — consider whether to aggregate further (e.g., category-level: "e-commerce site" not "shopify.com") if this becomes a concern.

### Implementation

- Structured JSON logs from all three services
- OpenTelemetry traces spanning proxy -> session -> vision for each request
- Grafana Cloud free tier (50GB logs, 10K metrics series, 50GB traces)
- Lightweight batch pipeline: structured log events -> aggregation -> dashboard

---

## Repository Structure

Monorepo with pnpm workspaces:

```
ui-perception-engine/
  packages/
    core/                <- existing code, extracted as shared lib
      src/pipelines/       (DOM, a11y, CSS, fusion, serializer)
      src/browser/         (Playwright management)
      src/mcp/             (tool definitions, schemas)
    local-server/        <- existing MCP server (npm installable, local)
      src/index.ts         (current entry point, uses core)
    proxy/               <- NEW: MCP proxy service
      src/auth/            (x402 middleware, free tier quota)
      src/sessions/        (lifecycle, tier enforcement)
      src/security/        (URL validation, rate limiting)
      src/telemetry/       (structured logging, OTel)
    session-runner/      <- NEW: session container service
      src/index.ts         (receives forwarded tool calls, uses core)
      Dockerfile
    vision-service/      <- NEW: shared vision service
      src/index.ts         (HTTP API, Qwen2.5-VL + Messages API routing)
      Dockerfile
  deploy/
    fly.proxy.toml
    fly.session.toml
    fly.vision.toml
    docker-compose.yml   <- local integration testing
  docs/
  landing/               <- separate sub-project
  pnpm-workspace.yaml
```

### Rationale

- `core` shared between `local-server` and `session-runner` — same pipeline, different entry points
- Tool definitions defined once in `core`, used by proxy (routing) and session-runner (execution)
- Sub-agents work on each package independently
- Single `pnpm exec tsc --noEmit` validates everything
- Existing npm package (`local-server`) unchanged for current users

---

## Landing Page & Discovery

Scoped as a **separate sub-project** with its own design cycle.

### Requirements (interface with infrastructure work)

- Explains MCPaaSTA in one sentence
- Shows x402 payment flow visually
- Free tier signup (email/GitHub handle — instant access)
- "Get Started" paid onboarding: CDP wallet provisioning, Coinbase Pay funding
- Testnet try-it-now for x402 integration testing
- Real before/after examples (agent output with vs without UIPE)
- Copy-paste MCP config snippet for Claude Code / Cursor

### Registry Listings at Launch

- GitHub MCP registry
- Smithery
- x402 Bazaar

### Design Direction (separate cycle)

- Impeccable + taste skill for visual design
- Kling 3.0 3D animation assets
- Creative workstream, not specced here

---

## Operations

### Persistence (Unit 5a prerequisite)

Horizontal scaling of the proxy (D9) requires shared state. Two stores:

**Redis (hot path — every request touches it):**

```
session:{session_id} = {
  tier: "scan" | "deep",
  tier_variant: "free" | "paid",
  identity: "gh:{user_id}" | "wallet:{addr}",
  created_at: ISO8601,
  expires_at: ISO8601,
  machine_id: "fly-machine-id",
  tool_calls_used: int,
  vision_calls_used: int,
  status: "active" | "terminated",
  tx_hash: string | null   # paid tier only
}
  TTL: session duration + 60s grace

quota:{YYYY-MM-DD}:gh:{user_id} = { scan: int, deep: int }
  TTL: 48h
  # Date is UTC. Rationale: server-side consistency, no timezone inference from unreliable client
  # IPs. Documented on landing page ("quotas reset at 00:00 UTC"). If user-local resets become
  # a support issue, revisit with explicit timezone opt-in during GitHub OAuth flow.

idempotency:{session_id}:{request_id} = <tool result blob>
  TTL: session lifetime, capped at 1 MB per entry (see Idempotency Cache Bounds)

rate:{identity} = sliding-window counter
  TTL: rate window (1 min / 1 hour)

warm_pool = sorted set of ready machine_ids
```

**Postgres (cold storage — reconciliation, analytics, disputes):**

```
payments (
  tx_hash PRIMARY KEY,
  payer_address TEXT,
  amount_usdc NUMERIC,
  session_id TEXT,
  reserved_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ NULL,
  refunded_at TIMESTAMPTZ NULL,
  refund_tx_hash TEXT NULL
)

sessions_log (
  session_id PRIMARY KEY,
  tier, tier_variant,
  identity_hash TEXT,   -- salted hash, not raw id
  created_at, ended_at,
  end_reason TEXT,
  tool_calls INT,
  vision_calls INT,
  crashed BOOLEAN
)
  INDEX idx_tier_variant_created_at (tier_variant, created_at DESC)
  INDEX idx_identity_created_at (identity_hash, created_at DESC)
  -- First index: analytics queries by free-vs-paid over time windows.
  -- Second: support lookups (all sessions for a given user).

aup_blocks (
  identity_hash PRIMARY KEY,
  blocked_at TIMESTAMPTZ,
  reason TEXT
)
```

Migrations: checked into `packages/proxy/migrations/` and run by CI on staging before production. No migration tool chosen yet — Unit 5a to pick (`node-pg-migrate` is the default suggestion).

### x402 Payment State Machine

Paid session creation is a three-step protocol, not one atomic event:

```
[1] Agent retries create_session with X-402-Payment header
       |
       v
[2] Proxy: verify payment via facilitator (RESERVE — funds committed but not settled)
       |-- verify fails --> return 402 with error, funds never reserved
       v
[3] Proxy: assign machine from warm pool / cold-boot
       |-- machine boot fails --> call facilitator to RELEASE reserve, return 503
       v
[4] Proxy: SETTLE payment via facilitator
       |-- settle fails (rare) --> refund out-of-band, log for reconciliation
       v
[5] Return session_id to agent
```

**Reserve vs settle:** x402 facilitator supports reserving funds (verifying signature, checking balance) separately from settling (moving funds). We reserve at step 2, settle only at step 4 once the machine is confirmed bootable. This eliminates "paid, no session" as a normal failure mode — only catastrophic facilitator issues can cause it, and those are caught by daily reconciliation.

**Rollback window:** reserves expire after 5 minutes if not settled. If any step 2-4 takes longer than that, the reserve auto-releases — the agent's funds are safe. Session creation has a hard 30s timeout, so this is defense in depth, not a real expected code path.

### Per-Tool Degradation Contract

When the vision service is unavailable (down, overloaded, cold GPU boot), each tool degrades explicitly — no silent empty returns.

| Tool | Vision-dependent? | Behavior when vision down |
|---|---|---|
| `create_session` | No | Unaffected |
| `close_session` | No | Unaffected |
| `navigate` | Partial (if `visual: true`) | Returns structural scene graph with `vision_degraded: true`. If caller requested visual=true explicitly, also include a warning field. |
| `get_scene` | Partial | Same as navigate — structural data intact, visual omitted with flag |
| `act` | No (uses structural locators) | Unaffected; post-action scene returns with `vision_degraded: true` if visual requested |
| `detect_elements` | No (DOM-based) | Unaffected |
| `get_affordances` | No | Unaffected |
| `get_screenshot` | No (Playwright only) | Unaffected |
| `get_console_logs` | No | Unaffected |
| `get_network_errors` | No | Unaffected |
| `watch` / `stop_watch` | No | Unaffected |
| `compare_states` | No | Unaffected (structural diff) |
| `analyze_visual` | **Yes — fully vision-dependent** | Returns error `VISION_UNAVAILABLE` with `retryable: true` flag. **Does not count against vision quota.** Agent can retry or use `get_scene` for a structural alternative. |

`analyze_visual` is the only tool that hard-fails when vision is down, because its entire purpose is vision analysis. Every other tool degrades partially or not at all.

### Acceptable Use Policy (AUP)

Agents on MCPaaSTA navigate arbitrary URLs from our infrastructure — we become the user-agent from the target site's perspective. Complaints (scraping, ToS violations, rate-limit abuse of target sites) route to us.

**Required before launch:**
- Published AUP prohibiting: scraping behind auth walls, automated credential stuffing, ToS violations of target sites, content explicitly blocked by `robots.txt` for automation, sustained scraping of any single domain
- Response rate limit per target domain (e.g., max 10 sessions/hour against `*.example.com` from any one payer identity) — protects target sites and us
- Contact address (`abuse@...`) published in User-Agent header and on landing page
- Takedown process: on credible abuse complaint, block the payer identity / GitHub user and cooperate with the reporter

### Budget Alarms

Cost caps exist for external APIs (Messages API daily/monthly) but not for Fly infrastructure itself — GPU runaway, warm pool bugs, or an abuse incident could rack up Fly bills with no circuit breaker.

- **Fly infra budget alarm:** configured daily-spend threshold (launch target: $50/day). Alert paged to on-call.
- **Hard ceiling:** weekly spend cap on Fly account (launch target: $250/week). Above this, on-call manually approves continued spend.
- **Messages API cap:** already specified in Vision Service section (daily/monthly, alerts at 80%).
- **Reconciliation:** daily job compares actual Fly + Messages API spend against projected session volume. Discrepancies flagged.

Budget alarms are easy to skip during discovery and catastrophic to skip during an incident. Ship with Unit 11.

### Secret Management

- Messages API key: stored as Fly secret on vision-service machines only. Never in proxy or session container environments.
- x402 receiving wallet address: public, no secret needed server-side.
- GitHub OAuth client secret: Fly secret on proxy only.
- Facilitator credentials (if any): Fly secret on proxy only.
- Rotation: quarterly cadence for API keys, immediate on suspected compromise. Documented runbook in `deploy/secrets.md`.
- Least-privilege: session containers have no API keys beyond the vision service URL (which is itself firewalled to accept only from session containers).

### Disaster Recovery

Launch posture is **single-region, best-effort.** A Fly region outage terminates all in-flight sessions.

- **Paid sessions affected by outage:** auto-credit to payer wallet via separate `/refund` endpoint after incident triage. Manual process at launch; automate if outages recur.
- **Free sessions:** quota restored for affected users.
- **Multi-region:** deferred. Cost and complexity not justified until revenue supports an SRE headcount. Tracked as post-launch work.
- **State recovery:** session state is explicitly ephemeral — DR plan for session data is "don't have any." Persistent data (payer records, quota counters, aggregated metrics) is in Redis/Postgres with point-in-time backup.

### Billing Reconciliation

x402 settles on-chain (USDC on Base). Internal session records must reconcile with chain state for accounting and dispute handling.

- Proxy logs every payment verification with: `tx_hash`, `payer_address`, `amount`, `session_id`, `timestamp`
- Daily reconciliation job queries the Base chain for all transfers to the receiving wallet and cross-checks against session records
- Discrepancies (payment on-chain but no session, or session with missing payment record) flagged for manual review
- Refunds go out-of-band via separate signed transaction; logged with reference to the original `tx_hash`

### Crash Monitoring & Auto-Credit

Per-tier crash-rate SLOs (not SLAs — no contractual guarantee):

| Event | Threshold | Action |
|---|---|---|
| Container crash mid-session | >1% of paid sessions in 24h | Page on-call, root-cause before continuing sales |
| Vision service unavailable | >5% of sessions see degradation | Page on-call |
| Paid session crashed | Any single occurrence | Auto-credit payer via scheduled refund (manual process at launch, automated when crash events exceed 10/day) |

### MCP Protocol Version

Pinned to MCP spec version **2025-06-18** at launch. Proxy advertises this version during MCP handshake and rejects connections from clients demanding a newer version until we've validated compatibility. Upgrade cadence: evaluate each new MCP spec release, upgrade within 30 days if non-breaking.

### Tool Inventory Note

The 12 UIPE tools from the local server are exposed. `create_session` and `close_session` are **MCPaaSTA-specific additions** not present in the local server — they manage the cloud session lifecycle that doesn't exist locally. Total tool count on MCPaaSTA: **14** (12 UIPE + 2 session management).

### Test Count Reconciliation

MEMORY.md records 191 tests; earlier drafts said 201. Current ground truth is `pnpm exec vitest run` on master. **First action of Unit 1: capture current test count, record it in the Unit 1 PR description, and use that as the regression threshold.** No spec-level test count claim — the repo is the source of truth.

### Idempotency Cache Bounds

The `idempotency:{session_id}:{request_id}` Redis entry caches tool results to make retries safe (see Tool Call Idempotency). Bounds:

- **Per-entry size cap: 1 MB.** If a tool result exceeds 1 MB (large scene graphs on complex SPAs), store only the first 1 MB + `truncated: true`. Retrying a truncated-cached request re-runs the call (correctness over cache hit).
- **Per-session total cap: 25 MB** (Deep sessions, 25 tool calls × 1 MB ceiling). Enforced by Redis key eviction policy scoped to the session's idempotency keys.
- **TTL: session lifetime + 60s grace.** Keys vanish with the session — no long-lived memory pressure.
- **OOM handling:** if Redis rejects the SET due to memory pressure (cluster-wide, not per-session), the tool call still executes but is not cached — agent gets result, retry safety degraded with a `idempotency_degraded: true` flag.

### Vision Service Egress Allowlist

The earlier claim "no outbound beyond Messages API" was too tight. Vision service egress allowlist:

- **Messages API** (`api.anthropic.com`) — deep-tier inference
- **Model weight mirror** (pinned to Hugging Face or internal S3 mirror at deploy time, not runtime) — first-boot download only, then cached
- **Fly internal** (`fly.io` telemetry + deploy) — platform-managed
- **OpenTelemetry collector** (internal address) — observability

No other egress. Deny-by-default at the network layer. Model weight downloads happen during image build, not at runtime, so production containers have the allowlist minus the HF mirror.

### Data Subject Rights (GDPR / CCPA)

GitHub OAuth `user_id` + logged domain visits qualify as personal data in the EU and California.

- **Right to access:** on request, export all sessions_log rows for a given identity_hash. Manual process at launch (email `privacy@...`), documented runbook.
- **Right to erasure:** on request, purge all sessions_log rows and payment records (beyond statutory retention for accounting — 7 years). Identity hash mapping table purged, severing linkage.
- **Identity hashing:** `sessions_log.identity_hash = HMAC(server_secret, "gh:{user_id}")`. Raw `user_id` appears only in Redis (ephemeral, auto-expiring) and payments (required for reconciliation).
- **Data retention:**
  - Redis: session + quota data, auto-expiring (≤48h)
  - `sessions_log`: 90 days rolling, then aggregated and purged
  - `payments`: 7 years (accounting/tax requirement)
  - Screenshots, scene graphs, page content: **never persisted**
- **Cookie/tracking disclosure:** landing page only, no tracking cookies on the MCP endpoint.

Privacy policy published before public launch. Pre-launch (testnet + early access), inform users explicitly that data handling is under development.

### Feature Flags & Kill Switch

A config-driven toggle surface on the proxy, backed by Redis for instant propagation across replicas. No deploy required to change:

| Flag | Effect |
|---|---|
| `paid_tier_enabled` | When false, proxy returns 503 for paid `create_session`. Free tier unaffected. |
| `free_tier_enabled` | Disable free tier (emergency abuse response). |
| `tool:{name}_enabled` | Disable a specific tool across all sessions. Returns `TOOL_DISABLED` error. |
| `domain_blocklist` | Set of domains to reject in URL validation. |
| `identity_blocklist` | Set of GitHub user_ids / payer addresses to reject at auth. |
| `global_circuit_breaker` | When tripped, reject new sessions at the proxy. Useful for incident response. |
| `max_concurrent_sessions_global` | Override the capacity limit without redeploy. |

Flags are read from Redis on each request (cheap — Redis latency <1ms). Admin writes via authenticated internal endpoint, logged to an audit table in Postgres. **Must ship with Unit 5a** — without a kill switch, production incidents require a full deploy to mitigate.

**Redis failure mode for flags:** the proxy caches last-known-good flag values in memory with a 60s refresh. If Redis reads fail, the proxy uses the cached values rather than defaulting. If the cache is empty (cold proxy boot with Redis down), the proxy fails closed: reject all session creation with `503 STATE_UNAVAILABLE`, keep existing sessions alive (their state is in Redis too, so they'll degrade but not crash). Fail-closed on cold boot is deliberate — during an infrastructure incident, we'd rather reject new load than admit traffic we can't track.

### Third-Party Dependencies & SPOFs

| Dependency | Failure impact | Mitigation |
|---|---|---|
| **Coinbase hosted facilitator** (`api.cdp.coinbase.com`) | All paid `create_session` fails. Free tier unaffected. | Document as known SPOF. Target SLO-awareness: monitor facilitator status page; surface degradation in landing page status widget. No hot-swap — running our own facilitator is a multi-week project, deferred past launch. |
| **Messages API** (Anthropic) | Deep-tier `analyze_visual` escalations fail. Standard Qwen2.5-VL path still works. | Graceful downgrade: Deep sessions that would escalate fall back to standard tier with a `deep_tier_unavailable: true` flag. Auto-credit if this happens on >50% of Deep analyze_visual calls in a session. |
| **GitHub OAuth** | Free tier `create_session` fails. Paid tier unaffected. | Document SPOF. 5-minute token cache in Redis so transient GitHub outages don't kill active sessions. |
| **Fly Machines API** | Cannot boot new session containers. Warm pool drains. | Falls back to rejecting new sessions with `CAPACITY_UNAVAILABLE`. Existing sessions continue to work. |
| **Base chain RPC** (for reconciliation) | Daily reconciliation delayed. Paid flow continues via facilitator. | Reconciliation is async — chain outages don't affect the hot path. |

**No SLA posture at launch** (Non-Goals), but documenting these SPOFs explicitly makes it clear which outages we cannot hedge against without significant additional infrastructure.

### Abuse Velocity Alarm

Reactive AUP enforcement (takedown on complaint) is insufficient — by the time a complaint arrives, damage is done to the target site and our IP reputation.

Proactive velocity alarms (in proxy, fired to on-call):

| Signal | Threshold | Action |
|---|---|---|
| Sessions against any single domain, per hour | >50 from any identity | Auto-throttle further sessions to that domain from that identity (429 with retry-after) |
| Sessions against any single domain, platform-wide, per hour | >500 | Page on-call, consider domain-level circuit breaker |
| New GitHub accounts (<7 days old) creating sessions | >10/hour | Page on-call — likely farming attempt |
| Free tier sessions per IP (not identity) | >100/day | Page on-call — likely multi-account abuse |

Thresholds are launch guesses; tune from observability data. Point is to detect abuse in hours, not days.

---

## Work Decomposition

Each unit has clean boundaries, clear inputs/outputs, and can be verified in isolation.

T-shirt effort sizes: **S** = 1-2 days, **M** = 3-5 days, **L** = 1-2 weeks, **XL** = 2-4 weeks. Estimates assume one sub-agent per unit, focused work.

### Demand Validation (parallel with Units 0-2, gates Unit 5a+)

6-10 weeks of building is expensive if no one is waiting for it. Run demand validation concurrent with the first few units so it's cheap if the answer is "yes" and cancels the project early if "no":

| # | Unit | Size | Deliverable | Signal |
|---|---|---|---|---|
| DV1 | Waitlist landing page | S | Static page explaining MCPaaSTA in one paragraph, email capture, "MCPaaSTA for agents" framing | Signups over 1 week |
| DV2 | Design-partner conversations | S (concurrent) | 3-5 conversations with agent builders (Claude Code users, Cursor users, autonomous agent teams) | Qualitative — "would you use this?" with specificity |
| DV3 | Crappy prototype (optional) | M | One-tool demo (e.g., `analyze_visual` only) hosted on Replit or Fly | Completion rate, repeat usage |

**Gate:** if by end of week 2 (when Unit 3 finishes) waitlist + conversations show no real demand, **pause implementation** and reassess scope. Possible pivots: narrower tool surface, local-server improvements instead of hosted service, or specific vertical focus. Cheap to pause now, expensive at Unit 11.

This is not a go/no-go on every signal — it's a "catch the catastrophic miss early" mechanism. The design stands on its own technical merit; validation just confirms a market exists before we ship the full surface.

| # | Unit | Size | Depends on | Deliverable | Verification |
|---|---|---|---|---|---|
| 0 | Vision model benchmark | M | Nothing | Benchmark Qwen2.5-VL-7B, InternVL2.5-8B, Florence-2 on real UIPE screenshots. Verify Fly A10G availability + pricing in target region. **If chosen model differs from Qwen2.5-VL, also produce: (a) revised Cost Floor tables, (b) revised Latency Budget, (c) revised D8 text, (d) list of spec sections referencing the old model to update.** | Written comparison with latency, cost, quality scores. Decision + blast-radius update committed before Unit 4b. |
| 1 | Monorepo restructure | M | Nothing | Existing code in `packages/core` + `packages/local-server`, all existing tests passing (baseline captured before starting) | `tsc --noEmit` + `vitest run` equals pre-restructure count |
| 2 | Core package interface | S | Unit 1 | Clean exports from `core` — pipelines, browser, tool schemas, serializer | Import from `local-server`, confirm existing behavior |
| 3 | Session runner | M | Unit 2 | HTTP service accepting forwarded tool calls, uses `core`, Dockerfile | Curl tool calls locally, get scene graphs back |
| 4a | Vision service | M | Unit 0 | HTTP service: image in -> result out, Dockerfile | Curl an image, get structured analysis back |
| 4b | Vision pipeline adaptation | M | Unit 2, Unit 0 | `core` adapter converts chosen-model output to UIPE's expected element-detection + scene-description format. Replaces OmniParser+llava fusion layer. | Unit tests against captured model responses. Scene graph shape unchanged for downstream consumers. |
| 5a | Session state + persistence | L | Nothing | Session lifecycle backed by Redis schema. Provision Postgres on Fly (managed or self-run) and run migrations for `payments` / `sessions_log` / `aup_blocks`. Idempotency cache with bounds. Feature-flag / kill-switch surface. **Minimum-viable observability: structured JSON logs to stdout (compatible with Fly log drains) and a single error-rate dashboard.** Full observability (traces, behavioral analytics) still lands in Unit 9. | Unit tests against Redis + Postgres testcontainers. Smoke test of kill-switch toggles. Error-rate dashboard visible in Grafana. |
| 5b | Fly Machines orchestration | M | Unit 5a | Create/destroy Fly machines, warm pool management (with sizing algorithm), health checks, cleanup | Integration test against Fly staging project |
| 6 | x402 payment | M | Unit 5a | `@x402/mcp` middleware, 402 responses, reserve/settle state machine (see Operations), rollback on machine-boot failure | Test against x402 testnet facilitator, including simulated boot-failure rollback |
| 7 | Security hardening | M | Unit 5a | URL validation (app + network level), rate limiting, resource caps, vision quotas, DNS rebinding protection, velocity alarms | Unit tests for blocklist, integration tests for rate limits, network egress validation |
| 8 | MCP transport | M | Units 5b, 6 | SSE/streamable HTTP endpoint, full proxy, connection draining for graceful deploys, reconnect auth verification | Connect with real MCP client through full flow; simulate drop + reconnect with same + different identity |
| DC | Docker Compose integration | S | Units 3, 4a, 8 | All three services wired together locally | End-to-end: create session -> navigate -> get_scene -> close |
| 9 | Observability | M | Units 3, 4a, 8 | Structured logging (with redaction policy), OTel traces, Grafana dashboards, behavioral analytics pipeline | Verify traces span proxy -> session -> vision |
| 10 | Testnet mode | S | Unit 6 | Parallel endpoint, x402 testnet facilitator | Agent with testnet wallet completes full session |
| 11 | Fly.io deployment | M | Units 3, 4a, 8 | All three services on Fly, Postgres provisioned, proxy publicly reachable, warm pool running | Agent connects to live endpoint, completes session |
| 11b | Minimum viable landing | S | Unit 11 | Static page at the service domain: one-paragraph explanation, GitHub OAuth device-flow explainer, testnet quick-start, copy-paste MCP config snippets for Claude Code / Cursor, status widget (Coinbase facilitator, vision service), pre-warm trigger on "Get Started" click. **Not the full designed landing (Unit 13)** — just enough that GitHub OAuth has somewhere to land and new users can self-serve. | Page loads, OAuth device flow completes, MCP snippet works when pasted into a client. |
| LT | Load & soak test | M | Unit 11 | Scripted load test: sustained session creation, SSE churn, warm pool stress, Redis OOM scenario, Postgres under write load. **Soak 72h** (SSE + browser processes are classic slow-leak territory; 24h too short). | Throughput + error-rate targets met; no memory leaks over 72h; warm pool sizing algorithm validated under burst; session container memory profile flat. |
| ST | Smoke test | S | Unit 11 | Scripted e2e: free tier signup -> create session -> navigate -> get_scene -> act -> close. Also: testnet x402 payment flow. | Pass/fail automated test |
| 12 | Registry listings | S | Units 11, 11b, LT | GitHub MCP registry, Smithery, x402 Bazaar | Verify discoverability. **Do not list until LT passes and 11b is live** — listing drives traffic to a destination that must exist. |
| 13 | Designed landing page | Separate | 11b (supersedes) | Full creative landing (Impeccable + Kling assets, animations, rich examples). Replaces 11b at the same URL. | Separate design review |

**Total estimate:** ~6-10 weeks with 2-3 parallel sub-agents, ~3-5 weeks with 4-5 parallel agents (units 0, 1-2, 5a, 4a are independent starters). Serial critical path is ~4-5 weeks of focused work.

### Contract Tests

**Format:** JSON Schema (Draft 2020-12) files checked into `packages/core/src/contracts/`. One schema per endpoint pair:

- `proxy-to-session.v1.json` — tool call forwarding
- `session-to-vision.v1.json` — `/v1/analyze` request/response
- `proxy-public.v1.json` — MCP-facing tool schemas

**Runner:** [`ajv`](https://ajv.js.org) for validation, integrated into each package's `vitest` setup. Each service has a test that:
1. Loads the schema from `core`
2. Validates every request it produces against the schema
3. Validates every response it returns against the schema
4. Fails CI if either direction diverges

**Concrete example** (`packages/core/src/contracts/session-to-vision.v1.json` excerpt):

```json
{
  "$id": "session-to-vision.v1",
  "request": {
    "type": "object",
    "required": ["image", "tier", "request_id"],
    "properties": {
      "image": {"type": "string", "contentEncoding": "base64"},
      "tier": {"enum": ["standard", "deep"]},
      "prompt": {"type": "string"},
      "request_id": {"type": "string", "format": "uuid"}
    }
  },
  "response": {
    "oneOf": [
      {"$ref": "#/defs/success"},
      {"$ref": "#/defs/degraded"}
    ]
  }
}
```

**Why explicit format matters:** Sub-agents build each service in isolation. Without a shared wire format, Service A's idea of the request can drift from Service B's expectation. "Use a schema" is not enough — pick the schema language, pick the validator, check it into `core`, make it a CI gate. Otherwise drift happens at integration time.

### Parallelization

- Unit 0 runs first and gates Units 4a/4b
- Units 1-2 and Unit 0 run in parallel (no dependencies)
- Units 3 and 4a run in parallel after their prerequisites
- Unit 4b runs in parallel with 3 after Units 2 and 0 complete
- Units 5a, 6, and 7 can all start in parallel (all independent)
- Unit 13 is fully independent

### Critical Path

0 -> (1 -> 2 -> 3) || (4a -> 4b) -> 5a -> 5b -> Docker Compose integration -> 8 -> 11 -> Smoke test -> 12

---

## Confidence Assessment

| Unit | Confidence | Key risk |
|---|---|---|
| 1-2 (monorepo) | Medium-High | Import paths, tsconfig references, and build order change during restructure. Existing test suite (baseline captured in Unit 1 PR) provides safety net but test paths may need updates. Not zero-risk. |
| 3 (session runner) | High | Docker Compose catches Fly discrepancies |
| 0 (vision benchmark) | High | Measurable decision, no code dependencies. Must complete before 4a/4b. |
| 4a (vision service) | High | Stateless, easy to test. Unit 0 resolves model and GPU region choice. |
| 4b (pipeline adaptation) | Medium | Qwen2.5-VL output format differs from OmniParser/llava. Prompt engineering + parser work. Contract-tested against core's existing consumers. |
| 5a (session state) | High | Pure logic, unit testable |
| 5b (Fly orchestration) | Medium-High | Cloud API quirks, warm pool management edge cases |
| 6 (x402 payment) | Medium-High | x402 protocol edge cases — early ecosystem |
| 7 (security) | High | Pure unit tests for app layer. Network-level egress rules depend on Fly config. |
| 8 (MCP transport) | Medium-High | Long-lived SSE connection edge cases. Connection draining during deploys. |
| 9 (observability) | Medium | Data pipeline works or doesn't. Dashboard usefulness is subjective. |
| 10 (testnet) | High | Runs after Docker Compose is proven |
| DC (Docker Compose) | High | Catches most integration bugs |
| 11 (Fly deployment) | Medium-High | Fly-specific behavior (machine startup, GPU allocation, networking) |
| ST (smoke test) | High | Scripted, deterministic |
| 12 (registry) | High | Manual process |

**Overall: 80-85%.** Remaining risk is in Fly Machines API behavior, x402 protocol maturity, and SSE/MCP edge cases at scale. These are "discover during integration and fix" problems, not design problems.

---

## Open Questions

1. **Vision model + GPU region**: Moved to Unit 0. Resolve before Unit 4a/4b start.
2. ~~**Free tier identity**~~ **Resolved:** GitHub OAuth + 30-day minimum account age as launch requirement. Revisit if the bar is too high (blocking legit users) or too low (abuse still appears).
3. **Paid-tier abuse kill switch**: x402 has no built-in revocation. A wallet can keep paying $0.03/session to scrape at scale, and we can't block it without blocking all payments from that address. Acceptable at launch (rate-limit by wallet, global capacity limits, per-target-domain rate limits in AUP). Revisit if abuse materializes — options include per-wallet spend caps or maintaining a blocklist at the proxy.
4. **Domain-level privacy**: Should behavioral analytics track domains (shopify.com) or categories (e-commerce)? Start with domains, add category mapping if privacy concern materializes.
5. **Session log redaction** (**Unit 9 blocker**): Tool call parameters (URLs, selectors, act targets) flow through structured logs. Define redaction policy before Unit 9 — at minimum strip query strings and hash paths. Resolve as first task of Unit 9, or block Unit 9 start.
6. **x402 price negotiation**: The x402 spec permits per-request price negotiation between client and server. MCPaaSTA uses fixed tier prices at launch (simpler, easier to communicate). Worth revisiting if agents need custom tier configurations (e.g., "I want 10 tool calls, not 5 or 25").
7. **Fly egress firewall capability**: Verify Fly Machines support deny-by-CIDR egress rules before Unit 7 starts (DNS rebinding mitigation).
