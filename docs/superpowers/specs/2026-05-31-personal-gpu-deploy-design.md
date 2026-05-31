# Personal GPU Deploy — UIPE on Fly (scoped sibling of MCPaaSTA)

**Date:** 2026-05-31
**Status:** Design — approved in brainstorm, pending implementation plan
**Parent spec:** [`2026-04-14-mcpaasta-design.md`](2026-04-14-mcpaasta-design.md) — this design **inherits** the parent's infrastructure decisions and **defers** its product layer.

## Overview

Deploy the whole UIPE engine to Fly.io so it runs on a real GPU, for **single-user personal use** (Dirk's own dev backend). The motivation is concrete: unblock the GPU-gated work — high-frequency optical flow with a CUDA execution provider (the predictive-perception tier), the SEA-RAFT swap, and a VLM tier fast enough to be genuinely anomaly-triggered (~3–5s instead of ~120s on the Intel Mac CPU).

This is **not** the MCPaaSTA hosted product. No payments, no free tier, no multi-tenant orchestration, no landing page or registry. It is the MCPaaSTA *infrastructure* executed with spec-level rigor (real monorepo, clean service boundaries, contract tests, proper Fly deploy), simplified to single-tenant.

## Goals

- Run browser + MCP server + vision on Fly; the Mac connects as a remote MCP client.
- Put Qwen2.5-VL-7B and the optical-flow ONNX on an A10 GPU (CUDA EP).
- Collapse the local three-tier vision pipeline (OmniParser + llava + Messages API) to two-tier (Qwen2.5-VL + Messages API).
- Preserve the existing 498-test baseline through a monorepo restructure.
- Structure the work so growing into the full MCPaaSTA product later does not require redoing this.

## Non-Goals

- x402 / payments (parent Unit 6), testnet (Unit 10), registry listing (Unit 12), demand validation (DV), landing page.
- Multi-tenant session orchestration, warm pools beyond 0–1, per-wallet rate limiting.
- Behavioral / billing analytics.

## Inherited decisions (from parent MCPaaSTA spec)

| Ref | Decision | Inherited as-is? |
|---|---|---|
| D2 | Hosting platform = Fly.io | Yes |
| D4 | Transport = remote MCP (SSE / streamable HTTP) | Yes |
| D8 | Vision pipeline = two-tier (Qwen2.5-VL + Messages API) | Yes (Unit-0-lite confirms) |
| D10 | Vision topology = shared, on-demand GPU service | Yes (single shared GPU machine) |
| D14 | GPU scaling = on-demand (auto-stop on idle) | Yes |

## Unit map (relative to parent's Work Decomposition)

**IN (build):**
- **Unit 0 (lite)** — vision benchmark. Qwen2.5-VL vs InternVL2.5 / Florence-2 on a handful of *real UIPE screenshots*, not a formal harness. Gates 4a/4b. Produces the golden-screenshot fixture set (see Testing).
- **Units 1–2** — monorepo restructure into `pnpm` workspaces. The real cost of the spec-faithful approach; establishes clean service boundaries.
- **Unit 3** — session runner (Playwright container).
- **Unit 4a** — vision service: Qwen2.5-VL **+ optical-flow ONNX with CUDA execution provider**.
- **Unit 4b** — pipeline adaptation: TS pipeline consumes Qwen output; remove OmniParser tier.
- **Unit 5a** — session state (TTL, lifecycle). Trivially small at single-tenant.
- **Unit 8** — remote MCP transport (SSE + reconnect, bearer-token re-auth on reconnect).
- **Unit 11 + DC + ST** — Fly deploy, docker-compose plumbing harness, smoke test.

**SIMPLIFIED:**
- **Unit 5b** — Fly orchestration: warm pool of 0–1, no multi-machine scheduling.
- **Unit 7** — keep app-layer URL validation **and** network-layer Fly egress CIDR firewall (SSRF / DNS-rebinding defense — the engine browses arbitrary web, non-negotiable). Drop billing-oriented rate limiting.
- **Unit 9** — light: crash monitoring + basic latency / GPU-boot metrics. No behavioral/billing analytics.
- **Auth** — replace GitHub-OAuth/x402 with a single static **bearer token** held in a Fly secret. Reconnect re-presents the same token.

**OUT (deferred to product):** Unit 6 (x402), Unit 10 (testnet), Unit 12 (registry), DV, landing page.

## Architecture

```
┌─ Mac (MCP client) ──────────┐
│  Claude Code / agent        │
│  presents BEARER_TOKEN      │
└──────────┬──────────────────┘
           │ SSE / streamable HTTP (remote MCP)
           ▼
┌─ Fly CPU Machine: "session-host" ─────────────┐   auto-stop on idle
│  • MCP transport (SSE, reconnect, auth)        │
│  • TS MCP server (12 tools)                     │
│  • Playwright / Chromium                        │
│  • structural pipeline (DOM / a11y / CSS)       │
│  • temporal + perception loops                  │
│  • egress firewall (CIDR deny private ranges)   │
└──────────┬─────────────────────────────────────┘
           │ internal HTTP (Fly private net, versioned /v1)
           ▼
┌─ Fly GPU Machine (A10): "vision-svc" ──────────┐   auto-stop on idle
│  • Qwen2.5-VL-7B (detection + understanding)    │
│  • optical-flow ONNX w/ CUDA EP (RAFT→SEA-RAFT) │
│  • stateless: image / frames in → result out    │
└────────────────────────────────────────────────┘
           │ (Deep tier only)
           ▼  Anthropic Messages API (already per-call)
```

### Monorepo layout (Units 1–2)

`pnpm` workspaces:

```
packages/
  core/         # existing engine: pipelines, MCP tools, types (current src/)
  session-host/ # transport + auth + Fly entrypoint; depends on core
  vision-svc/   # Python (FastAPI): Qwen2.5-VL + optical-flow ONNX; own Dockerfile
  contracts/    # shared types + vision-svc /v1 API contract (contract-tested both sides)
infra/
  fly/          # session-host.toml, vision-svc.toml (GPU), secrets wiring
  docker-compose.yml  # local plumbing harness (DC)
```

The existing `sidecar/omniparser/` collapses into `vision-svc`; OmniParser drops out (Qwen does detection).

### Data flow (one perception call)

Mac → SSE → session-host validates bearer token → Playwright navigates (URL passes SSRF check) → structural pipeline runs locally in-container → on vision need, session-host POSTs the screenshot to `vision-svc /v1/analyze` over Fly's private network → GPU machine cold-boots if idle (~30–60s, returns `vision_warming`) → Qwen result returns → fused scene graph returns over SSE. Optical-flow frames take the same path to `/v1/flow`.

**Where the screenshot→VLM call sits:** it is the *intent tier* — the rarest, most-gated path, fired only when the cheap deterministic + structural + component-index tiers are uncertain (canvas/WebGL/custom-rendered) or on anomaly escalation. Most perception runs with zero VLM calls. The GPU deployment matters because it makes (a) the high-frequency deterministic optical-flow tier real (CUDA EP), and (b) the gated VLM tier fast enough to be a reflex rather than a batch job.

### Cold-start posture

Both machines: `auto_stop_machines = true`, `min_machines_running = 0`. First call of a session eats the boot; session-host stays warm for the session TTL. Single long-lived session → in practice one cold-start per work session. `vision_warming: true` hint on the first vision call after idle; optional session-creation pre-warm POST to `vision-svc`.

## Vision model + SEA-RAFT

- **Standard tier:** Qwen2.5-VL-7B on A10 — detection + understanding in one pass, replacing OmniParser + llava. Unit-0-lite confirms vs InternVL2.5 / Florence-2 on real screenshots before the local pipeline is removed.
- **Deep tier:** Anthropic Messages API (already per-call, no infra).
- **Escape hatch:** if all candidates underwhelm, ship vision-degraded (structural-only); never block the deploy on model selection.
- **Optical flow / SEA-RAFT (two steps, in order):**
  1. Deploy the *existing* RAFT-small INT8 ONNX with the CUDA EP; validate output parity against the current CPU path (the port must not change behavior).
  2. *Then* swap SEA-RAFT as a model-file change + re-validate. Isolated follow-up — the GPU substrate is the unlock; SEA-RAFT is the upgrade on top.
- `torch.load(weights_only=True)` everywhere in `vision-svc` (carries forward the accepted-risk torch mitigation; torch 2.2.2 CVEs are hardware-pinned).

## Security / error handling / degradation

- **SSRF (non-negotiable):** app-layer URL validation (block private IPs, `file://` / `data://`, cloud-metadata endpoints) **plus** network-layer Fly egress CIDR deny — the app layer alone loses the DNS-rebinding TOCTOU. **Prerequisite:** verify Fly Machines support deny-by-CIDR egress before the Unit 7 work begins (parent open question #7); fallback is per-container iptables or a Fly private-network egress proxy.
- **Auth:** single bearer token in a Fly secret; session-host rejects requests without it; reconnect re-presents the same token.
- **Graceful degradation:** GPU cold/down → session-host returns structural-only results with `vision_degraded: true` rather than erroring (matches the engine's existing graceful-degradation principle).
- **GPU cold-boot:** `vision_warming: true` hint on first call after idle.

## Testing posture

Match each signal to the layer that can actually produce it. (Revised from the initial draft, which over-relied on a full local stack that cannot run the real GPU model and cannot replicate Fly networking/egress.)

1. **Contract tests (`packages/contracts/`)** — *the* primary defense for the vision boundary. The `/v1` API schema is pinned and tested from both sides (core's consumer + vision-svc's producer), so a Qwen output-format change cannot silently break the TS pipeline. Highest value given Unit 4b's model-specific parsing.
2. **docker-compose plumbing harness (DC)** — scoped honestly to SSE transport, session lifecycle, structural pipeline, and Playwright, with a **contract-conformant mock** vision-svc. Fast, no GPU, runs in CI. Explicitly labeled "plumbing harness," **not** end-to-end. It does not validate vision quality or Fly behavior.
3. **Ephemeral Fly deploy + smoke test (ST) — the primary integration signal.** `fly deploy` to a throwaway app → run the smoke suite (create session → navigate → `analyze_visual` asserting real Qwen output; assert `vision_degraded` / `vision_warming` flags; assert egress block on a private IP) → tear down. Cold-boot, private networking, and the egress firewall get exercised for real here — they are invisible to docker-compose.
4. **Golden-screenshot vision eval** — a small fixture set of real UIPE screenshots with expected classifications, run against the *real* GPU Qwen (produced by Unit 0, then a recurring check). This is the source of genuine vision feedback; no container topology can substitute.
5. **Baseline preservation** — Unit 1 captures the current 498-test baseline before the restructure; test paths must stay green through the monorepo move.

## Risks / open questions

1. **Fly GPU availability/region** — A10 capacity and region choice are unconfirmed; verify capacity early (parent open question #1, now partly owned here). GPU region resolved in Unit 0.
2. **Fly deny-by-CIDR egress** — must be confirmed before Unit 7 (see Security); fallback paths noted.
3. **Qwen output-format vs OmniParser/llava** — Unit 4b parser/prompt work; contract-tested but expect prompt iteration.
4. **Monorepo restructure blast radius** — import paths, tsconfig references, build order, test paths all shift; the captured baseline is the safety net.
5. **Single-tenant assumptions** — if this later grows toward the product, the bearer-token auth and warm-pool-of-1 are the first things that must generalize; flagged so they are not built in a way that blocks that.
