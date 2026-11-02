# Task 12 report: Explorer model, rails, agent loop

Base 201602e -> head e03912b (`feat: explorer agent loop with rails, caps, scroll sweep`).

## Implemented
- `packages/core/src/dataset/explorer/model.ts`: `ExplorerTurn/ExplorerCall/ExplorerModel`, `costUsd` (env prices read per call, defaults 3/15 per Mtok), `EXPLORER_SYSTEM_PROMPT` (spec 5.1 priorities, rails, untrusted-envelope rule), `AnthropicExplorerModel` (tool-use, `tool_choice: any`, one JSON schema per tool via `z.toJSONSchema`; act schema = `actInputSchema.extend({target?, rationale})`; throws when no tool_use block).
- `rails.ts`: `checkRails` per brief; risky-label check over the model's `target`, the `clickSelector` selector, and the explorer-resolved scene label.
- `explorer.ts`: `Explorer.run()`. Start page opened by the explorer (page-load trigger wraps the navigate; bot challenge -> `bot-challenge`). Loop: cap check + `cap-hit` trace -> model.next -> rails (`tool-refused`, still a step) -> act/navigate wrapped in beginTrigger/tools.call/awaitSettle -> site-map observe + transition -> `explorer-step` trace + `recordStep`. New states get a page-load trigger + scroll sweep (0.8 x viewport height, 1000 ms pause, `scroll-step` triggers, back to top). Observations = affordances + compact scene, clipped to 4,000 chars with the untrusted envelope re-closed. Model/tool throws -> `error` trace, `error` stop.

## Tests
- RED: `pnpm exec vitest run tests/unit/dataset/explorer` -> 3 files failed, "Failed to load url ../../../../src/dataset/explorer/model.js ... Does the file exist?" (expected: modules not yet written).
- GREEN: same command -> 20 passed (all 7 brief-named tests plus rails per-rule, mislabelled-click, transition, observation clipping, model error).
- Full unit: 81 files / 640 tests passed. `pnpm -r exec -- tsc --noEmit` clean. Integration not requested by brief; not run.

## Files
- packages/core/src/dataset/explorer/{model,rails,explorer}.ts
- packages/core/tests/unit/dataset/explorer/{model,rails,explorer}.test.ts

## Self-review
- Stderr stack noise in the full run comes from pre-existing intent-loop tests, not these.
- Fixed a tsc error in the test fixture cast (SceneNode via unknown).

## Rulings
- Ruling: `pressKey` is rejected only for Enter keys; Escape/Tab/arrows allowed -- Enter is what submits forms, Escape drives modal-close animations -- cost if wrong: a model could press Space on a focused submit button.
- Ruling: click-label rail checks the model-declared `target`, the selector string, and the label of the smallest scene node under (x,y) (new optional `RailContext.targetLabel`) -- the model sees untrusted content, so its own label claim is not sufficient -- cost if wrong: label resolution uses the last captured graph, so a DOM that changed since could mislabel.
- Ruling: added optional `sleep` dep to Explorer constructor for tests -- avoids fake-timer async loops -- cost: none (optional).
- Ruling: arrival page-load trigger on a model-reached new state is recorded after the action settles; the action trigger already captured the transition itself -- cost if wrong: page-load clip may often be empty/ambient.
- Ruling: scroll sweep capped at 25 steps and stops early if budget exceeded -- infinite-scroll pages -- cost: very long pages lose bottom coverage.
- Ruling: history fed to the model carries only ok/error/state summaries, never tool text -- keeps page content inside the envelope.
- Ruling: start-page bot challenge returns `bot-challenge` without tracing a clip-rejected; Task 13's runner owns that trace.

## Concerns
None blocking.

## Fix report — review round 1

**Finding (IMPORTANT): labelAt read `SceneNode.label`, which fused nodes set to a role/class, not the visible text.**
- `packages/core/src/dataset/explorer/explorer.ts` `labelAt`: now returns `[hit.text, hit.imageAlt, hit.label].filter(Boolean).join(' ')` (undefined when empty), so `checkRails` tests RISKY_LABEL against the visible text.
- `packages/core/tests/unit/dataset/explorer/explorer.test.ts`: the `node()` fixture now takes `Partial<SceneNode>` fields and defaults `label: 'button'` like real fused nodes. The risky-label test is now `it.each` over `text: 'Delete account'` and `imageAlt: 'Buy now'`. Added a test for a coordinate click with `target` omitted. All three failed before the fix (RED) and pass after it.

Covering tests: `tests/unit/dataset/explorer/explorer.test.ts`, `tests/unit/dataset/explorer/rails.test.ts` (the whole `tests/unit/dataset/explorer/` dir).

Commands (from ui-perception-engine/):
- `pnpm -F @uipe/core exec vitest run tests/unit/dataset/explorer/ --reporter=verbose` → Test Files 3 passed (3), Tests 22 passed (22)
- `pnpm -F @uipe/core exec vitest run --reporter=verbose` → Test Files 81 passed (81), Tests 642 passed (642)
- `pnpm -r exec -- tsc --noEmit` → exit 0, no errors
