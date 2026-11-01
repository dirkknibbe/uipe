# Animation-Taste Dataset: Explorer, Recorder, and Trace Harness

**Date:** 2026-11-01
**Status:** Design. Not yet approved.
**Research basis:** [`../research/2026-11-01-animation-judge-cost-research.md`](../research/2026-11-01-animation-judge-cost-research.md)
**Roadmap links:** #6 world model (the dataset's consumer), #5 SLAM for SPA routes (the site map), Track 3 data collection, Evaluation, Privacy.

---

## 1. Intent

Build the system that produces UIPE's training data for the world model (roadmap #6). The world model has to learn three things about web animation:

1. **How animations behave:** given a UI state and an action, what plays out and where it ends up.
2. **Taste:** what separates well-made web animation from janky, pointless, or inaccessible animation.
3. **Debugging:** for a bad animation, what is wrong and why.

The dataset should be as large as can be made well. The owner's stated failure mode: **if most of the collected clips are junk or duplicates, the project has failed, even if it technically works.**

The owner's original ask was "a testing harness and comprehensive logging so we can create evals and traces and validate and optimize processes." In this design that harness is not a separate product. It is the trace layer every component writes to, plus run reports that measure the pipeline's own output quality (§6).

## 2. Goals, non-goals, anti-goals

**Goals**
- An AI explorer agent that works out a site on its own using UIPE's tools, records every animation it triggers, and produces a reusable site map.
- Short clips, one animation each, stored with objective measurements.
- Junk and duplicates filtered at capture time, with every rejection logged and its reason recorded.
- A full trace of every run, including the explorer's reasoning, so any clip can be followed back to the step that produced it.
- A local page to browse clips with their measurements.
- Interfaces shaped from day one so the later parts (judge panel, labeling, crawlers generated from maps) plug in without a rewrite.

**Non-goals for milestone 1** (designed for, not built)
- The AI judge panel.
- The owner's labeling screens.
- Generating scripted crawlers from site maps.
- Scale beyond a few sites, and the hosted server.
- Training the world model.

**Anti-goals** (would mean failure even if it runs)
- A dataset dominated by junk (challenge pages, cookie banners, spinners, blank or loading screens, bad cuts) or by duplicates (the same nav animation on every page, loops recorded over and over).
- Junk filtering that can't be audited. Rejections must be inspectable, not silent.
- An explorer whose behavior can't be reconstructed after the fact.
- Spending that can run away. Every AI call has a hard cap.
- Evading bot protection. The crawler identifies itself and honors robots.txt.

## 3. Constraints

- **Budget:** about $100/month total at steady state (hosting, AI, storage). Milestone 1 runs locally and should cost single-digit dollars, mostly explorer API calls.
- **Hardware:** the owner has an Intel Mac. No CUDA, no Apple Silicon. Milestone 1 must run on it.
- **Stack:** extend the existing TypeScript pnpm workspace (`ui-perception-engine/`). Reuse `@uipe/core`'s Playwright/CDP browser layer, `TemporalEventStream` and its collectors (`packages/core/src/pipelines/temporal/collectors/`: animation, input, mutation, network, optical-flow, phash), the component-index fingerprints (`packages/core/src/pipelines/component-index/fingerprint.ts`, `computeSignature`), and the MCP tool surface (`navigate`, `get_scene`, `get_affordances`, `act`, `get_screenshot`, `get_timeline`, `get_component_index`, `start_perception`, `stop_perception`, `get_perception_session`, ...).
- **No GPU tiers needed.** The measurements that matter for animation quality (CDP animation and frame timings, optical flow, DOM) all run on CPU. The VLM detection tier and the OmniParser sidecar are not dependencies here.
- **Repo conventions apply:** TDD, `.js` import extensions, shared types only extended with optional fields, external services mocked in tests, 1280x720 default viewport, lossless PNG for any frame that goes to a vision model.
- **Legal:** recorded clips copy third-party designs. The dataset stays private and research-only. No raw clips are redistributed. Legal review before any commercial use.

## 4. What the owner decided

These are the owner's decisions, as made:

- The dataset's consumer is the **world model** (#6).
- The dataset is about **taste in web animation** and how to debug it, and should be **as large as possible**.
- An **AI explorer agent** explores each site intelligently; **efficient scripted crawlers** generated from what it learns come later. The explorer records as it explores.
- Taste is judged by **a well thought out AI judge panel**.
- The owner **will hand-label a starter set**, and it must be **as painless as possible**. Format: **pairwise comparisons** ("which of these two is better") for the starter set, then **reviewing judge verdicts** to check the judges.
- **The owner's labels carry more weight than the judges'.**
- Budget **about $100/month to start**.
- **Milestone 1** = "a few sites crawled end to end with browsable clips."
- **Build it right from the start:** the real AI explorer drives milestone 1, not a stand-in crawler.
- **Failure** = clips that are mostly junk or duplicates.
- **Scope of motion in milestone 1:** animations the explorer triggers **plus page-load entrances and scroll-driven animation.**
- **Milestone-1 pass thresholds** (accepted from the designer's proposal):
  - kept-clip junk rate ≤ 20%, measured by the owner hand-checking a random sample of 40 kept clips
  - duplicate rate among kept clips ≤ 10%
  - at least 15 unique animation episodes per site

## 5. System shape

Five parts, each behind its own interface so it can be swapped or run elsewhere:

```
            ┌──────────────┐  tool calls   ┌──────────────────────────┐
            │  Explorer    │──────────────▶│  UIPE engine (@uipe/core) │
            │  agent loop  │◀──────────────│  browser, collectors, MCP │
            └──────┬───────┘   results     └────────────┬─────────────┘
                   │ decisions                          │ timeline events
                   ▼                                    ▼
            ┌───────────────────────────────────────────────────────┐
            │  Recorder: segment → measure → filter → dedup → clip   │
            └──────────────┬────────────────────────────┬───────────┘
                           │ clips + measurements        │ site map
                           ▼                             ▼
            ┌──────────────────────┐          ┌─────────────────────┐
            │  Store (local disk;  │          │  Site map (#5)      │
            │  R2 later)           │          │  states + actions   │
            └──────────┬───────────┘          └─────────────────────┘
                       ▼
            ┌──────────────────────┐     everything above writes to:
            │  Clip browser (local │     ┌─────────────────────────┐
            │  web page)           │     │  Trace + run report      │
            └──────────────────────┘     └─────────────────────────┘
```

### 5.1 Explorer agent

- An AI model in a loop, calling UIPE's MCP tools to work a site out. It decides what to try next, notices when something animates, and builds the site map.
- **Model:** called by API through a narrow interface (`ExplorerModel`), so the model can be swapped. Default: a mid-tier Claude model (the builder picks the exact current id), because exploration needs judgment about what's worth trying. A cheap model may be used for routine steps if testing shows it holds up.
- **Hard caps per site:** maximum steps, maximum spend in dollars, maximum wall-clock time. Hitting a cap ends the site cleanly and is recorded in the report. Defaults are the builder's call; they must keep a milestone-1 site in single-digit dollars.
- **Exploration intent,** in priority order: reach distinct UI states (pages, opened menus/modals/tabs, expanded sections); trigger interactions likely to animate (hover, click, focus, scroll, open/close); revisit states only when it might reveal an unseen animation.
- **Safety rails:** stays on the start site's origin; never submits forms with real effects (purchases, sign-ups, messages); never logs in; avoids destructive-looking controls. Untrusted page content stays inside the existing `<untrusted_page_content>` envelope (Track 2), so a page can't steer the agent.
- **Output:** the actions it took (into the trace), the site map, and the moments where animation happened (handed to the Recorder).
- **Process layout:** one process owns the browser. The explorer calls UIPE's existing MCP tool handlers in-process, through the same tool layer that applies the `<untrusted_page_content>` envelope, so the Track 2 protections cover it without re-implementing them. The Recorder attaches to the same page's CDP session directly, for screencast, tracing, animation target nodes and media emulation, which no MCP tool exposes. Running the explorer's model elsewhere stays possible, because it only ever sees tool results. *(Designer's call, from the builder check.)*

- **Passive motion:** on arrival at each new page the explorer waits and records the page-load entrance before acting. It scrolls deliberately, in steps and at a steady pace, through each page, so scroll-driven and scroll-linked animation is captured. Each scroll step is a trigger in the trace and the site map.

### 5.2 Recorder

Turns the timeline around each action into candidate clips, then measures, filters and deduplicates them.

- **Unit of a clip: one episode.** A clip is everything one trigger sets off, from just before the first animation starts to just after the last one settles. A modal opening is one clip (backdrop fade + panel slide + staggered children), not three. This keeps choreography and stagger inside a single clip and matches what the world model learns (state + action → what plays out). Each episode holds a list of its component animations, each with its own declared and measured values. *(Designer's call, from the builder check.)*
- **Segmentation:** an episode opens on the trigger (or the first animation start for passive motion) and closes when no animation has run for a settle window.
- **Page-load entrances** are an episode starting at navigation commit.
- **Scroll-driven animation** (CSS scroll timelines, and JS scroll-linked effects detected through optical flow and mutation against scroll position) is recorded as an episode per scroll step. Scroll position is stored alongside every frame so motion can be related to scroll, not to time.
- **Ambient loops** (marquees, autoplay carousels, background motion), other than spinners: one representative cycle is kept once per page, with the loop noted. Further cycles count as repeats. It is driven by CDP `Animation` events (start/end, duration, delay, easing, keyframes) from the existing animation collector, with optical flow and mutation events catching motion CDP doesn't report (JS-driven animation, canvas).
- **Capture: timing and pictures are separate signals.** *(Designer's call, from the builder check.)*
  - **Frame timing** comes from a Chrome performance trace recorded in real time (frame/compositor events, long animation frames). This is the authority on jank, and it is never derived from captured pictures.
  - **Pictures** come from the existing CDP screencast (`packages/core/src/pipelines/visual/frame-capture.ts`), which only sends frames on repaint and will run well below 60 fps on the Mac. Record the actual frame times and the achieved rate with every clip; don't pretend it is 60 fps. Use a cheaper encoding than per-frame PNG for the video, so capture doesn't cause the jank being measured. Keep a few lossless PNG keyframes.
  - Deterministic frame stepping (virtual time) is not used, because it would erase the real-time jank measurement.
  - The 10 fps, ≤480 px samples future judges need are derived later from the stored pictures.
- **Measurements stored with each clip:**
  - declared vs measured duration, delay, easing (fitted from motion)
  - declared vs actual end state (the existing animation-prediction deviation)
  - frame timing: dropped frames and long animation frames, from CDP frame timing (not from sampled frames; a 16 ms drop is invisible to sampling)
  - layout shift during the clip
  - flashing, per the WCAG 2.3.1 general and red flash thresholds, computed on frames
  - reduced-motion behavior: the same action replayed with `prefers-reduced-motion` emulated, and the motion difference. **Best effort in milestone 1:** reload, replay the path from the site map, and trigger again. If the state can't be reached again, or the action looks like it has side effects, record "not reproducible" instead of forcing it. *(Designer's call.)*
  - context: URL, page state id from the site map, the action that triggered it, the target element's structure and component-index signature
  - **before and after state:** the scene graph (`get_scene`) and a lossless screenshot immediately before the trigger and after the episode settles. This is the world model's `(state_t, action, state_t+1)` tuple from roadmap Track 3, and it can't be recaptured later without re-crawling, so it is in milestone 1. Latency and success of the action are recorded too.
- **Junk filter** (rejects at capture; logs each rejection with its reason):
  - blocked or broken pages: bot challenges, login walls, error pages, blank or still-loading screens
  - noise: cookie/consent banners, chat widgets, ads, spinners and loading indicators
  - bad cuts: animation already running at clip start or not settled at clip end; target off-screen or covered; "motion" that is actually a playing video or GIF
- **Deduplication:**
  - Fingerprint = target element's component-index structural signature + keyframes + duration + easing.
  - Plus a perceptual hash over the clip's frames, for animations CDP can't describe.
  - A repeat becomes a count on the original clip (with every place it was seen), not a new clip. "Seen on 40 pages" is kept as data.

### 5.3 Site map

- Per site: states (a page or UI configuration, identified by URL plus a structural fingerprint of what's on screen) and transitions (the action that moves between two states, and the clips that action produced).
- Saved in a documented, versioned format that a future crawler can replay without the explorer. This is the seed of roadmap #5.

### 5.4 Store

- Milestone 1: local disk, one directory per run.
- Later: Cloudflare R2 (research: about $1/month at 16k–38k clips, no egress fees).
- Behind a `ClipStore` interface so the switch is configuration.
- Every stored clip carries a schema version.

### 5.5 Clip browser

- A local web page. Browse clips grouped by site and by kind (modal, dropdown, hero entrance, tab switch, ...), and play any clip with its measurements beside it.
- Also shows rejected clips with their rejection reasons, so the junk filter can be audited by eye.
- Kind classification is a builder detail (heuristics from the target element and action are enough for milestone 1).

### 5.6 Known gaps in what's being reused

Found by the builder check. These must be fixed as part of this work, not worked around:
- The animation collector closes an animation on a `duration + 16 ms` timer and treats per-iteration duration as the total, which truncates multi-iteration animations (already a recorded bug). Episodes must close on observed end and settle, not on a timer.
- The animation collector doesn't report which element an animation targets. Episodes need the target node, for fingerprints, context and dedup.

## 6. Trace and run report: the harness

**Trace.** Every run writes an append-only, structured event log, with one record per:
- explorer step: what it observed (summarized), what it decided and why, the tool call, the result, tokens and dollars spent
- clip candidate: kept, rejected (with reason), or merged as a duplicate (with which clip)
- error, cap hit, or retry

Every record carries a run id, site, step number and timestamp, and every clip links back to the trace records that produced it. This is what makes "why does this clip look wrong" answerable, and what later evals run against.

**Run report,** generated at the end of each run, quality first:
- clips kept, junk rejected by reason, duplicates collapsed, unique animations per site
- **junk rate and duplicate rate on the first line**, since those are the anti-goal
- coverage: states and transitions found, caps hit
- cost: explorer spend per site and per kept clip

**Evals the trace enables** (milestone 1 ships the first two):
- junk-filter precision: a sample of kept and rejected clips checked by hand in the clip browser
- duplicate rate across runs of the same site (determinism and dedup quality)
- later: explorer coverage vs a human walkthrough; judge agreement with the owner's labels

## 7. Later phases (designed for now, built after milestone 1)

**Judge panel.**
- Four cheap models from different vendors on every clip, in batch mode.
- Escalate to a stronger panel when the judges disagree, when a pairwise verdict flips with clip order, or when a verdict contradicts the measurements.
- Research budget: about 16,500 clips/month within $100.
- Lenses:
  - performance and accessibility are decided by measurements, not by judges
  - motion craft is judged with the measurements given as text
  - purpose is judged primarily by the panel
- Judges see sampled frames plus measurements; research found native video gave no gain.
- Expect only 60–75% agreement with a human. Hence the trust order below.

**Labeling.**
- Starter set: pairwise, keyboard-only, same-kind pairs, ← / → / "can't tell", saved continuously.
- Size: 150 pairs gives about ±7 points of agreement overall (±15 per lens). About 320 pairs reaches ±5.
- After that, spot-check judge verdicts with Y/N, explaining only on disagreement. Sampled at random, plus every clip where judges split.
- Pairs are chosen where they're most informative, and grow over time through the spot-checks.

**Trust order** (owner's decision that owner labels outrank judges):
1. owner labels: gold, never blended into a score, kept as their own field
2. measurements: decide performance and accessibility outright
3. judge verdicts: soft labels with a confidence from panel agreement and track record against the owner

All three are kept per example, with their source, so weighting is a training-time choice.

**Crawlers from maps.** Replay and vary (timing, scroll position, action order) the paths in a site map with no AI in the loop. This is how volume scales.

**Hosting.** A Hetzner CX33 (about $10.59/month) for the always-on crawler, with R2 for storage. Throughput (estimated at 2–4 concurrent Chromes) must be benchmarked before scaling.

## 8. Crawling rules

- Identify the crawler with a user agent and a contact URL. **The URL is a required config value the owner supplies before the first real crawl.** The crawler refuses to run without it. Tests use a placeholder.
- Honor robots.txt: re-fetch every 24 hours, and on a 5xx treat the site as disallowed.
- Polite rate limits per origin.
- Stay logged out.
- No bot-protection evasion. A challenge page is detected and recorded as junk, never fought.

## 9. Left to the builder

- Exact explorer model id, prompts, cap defaults, and stop conditions within the caps.
- Clip encoding format, keyframe count, trace storage format.
- Clip-kind classification method.
- How "settled" is detected at the end of a clip.
- Fingerprint details and perceptual-hash thresholds.
- Clip browser layout.
- Module boundaries inside the workspace (new package vs inside `@uipe/core`).

## 10. Decisions made by the designer (not the owner)

Flagged for the owner to check:

- **Milestone 1 runs on the owner's Mac, headless**, with interfaces that let it move to the server unchanged.
- **The explorer is a mid-tier Claude model by API with hard caps.**
- **Performance and accessibility are measured, not judged** (from the research).
- **Clips are captured at 60 fps and stored once**; lower-rate samples for judges are derived later.
- **Repeats are kept as counts, not discarded.**
- **Ambient loops are kept as one representative cycle per page.**
- **Passive motion is captured by the explorer pausing on page load and scrolling in steps.**
- **The milestone-1 sites are picked by the owner.** If the owner hasn't picked, the default is a few animation-rich sites from award galleries, used as a URL list only.
- **The dataset stays private and research-only** until it has had a legal review.
