# Landing backlog

Creative directions, polish ideas, and known-but-deferred items surfaced during the build.

## v2 hero direction — text-cloud-on-edges

**Concept:** replace the pure-geometric scene graph with a living circulatory system where the nodes are understated and small mono text fragments flow along edges between them, bidirectional, color-coded by signal type:

- **DOM (violet):** `<h1>`, `<div class="hero">`, `<span>`, `aria-labelledby`, `role="banner"`
- **a11y (cyan):** `role=heading level=1`, `name="See the web..."`, `focusable`, `checked=false`
- **Vision (amber):** `primary_cta@(234,512)`, `bbox=[0,0,240,48]`, `contrast=1.2`, `salience=0.94`
- **Time (grey):** `frame_Δ=847ms`, `state_changed`, `mutation_observed`, `idle`

Each edge randomly spawns a fragment every 2-4s. Traversal 2.5s with ease-out. On arrival, receiving node briefly pulses brighter. Fragment fades in at spawn, out at arrival. ~30-50 fragments in flight at any moment.

**Why this is the strongest creative move:** the product's entire pitch is "fused perception of web signals." Right now the hero's 3D is abstract. This makes it literal — the viewer sees signals actually flowing through the network the product claims to perceive. No other dev-tool landing does this.

**Tech shape:**
- drei `<Text>` (troika SDF) for each fragment, pool of ~60 recycled instances
- `useFrame` advances `t`, lerps position between node A and node B, ease-out on opacity
- At `t >= 1`: fragment gets re-assigned to a new edge with fresh content
- Node material drops to very faint grey; text IS the aesthetic
- Content pool: 60-80 realistic UIPE-shaped fragments

**Scope estimate:** 2 hours for a solid first pass, plus iteration. Worth a dedicated session with screenshots every ~30 min.

**Why deferred:** current 3D is acceptable; shipping the full page end-to-end was the priority.

## Other v2 candidates (in rough order)

- **Motion pass** — scroll-triggered section reveals with stagger, tactile hover on Pricing cards, subtle flow animation on the How-it-works SVG (streams that actually move).
- **Meta & discoverability** — OG image (1200×630), favicon SVG, sitemap.xml, robots.txt. Quick mechanical work.
- **Mobile hand-tuning** — narrow-viewport terminal blocks, Pricing card stack, How-it-works diagram collapse.
- **Live UIPE capture at build time** — convert the hand-authored scene graphs in Problem and How-it-works into real product output via a build-time script that calls `get_scene` on the running dev server.
- **Replace deprecated `@vercel/kv`** — migrate to Upstash Redis via the Vercel Marketplace before wiring production.
- **Analytics** — decide between Vercel Web Analytics (free, simple) and PostHog (richer, more setup). Not urgent until traffic exists.
- **AUP / privacy pages** — currently footer links point nowhere real. Need actual pages before launch.
- **Waitlist storage** — currently in-memory for dev, KV stub for prod. Wire a real store and an export route.
- **Demo endpoint** — hosted `analyze_visual` behind rate limits so visitors can try one tool without signing up. Highest-leverage "make it real" move.

## Dogfood opportunities

- The Problem section's own H2 has a pre-`<br>` text node that UIPE extracts incompletely. Could be framed more explicitly ("this page has two of these — can you spot the second?") as meta-humor.
- Every time we add a section, run UIPE on the live page and make sure the structural output tells the same story we're claiming it does. If we drift, the demo drifts.

## Known small issues

- `landing/scripts/capture-section.mjs` has a stale TS-hint about `await` — non-blocking, cosmetic.
- `BAILOUT_TO_CLIENT_SIDE_RENDERING` warning for the SceneGraph dynamic import — expected given `ssr: false`, but loud in the build log. Moving the Canvas into a dedicated client boundary one level up would silence it.
