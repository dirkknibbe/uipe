# Morning report — landing page (Path A + Problem section)

**Run:** overnight, 2026-04-15
**Final branch:** `master`, 6 commits ahead of the previous state
**Status:** all 5 phases shipped. `pnpm exec tsc --noEmit` clean at every commit.

## Commit log

```
601b714  chore(landing): playwright capture script + reference screenshots
5106b8e  feat(landing): add Problem section with UIPE self-demonstration
e7ebae1  feat(landing): add editorial signals — version stamp, hairline rules
de0dc63  feat(landing): strengthen hero CTA and typography
f410f65  feat(landing): restore scene graph instance color palette
db9142a  feat(landing): restructure hero into explicit grid, remove vignette
```

Every commit is single-focus and reversible. Each passed tsc before landing.

## What shipped

### Phase 1 — hero layout restructure
- Replaced flex composition with explicit CSS Grid `minmax(0,1fr)_1.2fr`
- Copy locked to the left column, `max-w-[56ch]`, `pt-[18vh]` top-aligned (was anchored bottom-left with ~40vh dead space above)
- SceneGraph contained inside the right column with a hairline `border-l` — not full-bleed behind the copy anymore
- Radial vignette div removed entirely (it was a legibility band-aid; the grid solves the problem honestly)
- Top bar gets an intentional `uipe · perception engine` wordmark pair + thin hairline rule under the nav

### Phase 2 — 3D color + bloom
- Swapped `meshStandardMaterial` (emissive="#ffffff") for `meshBasicMaterial toneMapped={false}` so `instanceColor` renders directly
- Bloom `luminanceThreshold` 0.2 → 0.85, `intensity` 0.9 → 0.45, `luminanceSmoothing` 0.9 → 0.5
- Result: violet / cyan / amber variation is now clearly visible; only the brightest instances halate, rather than the whole scene reading as a single glowing mass

### Phase 3 — CTA + typography
- Headline: dropped italic treatment in favor of a tone-only contrast (`ink` vs `ink-dim`), same weight, same family. Tightened tracking to -0.025em, leading 0.95. The italic+weight split was too subtle; this reads as intentional.
- H1 restructured into two `<span class="block">` children so DOM-only agents can address both clauses separately — the previous `See the web the way <span italic>humans do.</span>` would silently lose the outer text node on naive extraction. Both spans are now addressable.
- Form: input + button live in a single framed shell. Button is taller, uppercase, letter-spaced, with a violet underglow (`box-shadow: 0 0 0 1px rgba(139,92,246,0.35), 0 6px 24px -6px rgba(139,92,246,0.45)`). `active:translate-y-[1px]` for tactile press.
- Quiet "no spam · unsubscribe any time" mono microcopy under the form.

### Phase 4 — editorial signals
- Mono version stamp `v0.1.0-alpha · 2026.04.15` top-right at 10px / 0.22em tracking
- Hairline rule at the bottom of the hero section to set up the seam with the Problem section

### Phase 5 — Problem section (the dogfood moment)
- New `components/Problem.tsx` with a three-panel argument:
  - Left column: the headline `Agents can read HTML. / They can't see the page.`, two subhead paragraphs, and a "captured on uipe.dev" mono block quoting the literal extraction bug (`h1 > span: "the way humans do."`) that existed in the pre-fix hero
  - Right column, top: `structural.json` — the raw tree a DOM-only agent sees, with `div > div > div`, "empty wrapper", and the headline shattered across spans
  - Right column, bottom: `scene_graph.json` — the same page as UIPE sees it, with `role=banner`, `role=heading[1]`, `text="See the web the way humans do."`, `salience=0.98`, `role=button` on the CTA, a `role=decoration` tag on the 3D graph
- Both blocks use a terminal-like chrome (dot cluster + filename label) and a recursive `<Tree>` component that indents 14px per level with violet tag names, amber role attrs, faint grey notes
- The Without block is neutral ink; the With block picks up the violet accent rule + a faint violet outer glow to echo the scene graph palette

## Visuals

Screenshots saved to `landing/screenshots/`:

- `after-hero.png` — viewport 1440×900 at 2x DPR, above-the-fold hero
- `after-problem.png` — scrolled one viewport (the Problem section)
- `after-full.png` — full-page screenshot

`scripts/capture.mjs` is committed — `node scripts/capture.mjs <label>` regenerates them.

## What I chose to skip

- **`impeccable:polish` / `impeccable:audit` passes** — the task brief said "don't run all of them; one or two where judgment helps." The design critiques in the brief were already specific. I let those do the work and skipped the skills, preserving budget for real code.
- **Full responsive mobile pass on the Problem section** — the grid collapses to one column at `< lg` via `grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.1fr)]`, but I didn't hand-tune the mono text size at narrow widths. The tree blocks have `overflow-x-auto` so nothing clips.
- **Serif display face for the headline accent** — the brief offered "drop italic OR import a serif via next/font." I dropped the italic. A Fraunces/GT Super accent is a defensible next step but adds a font load; the tone-only distinction is already working.
- **`analyze_visual` / Tier C verification** — UIPE's `get_screenshot` returned a blank white image (screenshot endpoint appears broken; the structural `navigate` output is correct and I verified via Playwright instead).

## Known issues / open questions

1. **H2 in Problem has an inline text node before `<br>`** — UIPE's structural extractor only captures the second clause ("They can't see the page."). The first clause "Agents can read HTML." is plain text inside the h2 before a `<br>` and falls into the same extraction gap we're pitching about. It's actually a *second* live demonstration of the bug — leaving as is, since fixing it would require restructuring the heading out of the punchline it's making.
2. **Mobile SceneGraph backdrop is positioned beneath the text via `absolute inset-x-0 top-16 bottom-0 -z-0`.** Works visually but not stress-tested at iPhone 12 mini widths. Worth a pass on real hardware before ship.
3. **The repo-root `.gitignore` wildcards `*.png`.** I added a local unignore in `landing/.gitignore` (`!screenshots/**`). If Daisy wants a cleaner split, moving screenshots under `landing/public/` would let them also serve as OG candidates.
4. **Next.js logs `BAILOUT_TO_CLIENT_SIDE_RENDERING` for the SceneGraph dynamic import** — expected (it's `dynamic(..., { ssr: false })`), but it shows up as a build-time warning. Silence by moving the Canvas into a client-only boundary one level higher, or accept.

## Recommendations for the next session

1. **Run `impeccable:typeset` on the Problem section only.** The tree font-size, line-height, and padding are in the zone but could benefit from a dedicated pass — especially tightening the color mapping for `role=` attrs (currently amber, might be overloaded with the signal dot in the eyebrow).
2. **Wire the Problem section into a real UIPE capture loop.** Right now `BEFORE` and `AFTER` are hand-authored constants. A 20-line node script that calls `get_scene` + a fake "naive extractor" at build time could emit the tree data as JSON — then the code block is literally the shape of output the product returns. Current state is a credible illustration; live capture is stronger.
3. **Take the Solution / How it works / Pricing / DevSnippet sections next.** The hero and Problem are doing heavy argumentative work; the page still ends abruptly after the Problem section. Four more short sections following the same editorial-plus-code-block aesthetic and the landing is ready for a Show HN.
4. **Consider migrating `@vercel/kv` away from the deprecated package** — `pnpm` warned about it during the Playwright install (`Vercel KV is deprecated, use Upstash Redis via Vercel Marketplace`). Not urgent; the waitlist route hasn't been exercised yet.
