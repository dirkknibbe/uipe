# Checkpoint: Track 2 shipped (PR #26) → next: NVIDIA Cosmos 3 exploration — 2026-06-11

> Supersedes `docs/plans/2026-06-09-security-remediation-track2-checkpoint.md`. Same security effort now complete through PR; next session pivots to a new exploration.

## What we did

- **Finished Track 2 (untrusted-content trust boundary — the flagship security track), all TDD:**
  - `702c597` **Task 2.2** — `<untrusted_page_content>` envelope on the 6 page-derived MCP tool outputs via `wrapUntrusted` (`packages/core/src/utils/untrusted.ts`). Deviation from plan, by design: defang via **HTML-entity encoding** (not the plan's zero-width-space — invisible chars are fragile and still read as a tag to an LLM). `get_scene` wraps BOTH compact and json paths (json-only would be a trivial bypass). UIPE's own framing (`Action executed:`, `[Transition: …]`) stays OUTSIDE the envelope.
  - `ea0a4d8` **Task 2.3** — `deriveName()` caps `aria-label`/`title`/`alt` at 200 chars; `MAX_NODES=5000` slice in `extractDOMStructure` (warns on overflow rather than injecting a marker node — a synthetic node would flow through fusion/component-index with side effects).
  - `2fdb08c` **Task 2.4** — vision-svc parser: label allowlist (unknown → `other`), 256-element cap, 512-char text/description caps, non-bool `is_interactable` → `None`. Hardens BOTH backends (Qwen + Hosted route through the shared parser).
- **Model-neutral rename** (`f944bed`) after Dirk flagged Qwen overfitting: `parse_qwen_output` → `parse_detection_output`, `QwenParseError` → `DetectionParseError`, fixtures `qwen_raw/` → `vlm_raw/`. **Why:** the parser is the shared seam both backends route through; it parses the detection contract defined by `app/prompt.py`, not anything Qwen-specific. **Convention (user-set, in VFS `conventions.md`): name shared code for the contract, not the first model that implemented it.** Model names stay only on genuinely model-specific code (`qwen.py`/`QwenAnalyzer`, `VISION_BACKEND=qwen`, config defaults).
- **Opened [PR #26](https://github.com/dirkknibbe/uipe/pull/26)** (`security/track2-untrusted-boundary` → `master`, 5 commits incl. `1082317` Task 2.1 from last session) via `gh` CLI — **GitHub MCP auth FAILED, needs re-auth**. Body maps commits → findings, lists deferrals.
- Green at PR time: workspace `tsc` clean · unit **540** · integration+e2e **31 passed/1 skipped** · vision-svc pytest **33** (3.11 venv).

## Current state

- **PR #26 OPEN, awaiting Dirk's review.** Branch pushed; working tree clean (only untracked docs/`.review/`). `claude-review` CI red = known false alarm (empty `ANTHROPIC_API_KEY`).
- **Security remediation remaining:** Track 3 (sidecar + vision-svc hardening: `omn-1/2/3/4`, `sec-2`, `vsv-1/2/3/6`), Track 4 (supply-chain/CI), Track 0 loose end (`.mcp.json` → engine `.gitignore`), Phase-4 gate checklist. Track 2 deferrals recorded in the plan as **Task 2.5 candidates**: `detect_elements` + JSON state tools not enveloped; DOM truncation not agent-visible.
- **Roadmap position:** autopilot techniques #1–#4, #7, #8 all shipped; #5 SLAM now eligible; #6 world-model long-term. GPU-deploy Phase 2 CPU work merged; **substrate decision PENDING, Dirk's call, no rush** (research ranked Modal #1 cloud, used RTX 3090 #1 hardware; Fly is dead).
- **GateGuard fact-force hook stays ON** (Dirk's explicit choice this session) — present the fact preamble before Edits/Writes/first Bash; retry after block.

## Key files & context

- `docs/superpowers/plans/2026-06-09-security-remediation.md` — remediation source of truth; Track 2 tasks carry "Implemented" notes + deviations.
- `packages/vision-svc/app/mapping.py` — `parse_detection_output`; `app/prompt.py` defines the detection contract; Analyzer protocol + `VISION_BACKEND=hosted|qwen` switch in `app/main.py` means **adding a vision backend is cheap and contract-shaped** (relevant for Cosmos evaluation).
- Hardware: **Intel Mac — no CUDA, no Apple Silicon.** Any heavy-model experimentation must be hosted-API / remote-GPU; nothing big runs locally.
- Commands: `pnpm -r exec -- tsc --noEmit` · `pnpm -F @uipe/core exec vitest run --reporter=verbose` · `pnpm -F @uipe/core run test:integration` · `cd packages/vision-svc && .venv/bin/python -m pytest -q`.
- cwd gotcha: shell sometimes resets to `/Users/dirkknibbe/uipe` (not a git repo) — `cd ui-perception-engine/` first.

## Next steps (Cosmos 3 exploration)

1. **Resolve what "Cosmos 3" actually is — research fresh, do NOT trust training data.** It post-dates the assistant's knowledge (cutoff Jan 2026). Context that IS known: NVIDIA's Cosmos line (CES 2025+) = **world foundation models for physical AI** — Predict / Transfer / Reason families (video world-state prediction, sim-to-real transfer, physical-reasoning VLM). First task: pin down the exact product (name, family, sizes, license, open weights vs API-only, NVIDIA NIM/build.nvidia.com hosted availability).
2. **Evaluate TWO distinct UIPE fits separately** (don't conflate):
   - **(a) Vision backend** — can it do detection-style UI understanding implementing our Analyzer protocol / detection contract? (The rename + protocol make a 4th backend cheap to add if so.)
   - **(b) World model** — Cosmos WFMs predict future world states; this aligns with sub-project **#6 world-model training** and the predictive-verification (#3) / SLAM (#5) thesis. Strategically the more interesting fit given UIPE's autopilot framing — but check **domain transfer**: Cosmos targets robotics/physical video; does it generalize to UI screenshots / screen recordings?
3. **Inference economics** — VRAM/CUDA requirements interact with the pending substrate decision (a Cosmos-class model may exceed a 24GB 3090 and reshape the 3090-vs-Modal calculus; hosted NIM endpoints would allow zero-GPU evaluation from the Intel Mac).
4. **Process:** research first (deep-research or the multi-workflow research pattern from 2026-06-07; reports → `docs/superpowers/research/`), then `superpowers:brainstorming` on integration fit, then spec if warranted. **No code until the fit is argued.** Capture the decision (+why) to VFS.
5. Housekeeping when convenient: check PR #26 review state first; security Tracks 3/4 still queued and independent of the exploration; GitHub MCP re-auth.

## Resume prompt
```
Read ui-perception-engine/docs/plans/2026-06-11-cosmos3-exploration-kickoff.md
in full. It's a checkpoint from my last session on "UIPE security Track 2
shipped (PR #26); next: explore NVIDIA Cosmos 3 for UIPE". Catch up on what we
did and the current state, then continue from the "Next steps" section —
start by researching what Cosmos 3 actually is (it's newer than your training
data, so research fresh) and assessing the two UIPE fits. Confirm your
understanding of where we left off before doing anything.
```
