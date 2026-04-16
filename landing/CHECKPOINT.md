# Landing page checkpoint — 2026-04-15

## Current state

**Branch:** `master` at `5520825`
**tsc:** clean
**Dev server:** `pnpm dev` → localhost:3001
**Page flow:** Hero → Problem → Solution → How it works → Pricing → DevSnippet → Footer

## What's shipped (16 commits from `db9142a` to `5520825`)

### Hero
- Full-bleed 3D scene graph (42 nodes, nearest-neighbor edges)
- **Soft point sprites** — radial gradient texture, no hard geometry edges, additive blend + bloom
- Camera offset left + wide FOV so nodes bleed past all viewport edges
- Left-to-right gradient protects headline/subhead legibility
- Headline: "See the web / the way humans do." — tonal contrast (ink / ink-dim)
- Framed CTA pill with violet underglow ("JOIN THE WAITLIST")
- Top bar: `uipe · PERCEPTION ENGINE` wordmark + nav + hairline
- Version stamp `v0.1.0-alpha · 2026.04.15`
- Mobile: 3D as subtle 40% opacity backdrop

### Problem (§01)
- "Agents can read HTML. They can't see the page."
- Terminal-chrome before/after panels:
  - WITHOUT UIPE: `structural.json` — raw DOM tree with shattered spans
  - WITH UIPE: `scene_graph.json` — semantic roles, intact heading, salience scores
- "Captured on uipe.dev" quote block citing the actual h1 extraction bug
- Self-demonstrating: the Problem section's own H2 has a `<br>` that UIPE extracts incompletely

### Solution (§02)
- Three value props: Human-level understanding, MCP-native, Temporal awareness
- Each with a terminal-chrome code artifact on the right
- Staggered `§02·01 / §02·02 / §02·03` numbering

### How it works (§03)
- Hand-crafted SVG: four signal streams (DOM / a11y / Vision / Time) converging on a central node
- Each stream has a realistic mono label
- Four cards below explaining each signal type

### Pricing (§04)
- Three terminal-chrome tier cards: Free ($0, GitHub OAuth) / Scan ($0.03, primary) / Deep ($0.12)
- Scan highlighted with violet ring + underglow
- "Pay what a coffee costs" tonal headline
- x402 footnote in mono microcopy

### DevSnippet (§05)
- Hand-highlighted `.mcp.json` code block with copy-to-clipboard
- Editor chip row: Claude Code, Cursor, Zed, Windsurf
- Repeat waitlist CTA with "early access" eyebrow

### Footer
- Wordmark pair, mono nav (github / docs / contact), pre-launch status chip
- Bottom rail: AUP / privacy / x402 / version

## 3D iteration history (for context if revisiting)

1. **Original** — MeshStandard + emissive white + bloom 0.2/0.9. Luminous monochrome constellation. User liked it.
2. **Color fix** — MeshBasic + toneMapped=false + bloom 0.85/0.45. Colors visible but "dull."
3. **Glow restore** — Colors multiplied 1.75x + bloom 0.55/0.85. Uneven — "globby, some glow some don't."
4. **Revert to #1** — Restored monochrome. Hard sphere edges visible.
5. **Current** — Soft point sprites (radial gradient texture, no geometry). Full-bleed + left gradient. Soft, luminous, no hard edges. **This is what's committed.**

User direction: prefers soft atmospheric glow over hard geometry. Monochrome white is acceptable. Future direction: text-cloud-on-edges concept (see BACKLOG.md).

## Uncommitted / WIP

None. Working tree is clean at `5520825`.

## Infrastructure

- **Guardrail hooks** at `/Users/dirkknibbe/uipe/.claude/hooks/guardrails.py` — PreToolUse on Bash/Edit/Write/MultiEdit/mcp__*
- **Audit log** at `/Users/dirkknibbe/uipe/.claude/hooks/audit.log`
- **Playwright capture** via `node landing/scripts/capture.mjs <label>`
- **UIPE MCP** available for self-perception (structural tier stable; visual tier fixed in `3d151bb` but needs MCP process restart to pick up new dist)

## Remaining backlog (see BACKLOG.md for full list)

**High priority:**
- Motion pass — scroll-triggered section reveals, hover states, micro-interactions
- Meta & discoverability — OG image, favicon, sitemap, robots.txt
- Mobile hand-tuning — narrow viewports, terminal blocks, pricing cards

**Creative (deferred):**
- Text-cloud-on-edges hero — text fragments flowing along graph edges (fully spec'd in BACKLOG.md)
- Path B annotation overlay — UIPE output labels floating next to real hero elements

**Pre-launch:**
- Replace deprecated `@vercel/kv` with Upstash
- AUP / privacy pages (footer links point nowhere)
- Wire waitlist to real storage + export
- OG image for social sharing

## Key files

| File | Purpose |
|------|---------|
| `landing/POSITIONING.md` | Voice, audience, headlines, value props |
| `landing/PLAN.md` | 13-step build plan |
| `landing/BACKLOG.md` | Deferred creative + polish items |
| `landing/MORNING-REPORT.md` | v1 overnight run report |
| `landing/MORNING-REPORT-v2.md` | v2 sections run report |
| `landing/HOOKS.md` | Guardrail hooks explainer |
| `landing/CHECKPOINT.md` | This file |
| `landing/components/Hero.tsx` | Hero section + 3D |
| `landing/components/SceneGraph.tsx` | R3F point sprites + edges + bloom |
| `landing/components/Problem.tsx` | Before/after UIPE self-demo |
| `landing/components/Solution.tsx` | Three value props |
| `landing/components/HowItWorks.tsx` | Signal fusion SVG diagram |
| `landing/components/Pricing.tsx` | Three tier cards |
| `landing/components/DevSnippet.tsx` | MCP config + copy + CTA repeat |
| `landing/components/WaitlistForm.tsx` | Email capture form |
| `landing/components/Footer.tsx` | Footer |

## To resume

```bash
cd /Users/dirkknibbe/uipe/ui-perception-engine/landing
pnpm dev  # localhost:3001
```

Read this file + `BACKLOG.md` + `POSITIONING.md` to pick up cold.
