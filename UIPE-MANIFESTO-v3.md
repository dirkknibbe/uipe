# UIPE: The UI Perception Engine

## Manifesto

**UIPE gives AI agents the ability to experience time the way humans do.**

Every tool in the browser automation space today sees the web as a series of snapshots. Screenshots. DOM dumps. Accessibility trees frozen at a single instant. They can tell an agent what a page *looks like*. None of them can tell an agent what a page *feels like*.

Humans don't experience the web in snapshots. We experience it as a flow — a temporal sequence of events, transitions, responses, and rhythms that either carry us forward effortlessly or break our concentration and make us leave. The 3-second dead zone after clicking "Submit" with no visual feedback. The janky nav animation running at 24fps. The layout shift that moves the button right as we reach for it. The error message that appears from nowhere with no transition. These aren't visual bugs. They're temporal bugs. And no existing tool can see them because no existing tool experiences time.

UIPE can. It navigates a URL, interacts with the page, and perceives the experience as it unfolds — just like a human sitting in front of the screen. Then it tells the agent exactly what felt wrong and why, grounded in cognitive science, not opinion.

---

## Core Thesis

**Taste in UI is not about how things look. It's about how things feel over time.**

The static properties of a design — color, typography, layout, spacing — are the grammar of visual communication. Getting them wrong is illiteracy. Getting them right is necessary but not sufficient. What separates a competent UI from a brilliant one is temporal flow: rhythm, pacing, anticipation, and recovery.

These temporal qualities have objective ground truth rooted in human neurobiology:

- **Rhythm**: Do transitions use a coherent timing language, or are some 150ms and others 600ms for no reason? Inconsistent rhythm creates subconscious unease.
- **Pacing**: Does the experience break complex tasks into digestible temporal chunks? Does it overwhelm at the start and drag at the end?
- **Anticipation**: Does the UI telegraph what's about to happen? A button that responds on hover tells the user "something will happen." A page that snaps to a new state with no warning violates temporal expectation.
- **Recovery**: When something goes wrong — an error, a long load, an unexpected state — does the experience give the user a cognitive off-ramp, or dump them cold?

A human nervous system processes sequential information according to predictable cognitive phases: Perception → Comprehension → Decision → Execution → Recovery. Each phase has its own time scale. When the UI violates these time scales, it produces measurable friction. When it honors them, it produces flow. This is not subjective. It's neurobiology.

---

## What UIPE Does

UIPE is an MCP server. An agent sends a URL. UIPE does the rest.

1. **Navigates** to the URL in a real browser (Playwright + CDP).
2. **Interacts** with the page — clicking, scrolling, navigating flows — like a human would.
3. **Perceives temporally** — capturing not just what's on screen, but when things change, how long transitions take, what happens between states, and where cognitive dead zones or jarring interruptions occur.
4. **Reports** a temporal flow analysis: friction points, rhythm inconsistencies, pacing problems, missing anticipation cues, violated cognitive latency thresholds.

The agent uses this to fix things no screenshot or DOM inspection could ever reveal.

### What It Catches

- Response latency: 800ms between click and button state change with no intermediate feedback
- Dead zones: 3.2 seconds of nothing after form submission
- Jank: Animation running below perceptual smoothness threshold
- Layout instability: Content shifting 1.2 seconds after the page appeared loaded
- Transition chaos: Three elements animating in at different rates with different easing curves
- Missing choreography: Error messages appearing instantaneously with no entrance transition
- Pacing violations: 7-field form presented as a single wall instead of progressive disclosure
- Rhythm breaks: Navigation transitions at 200ms but modal transitions at 600ms with no design reason for the difference

### What It Doesn't Do

- Doesn't receive screenshots or DOM data from the agent
- Doesn't store or collect data from evaluations
- Doesn't inject third-party libraries into target pages
- Doesn't require enterprise contracts or procurement
- Doesn't need ML, fine-tuned models, or external APIs to be useful on day one

---

## Architecture

### The Autonomous Driving Analogy

Self-driving cars fuse camera, LiDAR, and radar into a unified scene understanding that no single sensor could produce alone. UIPE fuses three equivalent streams for web UI:

| Autonomous Vehicle | UIPE Equivalent | What It Provides |
|---|---|---|
| Camera (visual) | CDP screenshot bursts + pHash diffing | What the page looks like at each moment, and when it changes |
| LiDAR (structural) | Lightweight MutationObserver + Accessibility tree | What the page actually is, structurally, and when elements appear/disappear/move |
| Radar (behavioral) | CDP event listeners + Network/Performance APIs | What's happening between visible changes — request timing, paint events, animation starts |

The fusion of these three streams, captured over time, produces a **temporal scene graph** — a data structure that represents not just what the UI is, but how it behaves, how it transitions, and how it feels.

### Zero Dependencies by Design

The structural stream is a lightweight MutationObserver (~15 lines) injected into the page via `Page.addScriptToEvaluateOnNewDocument`. It captures timestamped DOM changes — elements added, removed, attributes changed — and nothing else. No full DOM serialization. No replay format. No library injection. Just a list of what changed and when.

```javascript
new MutationObserver(entries => {
  for (const m of entries) {
    mutations.push({
      ts: performance.now(),
      type: m.type,
      target: m.target.tagName + (m.target.id ? '#'+m.target.id : ''),
      added: m.addedNodes.length,
      removed: m.removedNodes.length,
      attr: m.attributeName
    });
  }
}).observe(document, {
  childList: true, subtree: true,
  attributes: true, attributeFilter: ['class','style','hidden','disabled']
});
```

CDP provides everything else natively: `Performance.getMetrics()` for paint timing, `Network.requestWillBeSent` / `Network.loadingFinished` for request lifecycles, `Animation.animationStarted` for CSS animation tracking, `Page.lifecycleEvent` for load milestones, and `Page.screencastFrame` for visual capture. Playwright wraps most of this cleanly.

This means the entire UIPE perception layer has zero external dependencies — no third-party libraries injected into the target page, no API calls during capture, no overhead that could affect the very performance being measured. The capture footprint is a ~15-line MutationObserver and CDP protocol commands that Playwright already supports.

### Temporal Scene Graph

A temporal scene graph is a time-indexed sequence of fused snapshots:

```
t=0ms      User clicks "Submit"
t=0-50ms   [No visual change detected] ← friction: no immediate feedback
t=50ms     DOM mutation: button text changes
t=200ms    Spinner element appears via CSS transition (150ms duration)
t=200-3400ms [Spinner spinning, no other changes] ← dead zone: 3.2s
t=3400ms   Spinner removed, success message fades in (300ms transition)
t=3400ms   Layout shifts 18px downward ← CLS violation
```

Each entry contains: visual state diff (pHash distance from previous frame), DOM state diff (MutationObserver log), a11y tree diff, active transitions with durations and easing curves, pending network requests, and user events. The scene graph *is* the temporal experience, structured as data.

### Keyframe Intelligence

UIPE doesn't analyze every frame at 60fps. Like autonomous driving perception, it uses event-driven keyframe capture:

- **Baseline**: ~5fps passive capture with perceptual hash (pHash) diffing
- **Event burst**: When a user event fires (click, keypress), force-capture the next 2-3 seconds at higher rate to catch the full transition
- **Significant diff**: When pHash distance exceeds threshold, capture regardless of events
- **Settlement detection**: When consecutive frames produce identical hashes after a burst, mark the transition as complete

This reduces "analyze 300 frames per minute" to "analyze 5-15 meaningful keyframes per interaction" — affordable, fast, and focused on the moments that matter.

---

## Friction and Flow Signatures

The temporal scene graph contains objective signals that don't require ML or taste judgments:

### Friction Signatures (the experience broke)

- **Unacknowledged action**: User event fires, >100ms passes with zero visual/DOM change
- **Cognitive void**: State transition begins (e.g., loading), >3 seconds pass with no progress indication or content
- **Confusion cluster**: 3+ user events within 2 seconds targeting different elements (click-scroll-click-scroll = lost user)
- **Temporal whiplash**: Adjacent transitions with >3x duration difference and no semantic reason
- **Phantom target**: Layout shift moves an interactive element after the page appeared settled, causing potential misclick

### Flow Signatures (the experience worked)

- **Rhythmic consistency**: Sequential transitions maintain timing ratios within 1.5x of each other
- **Immediate acknowledgment**: Every user event produces visual feedback within 100ms
- **Progressive revelation**: Complex content appears in staged chunks with consistent inter-chunk timing
- **Graceful loading**: Skeleton/placeholder → content transition with no layout shift
- **Choreographed entrance**: Multiple elements animate in with coordinated timing and consistent easing

### Delight Signatures (the experience exceeded expectations)

- **Completion pause**: User reaches end state and pauses 1-2 seconds before navigating away (satisfaction micro-moment)
- **Exploration behavior**: After completing primary task, user voluntarily explores secondary content (engagement signal)
- **Reduced hesitation over time**: In multi-step flows, user's inter-step pause duration decreases (growing confidence)

---

## Distribution: Agent-First

UIPE's primary user is the agent, not the human developer.

### Why This Works

AI coding agents (Claude Code, Cursor, Copilot) generate enormous amounts of UI code. They produce functional interfaces but have zero feedback loop on how the experience *feels*. They ship and hope. UIPE closes that loop: agent generates UI → agent tells UIPE "go experience this" → UIPE reports what felt wrong → agent fixes it → ships with confidence.

The agent decides to use UIPE because it makes the agent's quality metrics better. The enterprise never needs to know UIPE exists. The agent's monthly report says: "23 temporal flow issues caught pre-deployment, estimated remediation savings: $11,500, UIPE cost: $0.23."

### Discovery

Organic discovery alone is not a distribution strategy. UIPE needs to be where agents find tools:

- Listed in MCP registries (GitHub MCP registry, Smithery, community directories)
- Clean README that sells the concept in one sentence: "Gives AI agents temporal perception of web UIs"
- Registered in x402 service discovery directories (Bazaar) so agents with payment capabilities find it natively
- Present in Claude Code and Cursor community channels, with real before/after examples
- A minimal landing page explaining the concept for the humans who configure their agents' toolchains

No enterprise sales. No outbound marketing. But visible in every place a developer or agent goes looking for MCP tools.

### Why There's No Data Problem

UIPE doesn't receive enterprise data. It receives a URL — the same URL the agent is already authorized to access. UIPE navigates to it in its own browser session, like a user would. It's not analyzing someone else's data. It's having its own first-person experience of a web page. The only things transmitted are a URL in and a report out.

### Pricing

Per-request micropayments via x402. The agent hits the UIPE endpoint, gets a 402 response with a price, pays, gets the temporal flow analysis back. No subscription. No API key signup. No procurement. Payment is the authentication.

#### Cost Reality

A single UIPE evaluation requires real browser compute (launching Playwright, navigating, interacting for 10-20 seconds), plus analysis. The cost floor is real:

| Component | Cost |
|---|---|
| Browser session (15s, self-hosted VPS) | ~$0.001 |
| Screenshot burst (10-15 CDP captures + pHash) | ~$0.0002 |
| MutationObserver + a11y extraction | ~$0.0001 |
| Rule-based friction analysis | ~$0.0002 |
| x402 transaction + facilitator fee | ~$0.001 |
| Infrastructure overhead (20%) | ~$0.0005 |

**Floor cost per evaluation: ~$0.003**

#### Pricing Tiers

| Tier | What It Includes | Price |
|---|---|---|
| **Scan** | Single-page evaluation. Navigates, interacts with primary flow, reports friction/flow scores with specific timestamps. | $0.01/eval |
| **Deep** | Multi-flow evaluation. Navigates and tests 3-5 interaction paths per page. Full friction analysis on each. | $0.03-0.05/eval |

At the Scan tier, catching 23 issues across a pre-deployment evaluation costs $0.23. The ROI against manual QA or post-deploy user churn is several orders of magnitude.

---

## Build Plan

### Phase 1: Perception + Detection (Weeks 1-6)

Build the temporal scene graph and friction detector together, not sequentially. The scene graph is the implementation detail; the friction report is what the agent cares about.

- Playwright + CDP screencast for screenshot bursts with pHash diffing
- Lightweight MutationObserver injection via CDP for timestamped DOM mutation capture
- CDP Performance, Network, and Animation APIs for paint timing, request lifecycles, and transition tracking
- Event stream capture with millisecond timing
- Cognitive latency threshold checks (100ms feedback, 1s progress, 10s completion)
- Rhythm consistency scoring
- Friction/flow/delight signature detection
- Structured report output: scores + specific issues with timestamps
- Single MCP tool: `perceive_flow(url, interaction_script, duration)`

Start with the simplest viable pipeline: user event fires → force-capture DOM state + screenshot for the next 3 seconds → diff against pre-event state → check friction rules. The sophisticated keyframe intelligence (pHash diffing, settlement detection) comes after the core loop works.

**Validation**: Run on 20+ real websites. Do the friction scores match your gut? Test against known-good sites (Stripe, Linear) and known-bad sites. If the detector can't tell them apart, iterate.

### Phase 2: Open Source Alpha (Weeks 6-8)

Package and publish as soon as the local MCP tool reliably catches 3-4 friction signatures on real sites.

- npm installable MCP server
- Clean README with real output examples
- Listed in GitHub MCP registry and Smithery
- MIT licensed — runs locally with zero API dependencies, zero library injection into target pages

This is the open-core foundation. Developers and agents can use UIPE for free, locally, forever. The rule-based detector is the product at this stage.

### Phase 3: Cloud Service (Weeks 8-12)

Deploy as hosted MCP endpoint behind x402 paywall.

- Self-hosted browser pool on Hetzner (CPX22 instances, ~$8/mo each, ~3 concurrent sessions per box)
- x402 middleware (Express + @x402/express) with tiered pricing
- Registration in x402 Bazaar for agent discovery
- Concurrency management — agents don't need to run their own Playwright instances

First revenue. The cloud service offers what local can't: zero-setup convenience, managed browser infrastructure, and the ability to evaluate URLs the agent can't navigate itself (e.g., public staging URLs the agent doesn't have a local browser for).

### Future: Vision Layer + ML

Not planned phases — research directions. The vision layer would add visual perception for things DOM analysis can't catch: font rendering quality, image loading states, color contrast in context, visual weight distribution, animation easing quality. Tiered approach: OmniParser V2 for fast element detection, Qwen VL for visual understanding, cloud vision API for deep analysis.

A dedicated model trained on temporal flow patterns is a possibility, but only if and when a sufficient public corpus is built from self-crawling public websites. The rule-based detector may prove sufficient indefinitely — cognitive science thresholds don't need ML to be useful.

---

## What UIPE Is Not

- Not a visual regression testing tool (Applitools does that)
- Not a browser automation framework (Stagehand does that)
- Not a screen parser (OmniParser does that)
- Not a cloud browser provider (Browserbase does that)
- Not an accessibility checker (axe-core does that)

UIPE is the temporal perception layer. It experiences the web the way a human does — over time — and tells agents what no other tool can: **how does this feel?**

---

## The Bet

Every existing tool in the browser agent space optimizes for action speed — how fast can an agent click, extract, navigate? They treat visual perception as expensive overhead to be minimized. UIPE bets on the opposite: that perception is the product. That the most valuable thing an agent can do is not act faster, but *understand deeper*. That the gap between "the page works" and "the page feels right" is where billions of dollars of user experience value lives. And that gap is entirely temporal.

No one else is building this because no one else is looking at time.

---

*UIPE — because agents deserve to feel what humans feel.*
