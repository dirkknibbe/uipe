# Landing Page Build Plan — uipe.dev

**Goal:** Ship a waitlist landing page for UIPE / MCPaaSTA in ~1-2 days of focused work. Capture email signups, demonstrate the product vision, collect signal on whether the market wants this.

**Non-goals:** Full product landing (Unit 13 in the main spec). Visual design system. Rich interactive demo (that's v2).

## Scope (v1)

One page, one CTA (join waitlist), no auth, no payments. Static + one API route.

## Stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS v4 + CSS custom properties for theme
- **Motion:** Framer Motion (Motion) for section reveals and hero animation
- **Fonts:** Inter Variable (body) + JetBrains Mono (code); Geist Variable as alt
- **Deployment:** Vercel
- **Domain:** uipe.dev (landing) + mcpaasta.uipe.dev (future product subdomain)
- **Waitlist storage:** Vercel KV (Redis) — simple, free tier fine
- **Analytics:** Vercel Web Analytics (ships with the account; decide on PostHog later)

Why this stack: fastest path to deploy, first-class Vercel integration, no backend server to run.

## Information Architecture

Single page, six sections:

1. **Hero** — headline, subhead, waitlist email capture, hero video/animation
2. **Problem** — "Your agent can see the HTML, but not the page." Before/after comparison
3. **Solution** — Three value props as cards: human-level understanding, MCP-native, temporal awareness
4. **How it works** — Minimal diagram showing the four fused signals (DOM / a11y / vision / time) → scene graph
5. **Pricing** — Free / Scan / Deep cards (aspirational — "coming soon")
6. **Developer snippet** — Copy-paste MCP config + waitlist CTA again

Footer: small links (GitHub repo, docs, about), "uipe" wordmark, tiny mention of x402.

## Design Direction

**Aesthetic:** high-end visual. Guiding skills: `impeccable:frontend-design`, `high-end-visual-design`, `design-taste-frontend`, `stitch-design-taste`.

**Visual language:**
- Dark theme primary (near-black with warm tint, e.g. `#0B0B0F`), light-theme optional v2
- Accent: a single confident gradient — deep violet → electric blue, used sparingly (one element per section max)
- Typography: large, generous, with deliberate weight contrast (display 700 / body 400)
- Motion: subtle, physics-based. Section reveals on scroll. Hero animation is the tentpole.
- No stock illustrations. No emoji. No generic SaaS gradients. No cards-with-icons-and-three-bullets feel.

**Anti-patterns to avoid** (per high-end-visual-design + design-taste-frontend):
- AI slop gradients (purple/pink blobs)
- Generic Tailwind UI hero pattern
- Centered-hero-with-gradient-orb-behind
- Too-symmetric grid layouts
- Animated gradient text for the sake of it
- Emoji in headers

**Aesthetic references** (for the design skill's internal compass):
- Linear.app (restraint, type)
- Runway.com (motion, cinematic feel)
- Vercel.com (clarity, hierarchy)
- Browserbase.com (for positioning analog — they're adjacent to us in the agent-infra space)

## Hero animation (placeholder for Kling 3.0 video)

Plan A: embed a 5-10s looping Kling video as the hero asset. Autoplay, muted, poster image for fast paint.

Plan B (while Kling is generating): CSS + Framer Motion animation of a DOM tree morphing into a scene graph. Less spectacle, ships faster.

Plan: ship B first, swap in A when the video is ready. See `landing/KLING-PROMPTS.md` for prompts.

## File structure

```
landing/
  POSITIONING.md
  PLAN.md              <- this doc
  KLING-PROMPTS.md     <- video generation prompts
  package.json
  tsconfig.json
  next.config.ts
  tailwind.config.ts
  app/
    layout.tsx
    page.tsx            (the landing page)
    api/waitlist/route.ts
    globals.css
  components/
    Hero.tsx
    Problem.tsx
    Solution.tsx
    HowItWorks.tsx
    Pricing.tsx
    DevSnippet.tsx
    Footer.tsx
    WaitlistForm.tsx
    ui/                 (primitive components)
  lib/
    waitlist.ts         (Vercel KV helper)
    analytics.ts
  public/
    favicon.svg
    og.png
    hero-loop.mp4       (added when Kling asset is ready)
```

## Build order (sequential, each step verifiable)

1. **Scaffold** — Next.js app with Tailwind + Framer Motion + TypeScript. `pnpm dev` renders a hello page. (~30 min)
2. **Design tokens** — CSS variables for color/type/spacing scale. Base layout (container, grid, rhythm). (~30 min)
3. **Hero (CSS version)** — Headline, subhead, waitlist input, CSS-animated hero placeholder. (~1-2h)
4. **Waitlist API route** — `POST /api/waitlist`, writes to Vercel KV, basic validation, rate limit by IP. (~30 min)
5. **Problem + Solution sections** — Before/after narrative, 3 value prop cards. (~1h)
6. **How it works** — Diagram component (SVG, hand-crafted). The four-signals-into-scene-graph visual. (~1-2h)
7. **Pricing + Dev snippet** — Tier cards, copy-paste config block, CTA repeat. (~1h)
8. **Footer + meta** — Footer, OG image, favicon, meta tags, sitemap, robots. (~30 min)
9. **Motion pass** — Scroll-triggered reveals, hover states, micro-interactions. (~1h)
10. **UIPE self-test** — Run the `live-deployment-check` skill + UIPE's own perception engine against the deployed site. Dog-food the product. Fix anything the agent finds confusing. (~30-60 min)
11. **Polish pass** — `impeccable:audit` → `impeccable:polish`. (~30-60 min)
12. **Deploy** — Push to Vercel, point uipe.dev DNS, verify live. (~15 min)
13. **Kling swap** — Replace CSS hero with Kling video once generated. (~15 min)

Total: ~10-14 hours of focused work. Realistic calendar: 2-3 days with breaks and iteration.

## Checkpoints where I'll want your input

- After step 3 (Hero): does the headline/visual direction feel right?
- After step 6 (How it works): is the diagram clear?
- Before step 12 (Deploy): final review of the full page before going live
- After step 13 (Kling swap): approve the video or iterate

## Waitlist storage schema

Vercel KV (Redis):

```
waitlist:{email_hash} = {
  email: string,
  referrer: string,       # utm or direct
  user_agent: string,
  signed_up_at: ISO8601,
  source_section: string  # which CTA they used
}

waitlist:index = sorted set of email_hashes by timestamp
```

Export: cron-less, just a protected admin route that dumps to CSV.

## Rate limiting

- Per-IP: 5 signups per hour
- Per-email (after hash): 1 signup ever (dedupe)
- CAPTCHA: none at launch (add Cloudflare Turnstile if abuse appears)

## Analytics events to track

- `page_view`
- `waitlist_submit_attempt` (section)
- `waitlist_submit_success`
- `pricing_card_hover` (tier)
- `mcp_snippet_copy`
- `scroll_depth` (25, 50, 75, 100)

Minimum viable analytics via Vercel's built-in. Upgrade to PostHog after signal.

## Success criteria for v1

- Page loads in <2s on 3G (Lighthouse perf >90)
- Waitlist form works end-to-end
- No accessibility violations (Lighthouse a11y 100)
- Works on mobile (tested on real iPhone + Android)
- Passes `impeccable:audit` without red flags
- Feels as good as the reference landings when we look at it next to them

## What comes after v1

- v2: add the live `analyze_visual` demo (one-tool hosted endpoint)
- v3: full designed landing (Unit 13 of the main spec) — Kling assets, interactive examples, designed-and-systemized not handcrafted
- Out of scope for both v1 and v2: docs site, blog, case studies

## Kick-off decision

Proceed with this plan → scaffold step 1 now.
