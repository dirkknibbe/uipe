# Checkpoint: Phase 2 vision-svc kickoff — 2026-06-07

Session covered three things end-to-end: merged Phase 1, cleared all open issues, and produced the Phase 2 spec + plan. Next session kicks off Phase 2 *implementation*.

## What we did

1. **Merged Phase 1 (PR #17)** — the pnpm-monorepo restructure — and did full post-merge cleanup: removed the `phase1-monorepo` worktree, deleted the redundant `feat/personal-gpu-deploy*` branches (local + remote), updated the OUTER `/Users/dirkknibbe/uipe/CLAUDE.md` command lines to workspace forms + added a monorepo-layout section, refreshed auto-memory. *(PR #17 had already been merged via the UI as a merge commit `6db6f37`, not a squash — irrelevant, all 8 commits are on master.)*

2. **Cleared open issues #12–#16, all via TDD, merged to master** (each on its own branch → PR → squash-merge → branch auto-deleted):
   - **PR #18 (`2c4512f`) — #16:** the `uipe-vision` sidecar binary now resolves by walking up from `import.meta.url` to the `pnpm-workspace.yaml` marker, not `process.cwd()`. *Why:* after the monorepo move the engine runs from `packages/core` and a fixed `import.meta.url` offset is wrong because `src/` (tsx) and `dist/` (compiled) depths differ by one. `UIPE_FLOW_BINARY` still wins.
   - **PR #19 (`780c1ee`) — #15:** real-browser tests (`tests/integration` + `tests/e2e`) split into a serial `vitest.integration.config.ts` (`fileParallelism:false`); default `vitest run` is now **unit-only**. *Why:* the flake was pure CPU contention under parallel file execution on the Intel Mac, not a logic bug. New scripts: `test:integration`, `test:all`.
   - **PR #20 (`ed37f2f`) — #12/#13/#14:** perception P3 polish — `screenshotErrors` summary metric + null/throw streak symmetry (#12); `session.stop()` `{cause}` preservation (#13); `err.name`-based nav-error classification with regex fallback (#14). *Why:* observability + "structured signal over message-regex" — the same lesson that shaped the Phase 2 error contract.

3. **Brainstormed + planned Phase 2 (vision-svc, Qwen analyze track).** Spec + plan written and committed on branch `feat/personal-gpu-deploy-phase2` (NOT pushed).

## Current state

- **We are on `master`.** The Phase 2 spec + plan are **merged to master** via PR #21 (squash `2da9816`); the `feat/personal-gpu-deploy-phase2` branch is deleted (local + remote).
- `master` has all merged work: Phase 1 (#17), the five issue fixes (#18/#19/#20), and the Phase 2 docs (#21). **513 unit tests green**, `tsc --noEmit` + `tsc -b` clean, integration 28 passed | 1 skipped via the serial config.
- **No Phase 2 implementation code written yet** — only the spec and plan docs (now in the repo).

## Phase 2 decisions (locked this session)

- **GPU substrate = ephemeral Fly A10** (spin up → bench/eval → tear down). Verifying A10 capacity/region is the gating first task.
- **VLM analyze track only** — optical-flow CUDA-EP port is its own *later* phase.
- **Qwen-first eval** — challenge with InternVL2.5 / Florence-2 only if Qwen misses the acceptance bar.
- **Detection-shaped `/v1/analyze` response** — `VisualUnderstanding` deferred to Phase 3 (additive optional field).
- **Status reported as `status` enum (`ok|warming|degraded`) + discriminated `reason`** (`model_loading|inference_timeout|inference_error|unreachable`), NOT booleans. `oom` deliberately deferred (additive once we confirm `torch.cuda.OutOfMemoryError` catches cleanly on the A10). `message` is opaque/log-only — never branched on. Classification is by control-flow position + exception type, never by parsing error strings.
- **Cross-language contract = shared JSON fixtures** in `packages/contracts/fixtures/v1/`, validated both sides (TS+zod / Pydantic).
- **Wire is snake_case throughout** (`api_version`, `png_base64`) — the Phase-1 seed was camelCase placeholder; Task 2 finalizes it AND updates the seed boundary test.
- **Acceptance bar (starting, tunable):** interactable-element recall ≥ 80% (label match + bbox IoU ≥ 0.5), warm-path p95 latency < 8 s (3–5 s aspiration).

## Key files & context

- `docs/superpowers/specs/2026-06-07-personal-gpu-deploy-phase2-vision-svc-design.md` — the approved Phase 2 spec.
- `docs/superpowers/plans/2026-06-07-personal-gpu-deploy-phase2-vision-svc.md` — the 12-task implementation plan (header says use `superpowers:subagent-driven-development`).
- `docs/superpowers/specs/2026-05-31-personal-gpu-deploy-design.md` — the parent program spec (inherited decisions).
- `packages/contracts/src/index.ts` — current `/v1` seed (only `VisionAnalyzeRequest`); Task 2 fleshes out response/status/reason.
- **Gotcha:** a fresh checkout needs `pnpm install` at the engine root to link `@uipe/contracts` (symlink under `packages/core/node_modules/@uipe/`), or `tsc --noEmit` can't resolve it. `vision-svc` will be Python under `packages/` with no `package.json` (pnpm skips it).
- **Plan split:** Tasks 2–10 are CPU-only TDD (subagent-friendly: contracts schema/fixtures, vision-svc scaffold/schema/mapping/handler, bench scoring). **Tasks 1, 11–12 are GPU/ops** (Fly A10 capacity gate, ephemeral deploy + Unit-0-lite bench + golden eval) — these boot a real A10 and **cost money**; Dirk drives them, not a subagent.
- Pre-existing clutter noticed but left untouched: outer worktrees `worktrees/phase-2-visual`, `worktrees/phase-3-structural`; stale branches `feat/component-index`, `feat/predictive-verification`, `hero/ascii-spike`.
- `RESUME-2026-05-31.md` footer said "delete once PR #17 merged AND Phase 2 begun" — both now true, so it's safe to delete.

## Next steps

1. **Decide before kicking off:** execution mode (subagent-driven recommended). The spec + plan are already in `master` (PR #21), so no push/PR step remains for the docs.
2. **Implement Tasks 2–10** (CPU-TDD) via `superpowers:subagent-driven-development` — fresh subagent per task, review between. Order in the plan; each ends with its own commit. Run TS tests with `pnpm -F @uipe/contracts exec vitest run`, Python with `cd packages/vision-svc && python -m pytest`.
3. **Then Dirk drives the GPU/ops tasks** (1, 11, 12): A10 capacity gate → ephemeral deploy → `run_bench.py` → record `SCORECARD.md` → `fly apps destroy`.
4. Optional housekeeping: delete the stale `RESUME-2026-05-31.md`; revisit the stale worktrees/branches.

## Resume prompt
```
Read /Users/dirkknibbe/uipe/ui-perception-engine/docs/plans/2026-06-07-phase2-vision-svc-kickoff.md
in full. It's a checkpoint from my last session on "Phase 2 vision-svc kickoff".
Catch up on what we did and the current state, then continue from the "Next steps"
section. Start by confirming your understanding of where we left off — we're on
`master`, the Phase 2 spec+plan are merged (PR #21) but there's no implementation
code yet — before making changes. Don't auto-start the GPU/ops tasks (they cost
money); confirm execution mode with me first.
```
