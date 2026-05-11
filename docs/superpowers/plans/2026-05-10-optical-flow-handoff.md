# Optical Flow Implementation — Mid-Plan Handoff

**Date:** 2026-05-10
**Branch:** `feat/optical-flow`
**Plan:** [`2026-05-10-optical-flow.md`](2026-05-10-optical-flow.md)
**Spec:** [`../specs/2026-05-10-optical-flow-design.md`](../specs/2026-05-10-optical-flow-design.md)

## Status

**10 of 19 tasks complete.** The entire Rust sidecar (`crates/uipe-vision/`) is functionally finished: builds clean, 19 unit tests pass, the binary spawns, reads length-prefixed PNGs, runs optical flow inference (when a model is present), clusters into regions, computes kinematic primitives, classifies into 4 motion patterns, and emits ndjson events on stdout.

What remains is the **TypeScript integration layer** (Tasks 11–16), the **end-to-end integration test** (Task 17), the **evaluation script** (Task 18), and **documentation updates** (Task 19), plus one **known follow-up** outside the original plan: cross-frame `region_id` stability.

## Completed work — commits on `feat/optical-flow`

| Task | Commit | Summary |
|---|---|---|
| 1 | `93e70e4` | Scaffold uipe-vision Rust workspace crate |
| 1 fix | `96b000a` | Add trailing newline to .gitignore (review feedback) |
| 2 | `9606c82` | ONNX model download script (URL placeholder) |
| 3 | `6b789b8` | Add ort dependency + load_model function |
| 3 fix | `c63f135` | Durable toolchain (stable channel) + ort pin comment |
| 4 | `c0d8979` | PNG decode + tensor preprocessing |
| 5 | `5e9cf5c` | Run RAFT inference on frame pair, return FlowField |
| 5 perf | `61ecbc7` | Bulk-copy flow tensor instead of interleaved 4D indexing |
| 6 | `653c64c` | DBSCAN clustering of flow vectors into regions |
| 6 lint | `b10ca91` | Drop unused Axis import from clustering.rs |
| 7 | `33899f9` | Kinematic primitives (mean velocity, divergence, curl, variance) |
| 8 | `d430d91` | Pattern classifier + tracker for start/end emission |
| 8 lint | `0587fc5` | Drop unused TRANSLATION_RATIO_OVER_NOISE constant |
| 9 | `fe6560b` | stdin length-prefix protocol + stdout ndjson event types |
| 10 | `67da575` | Wire main loop — read frames, run flow, emit events |
| 10 todo | `4ee49b4` | TODO note on region_id instability across frames |

Plus the spec (`f8a8c1e`) and plan (`1f42c7d`) on `master`.

## What works right now

- `cargo build --release --bin uipe-vision` → produces `target/release/uipe-vision`
- `cargo test -p uipe-vision` → 19 tests pass, 1 ignored (model-gated)
- Binary reads length-prefixed PNGs on stdin and emits ndjson events on stdout
- All 6 Rust modules in place: `inference`, `image_io`, `clustering`, `primitives`, `classifier`, `protocol`
- Protocol event shape matches the spec: `optical-flow-raw` / `optical-flow-region` / `optical-flow-motion` (hyphen-separated to match existing codebase convention)

## What's NOT working

1. **ONNX model file is missing.** Task 2's download script ships with placeholder URL (`REPLACE_WITH_VERIFIED_URL`) and SHA (`REPLACE_WITH_VERIFIED_SHA`). Before any real inference works, the implementer must:
   - Pick a RAFT-small INT8 ONNX export (e.g., PINTO model zoo's `raft_small` or self-export from https://github.com/princeton-vl/RAFT)
   - Fill `scripts/download-flow-model.ts` with the real URL + SHA256
   - Run `pnpm run setup:flow-model`
   - The model lands at `crates/uipe-vision/models/raft-small-int8.onnx` (gitignored)

2. **Known correctness defect — region_id stability.** Documented inline at `crates/uipe-vision/src/main.rs:100`. DBSCAN cluster IDs reset per `cluster_flow` call, and the centroid-rounded suffix in the region_id format string drifts with sub-pixel motion. As a result, `PatternTracker` fires `Phenomenon::Start` and `Phenomenon::End` every frame for moving regions instead of recognizing persistence. Motion events will be noisy until this is fixed — needs an inter-frame IoU-based region-matching module. Filed as the follow-up task in `TodoWrite`.

3. **Tests can't yet verify real inference behavior.** The `#[ignore]`-d test `inference_returns_flow_field_with_expected_shape` (and the integration smoke test in `crates/uipe-vision/tests/integration_smoke.rs`) need the ONNX model to actually run.

## Remaining tasks (11–19)

All TypeScript work + integration + docs. From the plan:

- **Task 11** — extend `src/pipelines/temporal/collectors/types.ts` with `optical-flow-raw` / `optical-flow-region` / `optical-flow-motion` event kinds + payload types
- **Task 12** — `FlowProducer` class in `src/pipelines/temporal/producers/optical-flow.ts` — spawn/restart/disable the sidecar binary
- **Task 13** — pHash gating + length-prefixed frame writes (extends Task 12)
- **Task 14** — ndjson parsing → typed event emission (extends Task 12)
- **Task 15** — `FlowCollector` class in `src/pipelines/temporal/collectors/optical-flow.ts` — implement existing `Collector` interface
- **Task 16** — register `FlowProducer` + `FlowCollector` in `src/mcp/server.ts`'s `ensureStreamAttached`
- **Task 17** — end-to-end integration test in `tests/integration/optical-flow-pipeline.test.ts`
- **Task 18** — `bench/optical-flow-eval.ts` evaluation script with synthetic fixtures
- **Task 19** — update `DEVELOPMENT.md` (build instructions) + `docs/architecture.md` (flip "Optical flow" row in the Current implementation table)

## Pre-existing technical baggage (not new from this work)

- Working tree carries pre-existing untracked files (`DEVELOPMENT.md`, `UIPE-MANIFESTO-v3.md`, `docs/architecture.md`, `docs/superpowers/specs/2026-04-14-mcpaasta-design.md`, `landing/.gitignore`) that came along onto this branch. They are NOT optical-flow work and shouldn't be staged by Tasks 11–19. Original status came in as such, leave alone.
- The `MEMORY.md` carry-forward note about uncommitted "act schema fix, llava:7b swap, analyze_visual robustness" — those are unrelated and still uncommitted on master.

## Adjustments made vs. plan as written

These are deviations the implementer (and reviewer) made that future work should know about, not bugs:

1. **`ort = "2.0.0-rc.9"`** instead of the plan's `rc.4` — rc.9 is the last RC with x86_64-apple-darwin prebuilts; rc.10+ dropped Intel Mac. Documented inline in `crates/uipe-vision/Cargo.toml`.
2. **`rust-toolchain.toml` channel = "stable"** — added because `ureq-proto` transitive dep requires edition2024 (Rust ≥ 1.85). The plan's prerequisite of "Rust 1.70+" was wrong. Pinning to stable is the most durable answer.
3. **`ndarray15` aliased dep** — `linfa 0.7` pins to `ndarray 0.15` while `ort` requires `ndarray 0.16`. Cargo can't unify, so `ndarray15 = { package = "ndarray", version = "0.15" }` is aliased and used only inside `clustering.rs`. Doesn't leak into any public type signature.
4. **Plan task 19 references `pnpm run build` updating to include rust build** — that change has NOT been applied yet (it lands in Task 19). Currently `pnpm run build` only runs `tsc`. Build the Rust binary separately with `pnpm run build:rust`.
5. **Git LFS vs. download-on-build** — spec said LFS, plan picked download-on-build for simplicity. No LFS configuration was added. The model file is gitignored and fetched by the (placeholder-URL) download script.

## Recommended next-session prompt

```
Resume optical flow implementation. Working on `feat/optical-flow` branch
at /Users/dirkknibbe/uipe/ui-perception-engine. The Rust sidecar
(crates/uipe-vision/) is complete; remaining work is Tasks 11–19 of
docs/superpowers/plans/2026-05-10-optical-flow.md (TypeScript producer +
collector + server.ts wiring + integration test + eval script + docs).
Read docs/superpowers/plans/2026-05-10-optical-flow-handoff.md for the
full state-of-the-branch summary. Continue with superpowers:subagent-
driven-development for Tasks 11–19. Known follow-up: region_id stability
fix (see TODO at crates/uipe-vision/src/main.rs:100).
```

## Verification commands the next session can run

```bash
cd /Users/dirkknibbe/uipe/ui-perception-engine

# Confirm branch + recent commits
git branch --show-current
git log --oneline master..feat/optical-flow

# Confirm Rust binary builds and tests pass
cargo build --release --bin uipe-vision
cargo test -p uipe-vision

# Confirm TypeScript baseline still passes
pnpm exec tsc --noEmit
pnpm exec vitest run --reporter=verbose
```

If all four green, the branch is in good shape to continue.
