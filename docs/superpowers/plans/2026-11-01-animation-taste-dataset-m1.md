# Animation-Taste Dataset: Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command crawls a site with an AI explorer and produces deduplicated, junk-filtered animation clips with measurements, a site map, a full trace and a run report, all browsable locally.

**Architecture:**
- New module `packages/core/src/dataset/`, inside `@uipe/core`. That way it can reuse the engine without adding package exports.
- The explorer drives UIPE through the real MCP tool layer in-process, over an in-memory transport, so the Track 2 untrusted-content envelope applies.
- A recorder shares the same page. It runs its own CDP session for screencast, tracing and emulation, and gets typed scene graphs from an `Engine` handle exported alongside the server.
- Every component writes to one append-only trace. The run report is computed from that trace.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` imports), Playwright 1.58 + raw CDP, `@modelcontextprotocol/sdk` 1.27 (`InMemoryTransport`, `Client`), `@anthropic-ai/sdk`, `sharp`, `zod`, vitest 2. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-11-01-animation-taste-dataset-design.md`](../specs/2026-11-01-animation-taste-dataset-design.md). Read it before starting any task.

## Global Constraints

- Imports use `.js` extensions. Shared types may only gain optional fields; never remove or change required ones.
- External services are mocked in unit tests: the Anthropic API, and any network outside the fixture server.
- Integration tests serve pages over `startFixtureServer` (`tests/e2e/fixture-server.ts`). Never use `file://`, because url-guard blocks it.
- Viewport 1280x720. Any frame meant for a vision model is lossless PNG.
- Budget per milestone-1 site stays in single-digit dollars. Defaults: `maxSteps 60`, `maxUsd 2.00`, `maxWallMs 1_200_000`.
- The crawler refuses to run without a contact URL. User agent: `UIPE-research-crawler/0.1 (+<contactUrl>)`.
- robots.txt is honored. A 5xx on robots.txt means the site is disallowed. The crawler stays logged out, never submits forms, and never evades bot protection.
- The dataset stays private. Data lives under `~/.uipe/dataset`, overridable with `UIPE_DATASET_DIR`, and is never committed.
- Milestone-1 pass thresholds (spec §4): junk among kept clips ≤ 20% (hand-check of 40 kept clips), duplicates among kept clips ≤ 10%, at least 15 unique episodes per site.
- Tests: `pnpm -F @uipe/core exec vitest run --reporter=verbose` for unit and `pnpm -F @uipe/core test:integration` for integration. Type-check: `pnpm -r exec -- tsc --noEmit` from `ui-perception-engine/`.
- Commit messages: `<type>: <description>`. No Claude co-author trailer (owner's CLAUDE.md overrides).

## Review Focus

1. **A page that never stops animating** (marquees, ambient loops everywhere). Episodes must still close, at the max-episode cap, and each loop is kept once. *Owner: Task 6, test `closes_episode_at_max_duration_on_endless_motion`.*
2. **Navigation in the middle of an episode.** `TemporalEventStream` clears its buffer on navigate. The episode must close with reason `navigated` and keep the events it had. *Owner: Task 6, test `navigation_mid_episode_closes_with_reason_navigated`.*
3. **A bot challenge on the very first page.** It gets one junk record with reason `bot-challenge`, the explorer stops the site, and there are no retries. *Owner: Task 13, test `stops_site_on_bot_challenge_without_retry`.*
4. **The model asks for something outside the rails** (an off-origin URL, a form submit, an unknown tool, malformed arguments). The call is refused, the refusal is traced, and it still counts as a step. *Owner: Task 12, test `refuses_off_rail_tool_calls_and_counts_step`.*
5. **A run killed partway through** (Ctrl-C, crash). The trace and everything already written stay readable, and the report can be regenerated from the trace alone. *Owner: Task 14, test `report_regenerates_from_partial_trace`.*

---

## File Structure

```
packages/core/src/
  mcp/server.ts                      MODIFY: extract Engine; add createServerWithEngine
  mcp/engine.ts                      CREATE: Engine type + createEngine
  pipelines/temporal/collectors/
    animation.ts                     MODIFY: true end time, infinite loops, target marker
    types.ts                         MODIFY: optional fields on AnimationStartPayload
  dataset/
    types.ts                         CREATE: Episode, Clip, Measurements, RejectReason, ...
    trace/trace-writer.ts            CREATE: append-only JSONL trace
    trace/trace-types.ts             CREATE: TraceRecord union
    budget.ts                        CREATE: RunBudget caps
    tools/in-process-tools.ts        CREATE: MCP client over InMemoryTransport
    capture/screencast-recorder.ts   CREATE: frames + scroll offsets from screencast
    capture/frame-timing.ts          CREATE: CDP Tracing -> FrameTimingSummary
    capture/page-observers.ts        CREATE: LoAF + layout-shift init script
    recorder/segmenter.ts            CREATE: events + triggers -> episodes
    recorder/measure.ts              CREATE: duration, easing fit, flashes
    recorder/reduced-motion.ts       CREATE: best-effort replay
    recorder/junk-filter.ts          CREATE: rules -> keep | reject(reason)
    recorder/dedup.ts                CREATE: fingerprint + phash index
    recorder/recorder.ts             CREATE: ties capture + segmenter + measure + filter + dedup
    sitemap/sitemap.ts               CREATE: states, transitions, replay path
    store/clip-store.ts              CREATE: ClipStore interface + LocalClipStore
    explorer/model.ts                CREATE: ExplorerModel interface + Anthropic impl
    explorer/rails.ts                CREATE: allowed-call checks
    explorer/explorer.ts             CREATE: the agent loop
    crawl/robots.ts                  CREATE: robots.txt fetch + check
    run/run-site.ts                  CREATE: orchestrates one site
    run/report.ts                    CREATE: trace -> RunReport
    cli/run.ts                       CREATE: `dataset:run`
    browse/server.ts                 CREATE: `dataset:browse` local server
    browse/index.html                CREATE: clip browser page
packages/core/tests/
  unit/dataset/**                    one test file per src file
  integration/dataset/fixtures/      animated fixture site (6 pages)
  integration/dataset/run-site-e2e.test.ts
```

---

### Task 1: Expose an Engine handle beside the MCP server

**Files:**
- Create: `packages/core/src/mcp/engine.ts`
- Modify: `packages/core/src/mcp/server.ts` (lines 78-175 become `createEngine`; the handlers call into it)
- Test: `packages/core/tests/unit/mcp/engine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Engine {
    runtime: BrowserRuntime;
    eventStream: TemporalEventStream;
    ensureLaunched(): Promise<void>;
    ensureStreamAttached(): Promise<void>;
    captureGraph(includeVisual?: boolean | AnalysisDepth): Promise<SceneGraph>;
  }
  export function createEngine(config?: ServerConfig): Engine;            // engine.ts
  export function createServerWithEngine(config?: ServerConfig): { server: McpServer; engine: Engine }; // server.ts
  ```
  `createServer(config)` keeps its signature and returns `createServerWithEngine(config).server`.
- `captureGraph` now fills `scrollPosition` from `window.scrollX/scrollY`. It was hard-coded to `{0,0}` at `server.ts:156`.

- [ ] **Step 1: Write the failing tests**
  - `createServerWithEngine().engine` exposes all five members.
  - `createServer()` still returns an `McpServer`, and `TOOL_NAMES` is unchanged.
  - With a mocked page whose `evaluate` returns `{x:0,y:840}`, `captureGraph()` produces `scrollPosition` `{x:0, y:840}`.
- [ ] **Step 2: Run, expect FAIL** (`createServerWithEngine` not exported).
  `pnpm -F @uipe/core exec vitest run tests/unit/mcp/engine.test.ts`
- [ ] **Step 3: Implement.** Move the per-server state and helpers into `createEngine`. Handlers call `engine.*`. Change no handler behavior other than the scroll position.
- [ ] **Step 4: Run the full unit suite. All existing tests pass, plus the new ones.**
- [ ] **Step 5: Commit** `refactor: expose Engine handle beside MCP server, read real scroll position`

---

### Task 2: Fix the animation collector (true end, loops, target marker)

**Files:**
- Modify: `packages/core/src/pipelines/temporal/collectors/animation.ts`, `.../collectors/types.ts:46-56`, `.../verifiers/animation/verifier.ts:27-44` (`READ_AT_START_SCRIPT`)
- Test: `packages/core/tests/unit/pipelines/temporal/collectors/animation.test.ts` (extend)

**Interfaces:**
- `AnimationStartPayload` gains optional fields:
  ```ts
  iterations?: number;          // Infinity when CDP omits it (infinite)
  delay?: number; endDelay?: number;
  target?: string;              // now filled: CSS selector
  targetMarker?: string;        // value of data-uipe-anim set on the target
  targetTag?: string;
  ```
- **End time** is `delay + duration * iterations + endDelay`. Infinite animations get **no** end timer. A zero-duration animation is removed from `active` immediately, fixing the leak.
- **Target marker:** the in-page start script sets `data-uipe-anim="<animationId>"` on `anim.effect.target` and returns `{selector, tag}`. `extractStructure` keeps `data-*` attributes, so the recorder can join the marker to a `StructuralNode`.

- [ ] **Step 1: Write the failing tests**
  - `emits_end_after_all_iterations`: duration 200, iterations 3, delay 100, so the end comes at +700 ms, not +216.
  - `infinite_animation_never_emits_completed_end`: the start payload has `iterations: Infinity`, and no `animation-end` arrives within 5 s of fake time.
  - `zero_duration_does_not_leak_active_entry`.
  - `start_payload_carries_target_marker_and_selector`: the mocked `callFunctionOn` returns `{selector:'div.modal', tag:'div', marker:'anim-1'}`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with fake timers in tests. Leave the cancel path and the race guard unchanged.
- [ ] **Step 4: Run collector, verifier and integration `animation-verifier.test.ts`. All PASS.**
- [ ] **Step 5: Commit** `fix: animation collector honors iterations/delay, marks targets, stops zero-duration leak`

---

### Task 3: Dataset types and the trace writer

**Files:**
- Create: `packages/core/src/dataset/types.ts`, `dataset/trace/trace-types.ts`, `dataset/trace/trace-writer.ts`
- Test: `packages/core/tests/unit/dataset/trace/trace-writer.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type TriggerKind = 'action' | 'scroll-step' | 'page-load';
  export interface Trigger { id: string; kind: TriggerKind; timestamp: number; stateId: string; action?: BrowserAction; scrollY?: number }
  export type EpisodeCloseReason = 'settled' | 'max-duration' | 'navigated' | 'run-ended';
  export interface EpisodeAnimation { animationId: string; name?: string; duration: number; delay: number; endDelay: number; iterations: number; easing?: string; targetMarker?: string; targetTag?: string; startTs: number; endTs?: number; deviation?: AnimationDeviation }
  export interface Episode { id: string; trigger: Trigger; startTs: number; endTs: number; closeReason: EpisodeCloseReason; animations: EpisodeAnimation[]; passive: boolean; ambientLoop: boolean; motionOnly: boolean /* flow/mutation, no CDP animation */ }
  export type RejectReason = 'bot-challenge'|'login-wall'|'error-page'|'blank'|'loading'|'cookie-consent'|'chat-widget'|'ad'|'spinner'|'started-mid-animation'|'not-settled'|'offscreen'|'covered'|'media-playback'|'no-motion';
  export interface Measurements { declared: {durationMs:number; delayMs:number; easing?:string}[]; measuredDurationMs: number|null; fittedEasing: {curve:'linear'|'ease'|'ease-in'|'ease-out'|'ease-in-out'; rmse:number}|null; deviationScore: number|null; frameTiming: FrameTimingSummary|null; layoutShift: number; flashes: FlashResult; reducedMotion: ReducedMotionResult; framesCaptured: number; achievedFps: number }
  export interface Clip { schemaVersion: 1; id: string; runId: string; site: string; url: string; stateId: string; episode: Episode; kind: string; measurements: Measurements; fingerprint: string; phash: string; occurrences: {url:string; stateId:string; triggerId:string}[]; files: {frames: string[]; keyframes: string[]; beforePng: string; afterPng: string; beforeScene: string; afterScene: string}; actionLatencyMs: number|null; actionSucceeded: boolean|null; traceRefs: string[] }
  ```
  `FrameTimingSummary`, `FlashResult` and `ReducedMotionResult` are declared here and filled in by Tasks 5, 7 and 8. Their shapes are given in those tasks.
- Produces (`trace-types.ts`): a `TraceRecord` discriminated union on `type`: `run-start`, `run-end`, `explorer-step`, `tool-call`, `tool-refused`, `trigger`, `episode`, `clip-kept`, `clip-rejected`, `clip-duplicate`, `cap-hit`, `error`. Every record has `{id, runId, site, step, ts}`.
  - `explorer-step` adds `{observationSummary, decision, rationale, inputTokens, outputTokens, usd}`.
  - `clip-rejected` adds `{episodeId, reason: RejectReason, detail}`.
  - `clip-duplicate` adds `{episodeId, duplicateOf}`.
- Produces (`trace-writer.ts`):
  ```ts
  export class TraceWriter { constructor(path: string, runId: string, site: string); write(r: Omit<TraceRecord,'id'|'runId'|'site'|'ts'>): string /* returns id */; flush(): Promise<void>; close(): Promise<void> }
  export function readTrace(path: string): Promise<TraceRecord[]>  // tolerates a truncated last line
  ```

- [ ] **Step 1: Write the failing tests**
  - `writes_one_json_line_per_record_with_ids`.
  - `read_trace_skips_truncated_final_line`: append `{"type":"tri` and expect the earlier records back.
  - `ids_are_unique_and_monotonic_within_run`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Append with `fs.appendFile` through a serialized promise chain. Write synchronously enough that a crash loses at most the in-flight record.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: dataset types and append-only trace writer`

---

### Task 4: Run budget and in-process MCP tools

**Files:**
- Create: `packages/core/src/dataset/budget.ts`, `dataset/tools/in-process-tools.ts`
- Test: `tests/unit/dataset/budget.test.ts`, `tests/unit/dataset/tools/in-process-tools.test.ts`

**Interfaces:**
- ```ts
  export interface BudgetCaps { maxSteps: number; maxUsd: number; maxWallMs: number }
  export const DEFAULT_CAPS: BudgetCaps = { maxSteps: 60, maxUsd: 2.0, maxWallMs: 1_200_000 };
  export class RunBudget { constructor(caps: BudgetCaps, now?: () => number); recordStep(usd: number): void; exceeded(): null | 'steps' | 'usd' | 'wall'; snapshot(): {steps:number; usd:number; elapsedMs:number} }
  export interface ToolResult { text: string; isError: boolean; image?: {data:string; mimeType:string} }
  export class InProcessTools { static connect(server: McpServer): Promise<InProcessTools>; call(name: string, args: Record<string, unknown>): Promise<ToolResult>; close(): Promise<void> }
  ```
  `InProcessTools` uses `InMemoryTransport.createLinkedPair()` plus an SDK `Client`. Text results keep the `<untrusted_page_content>` envelope exactly as the server produced it.

- [ ] **Step 1: Write the failing tests**
  - `exceeded_reports_first_cap_hit` for steps, usd and wall, using an injected `now`.
  - `tool_call_round_trips_through_real_server`: call `get_scene` on a fresh `createServer()` and expect the text to be "No scene captured yet" (or contain it). No browser is needed for that path.
  - `navigate_result_is_wrapped_in_untrusted_envelope`: use a server whose engine runtime is stubbed. The expected text starts with `<untrusted_page_content>`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: run budget caps and in-process MCP tool client`

---

### Task 5: Capture: screencast frames, frame timing, page observers

**Files:**
- Create: `dataset/capture/screencast-recorder.ts`, `dataset/capture/frame-timing.ts`, `dataset/capture/page-observers.ts`
- Test: one unit file per source file, using the `makeMockCdp`/`makeMockPage` pattern from `tests/unit/pipelines/temporal/collectors/animation.test.ts:6-26`. Trace parsing is tested against a checked-in JSON fixture `tests/unit/dataset/capture/fixtures/trace-sample.json` with hand-built events.

**Interfaces:**
- ```ts
  export interface CapturedFrame { ts: number /* stream-relative ms via normalizer.fromWallTimeMs(metadata.timestamp*1000) */; jpeg: Buffer; scrollX: number; scrollY: number }
  export class ScreencastRecorder { constructor(page: Page, normalizer: () => ClockNormalizer | undefined); start(): Promise<void>; stop(): Promise<void>; framesBetween(startTs: number, endTs: number): CapturedFrame[]; dropBefore(ts: number): void }
  export interface TraceEvent { name: string; cat: string; ph: string; ts: number /* µs */; dur?: number; args?: Record<string, unknown> }
  export interface FrameTimingSummary { frames: number; droppedFrames: number; longestFrameMs: number; longAnimationFrames: number; source: 'trace' }
  export class FrameTimingRecorder { constructor(page: Page); start(): Promise<void>; stopAndCollect(): Promise<TraceEvent[]> }
  export function summarizeFrameTiming(events: TraceEvent[], startUs: number, endUs: number): FrameTimingSummary
  export const PAGE_OBSERVERS_SCRIPT: string;   // installs LoAF + layout-shift PerformanceObservers into window.__uipePerf
  export function readPageObservers(page: Page, sinceMs: number): Promise<{ longAnimationFrames: number; layoutShift: number }>
  ```
- **Screencast parameters:** `format: 'jpeg'`, `quality: 70`, `maxWidth: 1280`, `maxHeight: 720`, `everyNthFrame: 1`. JPEG is used to keep encoding cost off the page being measured. Ack each frame immediately. Keep a ring buffer of at most 900 frames (≈15 s at 60 fps). Scroll offsets come from `metadata.scrollOffsetX/Y`.
- **Tracing categories:** `['devtools.timeline', 'disabled-by-default-devtools.timeline.frame']`. Dropped frames are counted from `DroppedFrame` events plus `DrawFrame` intervals above 1.5× the median interval inside the window.

- [ ] **Step 1: Write the failing tests**
  - `frames_use_metadata_timestamp_not_Date_now`.
  - `frames_between_filters_by_ts_and_carries_scroll_offsets`.
  - `ring_buffer_caps_at_900_frames`.
  - `summarize_counts_dropped_frames_in_window_only`, against the fixture: the window contains 2 drops and the outside holds 1. Expect `droppedFrames: 2`.
  - `summarize_on_empty_events_returns_zero_frames_not_throw`.
  - `page_observers_script_is_idempotent` (guard flag).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: screencast frame recorder, trace frame timing, LoAF/CLS observers`

---

### Task 6: Episode segmenter

**Files:**
- Create: `dataset/recorder/segmenter.ts`
- Test: `tests/unit/dataset/recorder/segmenter.test.ts`

**Interfaces:**
- ```ts
  export interface SegmenterOptions { settleMs: number /* default 300 */; maxEpisodeMs: number /* default 10_000 */; preRollMs: number /* default 100 */ }
  export class Segmenter {
    constructor(opts?: Partial<SegmenterOptions>);
    onTrigger(t: Trigger): void;
    onEvent(e: TimelineEvent): void;          // animation-start/end, mutation, optical-flow-motion
    onNavigated(ts: number): void;
    tick(now: number): Episode[];             // returns episodes closed since last tick
    flush(now: number): Episode[];            // closes everything with 'run-ended'
  }
  ```
- **Rules:**
  - An episode opens on a trigger, or on an animation-start with no open episode (`passive: true`).
  - It absorbs events until no animation has been active for `settleMs`, or until `maxEpisodeMs` passes.
  - An `iterations: Infinity` animation sets `ambientLoop: true` and does not keep the episode open past one cycle (`duration + delay`).
  - An episode containing only flow or mutation motion sets `motionOnly: true`.
  - `onNavigated` closes any open episode with `navigated`.

- [ ] **Step 1: Write the failing tests**
  - `groups_stagger_from_one_trigger_into_one_episode`: backdrop, panel and 3 children all go into one episode with 5 animations.
  - `closes_after_settle_window`.
  - `closes_episode_at_max_duration_on_endless_motion` (Review Focus 1).
  - `infinite_loop_kept_as_one_cycle_marked_ambient`.
  - `navigation_mid_episode_closes_with_reason_navigated` (Review Focus 2). The closed episode keeps the animations it had collected.
  - `passive_animation_without_trigger_opens_passive_episode`.
  - `flow_motion_only_episode_is_motion_only`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** as a pure state machine with no I/O.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: episode segmenter (one clip per trigger, loops, nav, max duration)`

---

### Task 7: Measurements: measured duration, fitted easing, flashes

**Files:**
- Create: `dataset/recorder/measure.ts`
- Test: `tests/unit/dataset/recorder/measure.test.ts`. Frames are synthesized with `sharp` (solid colors and moving rectangles) inside the test.

**Interfaces:**
- ```ts
  export interface FlashResult { general: number /* flashes per worst 1s window */; red: number; failsWcag231: boolean }
  export function measuredDuration(frames: CapturedFrame[], changeThreshold?: number /* default 0.002 of pixels */): number | null
  export function fitEasing(frames: CapturedFrame[]): { curve: 'linear'|'ease'|'ease-in'|'ease-out'|'ease-in-out'; rmse: number } | null
  export function detectFlashes(frames: CapturedFrame[], viewport: {width:number; height:number}): Promise<FlashResult>
  ```
- **Easing fit:** compute cumulative normalized frame-difference progress against normalized time. Compare it with the five CSS cubic-béziers by RMSE and pick the lowest. Return `null` with fewer than 4 frames.
- **Flashes (WCAG 2.3.1):**
  - A flash is a pair of opposing changes in relative luminance of ≥ 10% where the darker image is < 0.80.
  - It counts only over a combined changed area ≥ 21,824 px. That is 25% of 341×256, scaled to the actual viewport by `(w*h)/(1024*768)`.
  - A red flash is the same rule applied to pixels where `R/(R+G+B) ≥ 0.8`.
  - `failsWcag231` is true when either count exceeds 3 in any 1 s window.

- [ ] **Step 1: Write the failing tests**
  - `measured_duration_spans_first_to_last_changed_frame`: 30 synthetic frames with movement in frames 5–20 at 60 fps give 250 ms ± 17.
  - `fit_easing_identifies_linear_motion`: a constant-velocity rectangle fits `linear`.
  - `fit_easing_identifies_ease_out`.
  - `fit_easing_null_under_4_frames`.
  - `black_white_full_frame_at_8hz_fails_wcag`.
  - `small_flashing_region_below_area_threshold_passes`.
  - `static_frames_report_zero_flashes`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Decode JPEG with `sharp(...).raw()`, and downscale to ≤ 320 px wide before diffing to keep CPU low.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: clip measurements (duration, easing fit, WCAG 2.3.1 flashes)`

---

### Task 8: Site map and best-effort reduced-motion replay

**Files:**
- Create: `dataset/sitemap/sitemap.ts`, `dataset/recorder/reduced-motion.ts`
- Test: `tests/unit/dataset/sitemap/sitemap.test.ts`, `tests/unit/dataset/recorder/reduced-motion.test.ts`

**Interfaces:**
- ```ts
  export interface SiteState { id: string; url: string; structureSignature: string; firstSeenStep: number }
  export interface SiteTransition { from: string; to: string; action: BrowserAction; triggerId: string; clipIds: string[] }
  export interface SiteMapJSON { version: 1; site: string; startUrl: string; states: SiteState[]; transitions: SiteTransition[] }
  export class SiteMap {
    constructor(site: string, startUrl: string);
    static stateIdFor(url: string, graph: SceneGraph): string;   // sha256(url-without-hash + sorted top-50 interactive node labels+roles), 16 hex
    observe(url: string, graph: SceneGraph, step: number): SiteState;
    addTransition(t: SiteTransition): void;
    pathTo(stateId: string): BrowserAction[] | null;   // BFS from startUrl's state; null if unreachable
    toJSON(): SiteMapJSON; static fromJSON(j: SiteMapJSON): SiteMap;
  }
  export type ReducedMotionResult = { status: 'measured'; motionRatio: number /* reduced/normal frame-change, 0..1+ */ } | { status: 'not-reproducible'; reason: 'unreachable-state' | 'side-effect-risk' | 'error' };
  export function replayReducedMotion(args: { page: Page; siteMap: SiteMap; stateId: string; trigger: Trigger; recorder: ScreencastRecorder; settleMs: number; normalMotion: number }): Promise<ReducedMotionResult>
  ```
- **Replay steps:**
  1. `page.emulateMedia({ reducedMotion: 'reduce' })`.
  2. Navigate to `startUrl` and replay `pathTo(stateId)`.
  3. Re-issue the trigger and capture frames for the settle window.
  4. Compute motion with the same frame-difference measure as `measuredDuration`.
  5. Restore with `emulateMedia({ reducedMotion: null })`.

  Any trigger whose action is `type` or `pressKey` → `side-effect-risk`, and is not replayed.

- [ ] **Step 1: Write the failing tests**
  - `state_id_stable_across_reordered_dom_ids`: same labels, different `dom-N` ids, same state id.
  - `path_to_returns_shortest_action_sequence`.
  - `path_to_unreachable_returns_null`.
  - `sitemap_json_round_trips_with_version_1`.
  - `replay_restores_media_emulation_even_on_error`.
  - `replay_returns_not_reproducible_when_path_null`.
  - `typing_trigger_is_side_effect_risk_and_not_replayed`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: site map (#5 seed) and best-effort reduced-motion replay`

---

### Task 9: Junk filter

**Files:**
- Create: `dataset/recorder/junk-filter.ts`
- Test: `tests/unit/dataset/recorder/junk-filter.test.ts`

**Interfaces:**
- ```ts
  export interface JunkContext { episode: Episode; before: SceneGraph; after: SceneGraph; documentStatus: number | null; frames: CapturedFrame[]; targets: StructuralNode[] /* joined via data-uipe-anim */; viewport: {width:number; height:number} }
  export type JunkVerdict = { keep: true } | { keep: false; reason: RejectReason; detail: string };
  export function classifyJunk(ctx: JunkContext): JunkVerdict    // first matching rule wins, order below
  export function isBotChallenge(graph: SceneGraph): boolean     // used by Task 13 to stop a site
  ```
- **Rule order:**
  1. `bot-challenge` matches text or title containing "Just a moment", "Checking your browser", "Verify you are human", "captcha", or an iframe/src containing `challenges.cloudflare.com`, `hcaptcha`, `recaptcha`.
  2. `error-page` is a document status ≥ 400.
  3. `login-wall` is a typeable password field visible ≥ 50% with no other main content.
  4. `blank` is every frame's luminance stddev < 2.
  5. `loading` is a target or ancestor with `isLoading`, `role=progressbar` or `aria-busy=true`.
  6. `cookie-consent` is a target or ancestor whose label, text, id or class matches `/cookie|consent|gdpr|onetrust|cmp/i`.
  7. `chat-widget` is a target inside an iframe or a fixed bottom-corner container whose id, class or src matches `/intercom|drift|zendesk|crisp|hubspot|livechat|tawk/i`.
  8. `ad` is a target inside an iframe whose src matches `/doubleclick|googlesyndication|adservice|taboola|outbrain/i`.
  9. `spinner` is an infinite rotate animation on a target ≤ 80×80 px.
  10. `started-mid-animation` is any animation whose `startTs` is earlier than `trigger.timestamp - preRoll` on a non-passive episode.
  11. `not-settled` is `closeReason === 'max-duration'` and not `ambientLoop`.
  12. `offscreen` is every target's bounding box outside the viewport.
  13. `covered` is every target with `visibilityPercent` < 50.
  14. `media-playback` is every target with tag `video`, or an `img` whose src ends `.gif`.
  15. `no-motion` is a measured duration of null with zero CDP animations.

- [ ] **Step 1: Write the failing tests:** one test per rule, named `rejects_<reason>`, plus `keeps_clean_modal_open_episode` and `first_matching_rule_wins_challenge_over_blank`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: auditable junk filter with ordered reasons`

---

### Task 10: Deduplication

**Files:**
- Create: `dataset/recorder/dedup.ts`
- Test: `tests/unit/dataset/recorder/dedup.test.ts`

**Interfaces:**
- ```ts
  export function episodeFingerprint(episode: Episode, targets: StructuralNode[], nodeMap: ReadonlyMap<string, StructuralNode>): string
  // sha256 over sorted per-animation tuples: computeSignature(target) | keyframes-name | duration | delay | iterations | easing ; 16 hex
  export function framesPHash(keyframes: Buffer[]): Promise<string>   // FrameCapture.perceptualHash per keyframe, hex-joined
  export class DedupIndex {
    constructor(opts?: { phashMaxHamming?: number /* default 6 per keyframe */ });
    check(fingerprint: string, phash: string, motionOnly: boolean): { duplicateOf: string } | null;
    add(clipId: string, fingerprint: string, phash: string): void;
  }
  ```
  An exact fingerprint match makes a duplicate. For `motionOnly` episodes, where there is no CDP data, the phash within the Hamming threshold decides.

- [ ] **Step 1: Write the failing tests**
  - `same_nav_animation_on_two_pages_is_duplicate`.
  - `same_keyframes_different_duration_is_not_duplicate`.
  - `animation_order_does_not_change_fingerprint`.
  - `motion_only_uses_phash_threshold`.
  - `positional_dom_ids_do_not_affect_fingerprint`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: episode fingerprint + phash dedup index`

---

### Task 11: Clip store and the recorder that ties capture together

**Files:**
- Create: `dataset/store/clip-store.ts`, `dataset/recorder/recorder.ts`
- Test: `tests/unit/dataset/store/clip-store.test.ts`, `tests/unit/dataset/recorder/recorder.test.ts`

**Interfaces:**
- ```ts
  export interface ClipStore { runDir(runId: string): string; saveClip(clip: Clip, assets: {frames: Buffer[]; keyframes: Buffer[]; beforePng: Buffer; afterPng: Buffer; beforeScene: SceneGraph; afterScene: SceneGraph}): Promise<Clip>; saveRejected(runId: string, episodeId: string, reason: RejectReason, keyframe: Buffer | null): Promise<void>; addOccurrence(runId: string, clipId: string, occ: Clip['occurrences'][number]): Promise<void>; saveSiteMap(runId: string, map: SiteMapJSON): Promise<void>; listClips(runId: string): Promise<Clip[]> }
  export function datasetRoot(): string   // $UIPE_DATASET_DIR or ~/.uipe/dataset
  export class LocalClipStore implements ClipStore { constructor(root?: string) }
  ```
  **Layout:**
  - Per run: `runs/<runId>/{trace.jsonl, sitemap.json, report.json, report.md}`.
  - Per clip: `runs/<runId>/clips/<clipId>/{clip.json, frames/NNNN.jpg, keyframes/NN.png, before.png, after.png, before-scene.json, after-scene.json}`.
  - Rejected: `runs/<runId>/rejected/<episodeId>.{json,png}`.
- ```ts
  export interface RecorderDeps { engine: Engine; trace: TraceWriter; store: ClipStore; siteMap: SiteMap; runId: string; site: string; segmenterOptions?: Partial<SegmenterOptions> }
  export class Recorder {
    constructor(deps: RecorderDeps);
    start(): Promise<void>;                       // screencast, tracing, observers, subscribe eventStream.on('event')
    beginTrigger(t: Trigger): Promise<void>;      // snapshot before-state (captureGraph + screenshot)
    awaitSettle(): Promise<Episode[]>;            // ticks until open episodes close; then processes each
    stop(): Promise<{ kept: number; rejected: number; duplicates: number }>;
  }
  ```
  **Processing each closed episode, in order:**
  1. capture the after-state;
  2. join targets via `data-uipe-anim`;
  3. measure (Task 7, plus frame timing from Task 5);
  4. `classifyJunk` (Task 9); if rejected, `saveRejected` and trace `clip-rejected`;
  5. dedup (Task 10); if a duplicate, `addOccurrence` and trace `clip-duplicate`;
  6. reduced-motion replay (Task 8);
  7. `saveClip`, trace `clip-kept`, and add the clip id to the site-map transition.

  Before/after PNGs come from `runtime.screenshot()` (lossless). Keyframes are 4 frames evenly spaced through the episode, re-encoded as PNG.

- [ ] **Step 1: Write the failing tests**
  - Store: `save_clip_writes_layout_and_relative_paths`, `dataset_root_honors_env_override`, `list_clips_skips_corrupt_clip_json`.
  - Recorder, with a fake engine, a fake page and real segmenter/filter/dedup:
    - `kept_episode_produces_clip_and_trace_record`
    - `rejected_episode_writes_reason_and_trace`
    - `duplicate_episode_adds_occurrence_not_clip`
    - `recorder_survives_measurement_error_and_traces_it`
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: local clip store and recorder pipeline`

---

### Task 12: Explorer model, rails, and agent loop

**Files:**
- Create: `dataset/explorer/model.ts`, `dataset/explorer/rails.ts`, `dataset/explorer/explorer.ts`
- Test: one unit file per source file. The model is a scripted fake in tests, and `@anthropic-ai/sdk` is mocked for `AnthropicExplorerModel`.

**Interfaces:**
- ```ts
  export interface ExplorerTurn { observation: string; history: {call: ExplorerCall; resultSummary: string}[]; visitedStates: number; budget: {steps:number; usd:number} }
  export interface ExplorerCall { tool: 'navigate'|'act'|'get_scene'|'get_affordances'|'done'; args: Record<string, unknown>; rationale: string }
  export interface ExplorerModel { next(turn: ExplorerTurn): Promise<{ call: ExplorerCall; inputTokens: number; outputTokens: number }> }
  export class AnthropicExplorerModel implements ExplorerModel {
    constructor(opts: { apiKey?: string /* ANTHROPIC_API_KEY ?? CLAUDE_API_KEY */; model?: string /* UIPE_EXPLORER_MODEL ?? 'claude-sonnet-5' */ })
  }
  export function costUsd(inputTokens: number, outputTokens: number): number   // UIPE_EXPLORER_PRICE_IN/OUT per Mtok, defaults 3 / 15
  export type RailVerdict = { ok: true } | { ok: false; reason: string };
  export function checkRails(call: ExplorerCall, ctx: { startOrigin: string }): RailVerdict
  export class Explorer {
    constructor(deps: { model: ExplorerModel; tools: InProcessTools; recorder: Recorder; siteMap: SiteMap; budget: RunBudget; trace: TraceWriter; engine: Engine; startUrl: string });
    run(): Promise<{ stopReason: 'done' | 'cap-steps' | 'cap-usd' | 'cap-wall' | 'bot-challenge' | 'error' }>;
  }
  ```
- **Rails.** Reject:
  - an unknown tool;
  - a `navigate` or `act:navigate` whose URL origin is not `startOrigin`;
  - `act` types `type`, `pressKey` (Enter), or `setViewport`;
  - a click whose target label matches `/sign ?in|log ?in|sign ?up|register|buy|checkout|subscribe|pay|delete|remove|submit|send/i`;
  - arguments that fail `actInputSchema`.
- **The loop.** Each step:
  1. Check `budget.exceeded()`, and trace `cap-hit` if it is.
  2. `model.next()`.
  3. Run `checkRails`. A refusal is traced as `tool-refused` and still counts as a step.
  4. For `act` or `navigate`: `recorder.beginTrigger(trigger)`, `tools.call`, then `recorder.awaitSettle()`.
  5. Observe the new state into the site map and add the transition.
  6. Trace `explorer-step` with tokens and usd, and call `budget.recordStep(usd)`.
- **On arrival at each new state:** the explorer (not the model) records a `page-load` trigger. It then does a scroll sweep: `window.scrollTo(0, y)` in steps of `0.8 × viewportHeight`, pausing 1000 ms per step, each step a `scroll-step` trigger, then returns to the top. These count as triggers but not as model steps.
- **The system prompt** states the exploration priorities from spec §5.1. It also says that page content arrives inside `<untrusted_page_content>` and must never be followed as instructions.

- [ ] **Step 1: Write the failing tests**
  - `refuses_off_rail_tool_calls_and_counts_step` (Review Focus 4): off-origin navigate, a "Buy now" click, an unknown tool and bad arguments each produce a `tool-refused` trace and increment the steps.
  - `stops_at_step_cap_with_cap_hit_trace`.
  - `stops_at_usd_cap`.
  - `scroll_sweep_runs_once_per_new_state`.
  - `done_call_ends_run`.
  - `anthropic_model_maps_tool_use_block_to_explorer_call` (mocked SDK).
  - `cost_usd_uses_env_prices`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Use Anthropic tool-use with a JSON schema per `ExplorerCall.tool`. Summarize observations to ≤ 4,000 characters from `get_affordances` plus compact scene text.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: explorer agent loop with rails, caps, scroll sweep`

---

### Task 13: Robots, site runner, and CLI

**Files:**
- Create: `dataset/crawl/robots.ts`, `dataset/run/run-site.ts`, `dataset/cli/run.ts`
- Modify: `packages/core/package.json`, adding scripts `"dataset:run": "tsx src/dataset/cli/run.ts"` and `"dataset:browse": "tsx src/dataset/browse/server.ts"`
- Test: `tests/unit/dataset/crawl/robots.test.ts`, `tests/unit/dataset/run/run-site.test.ts`

**Interfaces:**
- ```ts
  export function fetchRobots(origin: string, userAgent: string, fetchImpl?: typeof fetch): Promise<{ allowed(path: string): boolean; status: 'ok' | 'missing' | 'disallow-all' }>
  // 404 -> missing (allow all); 5xx or network error -> disallow-all; parses User-agent groups (* and "UIPE-research-crawler") with Allow/Disallow longest-match
  export interface RunSiteOptions { startUrl: string; contactUrl: string; caps?: Partial<BudgetCaps>; model?: ExplorerModel; store?: ClipStore; runId?: string }
  export function runSite(opts: RunSiteOptions): Promise<{ runId: string; report: RunReport }>
  ```
- **`runSite` steps:**
  1. Throw `ContactUrlRequired` when `contactUrl` is empty.
  2. Check robots; if the start path is disallowed, write a trace `run-end` with stop reason `robots-disallow` and return.
  3. `createServerWithEngine()`.
  4. Set the user agent via `page.setExtraHTTPHeaders({'User-Agent': ...})`, or launch the context with `userAgent`. Add a `userAgent?` option to `BrowserRuntimeOptions` if needed (optional field).
  5. Rate-limit to at most 1 navigation per 2 s per origin.
  6. Start the `Recorder`, then the `Explorer`.
  7. Always close the browser in `finally`, flush the trace, and write the report (Task 14).
  8. If the first page is a bot challenge (`isBotChallenge`), trace one `clip-rejected` with `bot-challenge`, set stop reason `bot-challenge`, and do no retry.
- **CLI:** `pnpm -F @uipe/core dataset:run --site <url> [--site <url>…] --contact <url> [--max-usd N]`. It prints the report's first line per site. On SIGINT it stops the explorer, flushes, writes a partial report and exits 130.

- [ ] **Step 1: Write the failing tests**
  - `robots_5xx_disallows_all`.
  - `robots_404_allows_all`.
  - `robots_longest_match_allow_beats_disallow`.
  - `refuses_to_run_without_contact_url`.
  - `stops_site_on_bot_challenge_without_retry` (Review Focus 3).
  - `browser_closed_even_when_explorer_throws`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: robots-aware site runner and dataset:run CLI`

---

### Task 14: Run report from the trace

**Files:**
- Create: `dataset/run/report.ts`
- Test: `tests/unit/dataset/run/report.test.ts`

**Interfaces:**
- ```ts
  export interface RunReport {
    runId: string; site: string; stopReason: string;
    kept: number; rejected: number; duplicates: number;
    rejectedByReason: Record<RejectReason, number>;
    uniqueEpisodes: number; states: number; transitions: number; capsHit: string[];
    usd: number; usdPerKeptClip: number | null;
    duplicateRate: number;   // duplicates / (kept + duplicates)
    junkRateEstimate: null;  // filled only by the owner's hand-check (40 clips); shown as "pending hand-check"
    passes: { minUniqueEpisodes: boolean /* >= 15 */; maxDuplicateRate: boolean /* <= 0.10 */ };
  }
  export function buildReport(trace: TraceRecord[]): RunReport
  export function renderReportMarkdown(r: RunReport): string   // FIRST line: "kept K · rejected R · duplicate rate D% · unique U · <PASS|FAIL> (dup ≤10%, unique ≥15) · junk: pending hand-check (40)"
  export function regenerateReport(runDir: string): Promise<RunReport>  // reads trace.jsonl, rewrites report.json + report.md
  ```

- [ ] **Step 1: Write the failing tests**
  - `counts_kept_rejected_duplicates_by_reason`.
  - `duplicate_rate_and_pass_flags_at_thresholds`: dup 10% passes, 10.1% fails, unique 15 passes, 14 fails.
  - `markdown_first_line_leads_with_quality`.
  - `report_regenerates_from_partial_trace` (Review Focus 5): a trace with no `run-end` and a truncated last line yields a report with `stopReason: 'interrupted'`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: quality-first run report built from trace`

---

### Task 15: Clip browser with hand-check sampling

**Files:**
- Create: `dataset/browse/server.ts`, `dataset/browse/index.html`
- Test: `tests/unit/dataset/browse/server.test.ts`

**Interfaces:**
- ```ts
  export function startBrowseServer(opts: { root?: string; port?: number }): Promise<{ url: string; close(): Promise<void> }>
  // node:http on 127.0.0.1 only. Routes:
  // GET /api/runs                          -> [{runId, site, report}]
  // GET /api/runs/:runId/clips?kind=&site= -> Clip[]
  // GET /api/runs/:runId/rejected          -> [{episodeId, reason, detail, keyframe}]
  // GET /api/runs/:runId/sample?n=40&seed= -> 40 random kept clip ids (seeded, stable)
  // POST /api/runs/:runId/handcheck        -> body {clipId, junk: boolean}; appends to handcheck.jsonl; report junk rate recomputed when 40 recorded
  // GET /files/:runId/<relative path>      -> static asset under the run dir (path traversal -> 403)
  ```
- **`index.html`** is a single page with no build step:
  - a run picker;
  - clips grouped by site, then kind;
  - clicking a clip plays its JPEG frames at their recorded timestamps, with measurements beside it, the before/after images, and the trace refs;
  - a "Rejected" tab that shows reasons;
  - a "Hand-check" mode that walks the 40-clip sample, with keys `J` (junk) and `K` (keep), and saves as it goes.

  `kind` comes from a heuristic in `recorder.ts`: the target tag/role plus the trigger kind. Possible values: `page-load`, `scroll`, `modal`, `menu`, `dropdown`, `tab`, `accordion`, `hover`, `button`, `loop`, `other`. Add it to Task 11's `saveClip` input if it isn't there yet.

- [ ] **Step 1: Write the failing tests**
  - `binds_loopback_only`.
  - `sample_is_seeded_and_stable`.
  - `path_traversal_returns_403`.
  - `handcheck_40_updates_report_junk_rate`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, PASS.** Then load the page against a fixture run dir and confirm a clip plays and `J`/`K` saves.
- [ ] **Step 5: Commit** `feat: local clip browser with seeded 40-clip hand-check`

---

### Task 16: End-to-end against an animated fixture site

**Files:**
- Create: `tests/integration/dataset/fixtures/{index,about,gallery,pricing,blocked,loop}.html` + `site.css` + `site.js`, `tests/integration/dataset/run-site-e2e.test.ts`
- Modify: root `.gitignore` if fixture PNGs are needed. Prefer generated content, so none are.

**What the fixture site contains** (each item exists to exercise one rule):
- **Animations that should survive:**
  - a hero page-load entrance with 3 staggered elements (one episode);
  - a modal that opens on a button click (backdrop + panel + 3 staggered children);
  - a nav underline hover animation, repeated on every page (a duplicate);
  - a scroll-driven section (CSS `animation-timeline: view()`) plus a JS scroll-linked parallax;
  - an infinite marquee (an ambient loop, kept once).
- **Junk to reject:** a cookie banner slide-in, an 40×40 spinner, an off-screen animation, and an autoplay `<video>`.
- **Edge pages:** `blocked.html` returns challenge text ("Just a moment…"), and `loop.html` never stops animating.

**Test** (scripted `ExplorerModel` that visits every page and clicks the modal button; real browser; `UIPE_DATASET_DIR` set to a temp dir):
- `e2e_keeps_expected_episodes_and_rejects_junk_with_reasons`:
  - kept clips include `page-load`, `modal` (one clip with ≥ 5 animations), `scroll` and `loop` kinds;
  - the rejected reasons include `cookie-consent`, `spinner`, `offscreen` and `media-playback`;
  - the nav hover is kept once, with `occurrences.length ≥ 3`.
- `e2e_report_duplicate_rate_and_unique_counts_are_consistent_with_clips_on_disk`.
- `e2e_every_kept_clip_links_to_trace_records`.
- `e2e_blocked_start_page_stops_with_bot_challenge`.
- `e2e_endless_page_closes_episodes_and_finishes_within_wall_cap`.

- [ ] **Step 1: Write the fixtures and the failing test.**
- [ ] **Step 2: Run, expect FAIL** if anything upstream is missing. Otherwise fix the integration seams until it passes.
  `pnpm -F @uipe/core test:integration -- tests/integration/dataset`
- [ ] **Step 3: Run the full unit suite, the full integration suite, and `pnpm -r exec -- tsc --noEmit`. All green.**
- [ ] **Step 4: Update docs:**
  - a `DEVELOPMENT.md` section covering `dataset:run` and `dataset:browse`, the env vars (`UIPE_DATASET_DIR`, `UIPE_EXPLORER_MODEL`, `UIPE_EXPLORER_PRICE_IN/OUT`, `ANTHROPIC_API_KEY`) and the contact URL requirement;
  - set roadmap #5 (seeded by the site map) and Track 3 (started) in `/Users/dirkknibbe/uipe/docs/autopilot-program-roadmap.md`.
- [ ] **Step 5: Commit** `test: end-to-end dataset run against animated fixture site; docs`

---

## Milestone acceptance (owner, after Task 16)

1. Run `pnpm -F @uipe/core dataset:run --site <3–5 sites the owner picks> --contact <owner's URL>`.
2. Each site's report shows duplicate rate ≤ 10% and ≥ 15 unique episodes.
3. In `dataset:browse`, the owner hand-checks 40 kept clips per site, and the junk rate comes out ≤ 20%.
