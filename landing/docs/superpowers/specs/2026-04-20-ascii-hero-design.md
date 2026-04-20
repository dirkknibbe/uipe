# ASCII Scene-Graph Hero — Design Spec

**Date:** 2026-04-20
**Scope:** Replace the R3F hero (`components/SceneGraph.tsx`) on `landing/` with an ASCII-rendered scene graph, inspired by libretto.sh and the existing v2 backlog note `refs/v2-hero-text-cloud.md`.
**Target:** `landing/` — the waitlist landing. The main app is untouched.

## Why

- The current R3F hero is abstract — nodes and edges on a sphere. It looks fine, but it doesn't carry the product thesis ("fused perception of DOM / a11y / vision / time").
- Libretto.sh demonstrates that dense ASCII-rendered 3D, behind hero copy, reads as confident and editorial.
- UIPE's scene-graph-of-signals is *literally* a graph — representing it in ASCII, with data packets visibly flowing between nodes, makes the product do its own talking.
- Time is UIPE's real differentiator. The current palette treats `time` as grey noise; this redesign reserves the most confident color for it.

## Non-goals

- Not rebuilding any section other than the hero.
- Not swapping the whole-site theme — dark stays dark.
- Not shipping a Kling video (remains a v3 BACKLOG candidate).
- Not building a glyph-atlas shader approach (considered, rejected as over-scope).
- Not shipping live UIPE data. Content pool is static, handcrafted to match UIPE output shapes.

## Locked decisions (from brainstorm)

| Decision | Value |
|---|---|
| Framing | B — product expression. Scene graph concept retained; ASCII is the medium. |
| Mouseover | A (node hover reveals label) + B (cursor ripple on ambient field). |
| Data packets | A (four signals, color-coded) + 2 (medium cadence — ~5-8 in flight). |
| Theme / mobile | A (keep dark, glowing ASCII) + 2 (lite animation on mobile — reduced density, half-cadence, no ripple). |
| Technical approach | 3 — pure `<canvas>` + lightweight custom 3D. R3F deleted from hero path. |
| Palette | B — Ember: sky / lavender / bone / ember. `time` is the warm protagonist. |

## Palette

All values are used as CSS custom properties on `:root` (`landing/app/globals.css`), scoped to the hero.

| Signal | Color | Hex | Role |
|---|---|---|---|
| DOM | sky | `#7dd3fc` | structural; recedes |
| a11y | lavender | `#c084fc` | semantic layer |
| vision | bone | `#d4d4d8` | low-saturation support |
| **time** | **ember** | **`#ff6b35`** | **protagonist — most saturated, most movement attached** |

Ambient (non-signal) ASCII glyphs render in `var(--color-ink-faint)` (existing) — reads as dim noise; signal-specific cells layer on top.

## Architecture

Three pure modules + one React component + a content pool.

```
landing/components/AsciiScene/
  index.tsx          React: canvas, RAF, mouse/resize, DOM label overlay
  scene-model.ts     pure data: nodes, edges, packets, tick(dt)
  project.ts         pure math: rotate3, perspective project, NDC
  render-ascii.ts    pure: projected scene + cursor → char-grid buffer
  content-pool.ts    static: 4 signal dictionaries (~20 fragments each)
  __tests__/         unit + snapshot tests (vitest)
```

Hero.tsx stays the same shell — only the `SceneGraph` import is swapped for `AsciiScene`.

**Deleted:** `components/SceneGraph.tsx`.
**Removed deps** (after verification they're not used elsewhere in `landing/`): `@react-three/fiber`, `@react-three/postprocessing`, `three`, `three-stdlib`.

### Why these boundaries

- `scene-model.ts` is the only stateful piece — everything else is a pure function of its output. Advances packets, spawns/recycles them, knows nothing about rendering.
- `project.ts` is pure math, ~40 LOC. Trivially testable.
- `render-ascii.ts` is pure — takes `(projected, cursor, tick) → string[][]`. Renders the ambient field, rasterizes edges, places nodes, stamps packet text, and applies the cursor ripple. Snapshot-testable without a canvas.
- `AsciiScene/index.tsx` is the only part that touches the DOM. It owns the canvas ref, mouse ref, RAF loop, and the DOM overlay for hover labels. Everything else it imports is pure.

## Data model

```ts
type Signal = "DOM" | "a11y" | "vision" | "time";

type Node = {
  position: [number, number, number];  // on sphere r ≈ 2.4
  signal: Signal;                      // 10 nodes per signal
  phase: number;                       // pulse phase offset
};

type Edge = [number, number];          // node indices

type Packet = {
  edgeIdx: number;
  progress: number;                    // 0..1, traversal ~2.5s
  content: string;                     // from content-pool[signal]
  signal: Signal;
};

type Scene = {
  nodes: Node[];        // ~40, seeded stable
  edges: Edge[];        // ~60, nearest-neighbor
  packets: Packet[];    // ~5-8 in flight on desktop
  spawnClock: number;   // timer for next Poisson packet
};
```

## Content pool

**Target 20 entries per signal (80 total), minimum 15.** Each entry is a single-line fragment ≤ 40 chars so it fits on a grid cell row. Examples:

```
DOM     "<h1>"  "<button.primary>"  "aria-labelledby"  "role=\"banner\""
a11y    "role=heading level=1"  "name=\"See the web...\""  "focusable"
vision  "primary_cta@(234,512)"  "bbox=[0,0,240,48]"  "salience=0.94"
time    "Δ=847ms"  "state_changed"  "mutation"  "idle"  "frame_Δ=33ms"
```

On each spawn, pick the next entry from a shuffled queue of fragments matching the packet's signal. When the queue is empty (all fragments consumed), reshuffle and refill. Never repeat the same fragment twice in a row on the same edge.

## Frame pipeline (per ~16ms)

1. **`tick(dt)`** — advance packet progress; recycle finished packets; Poisson spawn (target 5-8 in flight on desktop, 2-3 on mobile).
2. **Rotate + parallax** — `rot.y = t * 0.08 + mouse.x * 0.12`; `rot.x = sin(t * 0.05) * 0.15 + mouse.y * 0.12`.
3. **Project** — transform each node's 3D position to NDC `(u, v, depth)`.
4. **Render** — fill ambient char grid with dim noise glyphs; rasterize edges between projected node cells using a density ramp by depth (`· : . ~ ;`); place a brightest glyph per node; interpolate packet positions along edges and stamp packet text; apply cursor ripple post-pass.
5. **Paint** — `ctx.fillText` one row at a time (60 rows → 60 draw calls). Color pass: second pass over signal-colored cells to apply palette.

## Interactivity

### Node hover → reveal label

- On `pointermove`: compute nearest node within 40px of cursor (using same projected `(u, v)`).
- If found, set `activeNodeIdx` and render a DOM `<div>` positioned absolutely at that projected point. Label = `"{signal} · {random content-pool entry for that signal}"`, color per palette.
- Fade in 120ms, fade out 200ms on exit. Only one label visible at a time.

### Cursor ripple

- In `render-ascii`, after the scene rasterizes into the char grid, run a post-pass: for each cell within 120px of the cursor, compute `d = sin(dist * 0.1 - t * 4) * exp(-dist / 120)`.
- If `|d| > 0.3`: swap the glyph with an adjacent one in the density ramp and shift its column by `round(d * 2)` cells. Clamp to grid bounds.
- Disabled on touch devices (no cursor).

### Mobile lite mode

Triggered by `matchMedia("(pointer: coarse)")` OR viewport width < 768px:

- Grid 60×24 (down from ~247×60); render char size increases to ~14px for readability.
- Packets at half cadence (2-3 in flight).
- No cursor ripple.
- Node hover becomes tap-to-reveal: tap anywhere → nearest node's label sticks for 2s.

### Reduced motion + accessibility

- `prefers-reduced-motion: reduce` → static single-frame render, no packets, no rotation, no ripple.
- `<canvas aria-hidden="true">`.
- Sibling `<p class="sr-only">` describes the scene for screen readers: *"An animated graph of nodes representing DOM, accessibility, vision, and time signals, connected by edges with data packets flowing between them."*

### Resize handling

- `ResizeObserver` on the wrapping div. 150ms debounce → recompute grid dimensions, resize canvas accounting for `devicePixelRatio` (capped at 2). Scene model is untouched — only the 2D projection changes.

## Testing

### Unit — `project.ts`

10-15 cases covering: identity rotation, perspective projection of axis-aligned points, clipping at NDC bounds, rotation composition. Pure math; runs in <50ms.

### Unit — `scene-model.ts`

- `tick(dt)` advances packet progress proportionally.
- Packets recycle at `progress >= 1`.
- Poisson spawn keeps packet count in 3-10 over 10s simulated runs.
- Content pool correctness: `packet.content` is always drawn from the pool for its `signal`.

### Snapshot — `render-ascii.ts`

Freeze clock, fixed scene, fixed cursor. Compare output char grid (a `string[][]`) to a committed snapshot. Catches unintentional rendering drift without pixel diffs.

### Integration — Playwright

One test: navigate to landing, wait for canvas, screenshot, compare to baseline at fixed animation time (use `window._asciiSceneSetTime(0)` test hook). Tolerate 0.5% pixel diff for font AA variance.

## Success criteria

- Lighthouse **Perf ≥ 90**, **A11y = 100** on desktop and mobile.
- Hero path bundle reduces by **≥ 150KB gzip** versus `master`. If achieved bundle saving is less than 100KB, flag and discuss — still worth doing for the control, but we should know.
- Frame time **< 16ms** on Dirk's Intel Mac at 247×60 grid.
- Chrome / Safari / Firefox latest 2 versions; older fall back to static snapshot.
- Axe-core: zero violations.
- Dogfood: run UIPE's `analyze_visual` on the deployed hero; confirm CTA and headline are correctly identified (this is the whole brand promise).
- Subjective: passes side-by-side gut-check against linear.app / runway.com / browserbase.com during `impeccable:audit`.

## Risks

- **fillText on high-DPR displays** — Retina quadruples pixel work. Mitigation: cap `devicePixelRatio` at 2; benchmark on a 4K monitor before shipping.
- **Content repetition** — 80 fragments cycled at ~6 packets/sec repeats every ~13s. Mitigation: shuffle on full cycle; keep fragments varied in *shape* (short token vs attribute pair vs assertion).
- **Ripple vs hover label orthogonality** — ripple displaces glyphs; the DOM overlay is positioned by projected `(u, v)` not by char cells, so they should not interact. Verify once built.
- **Bundle-shrink claim is theoretical** until the rewrite lands. Track actual numbers; if significantly under 150KB, revisit whether the delete-R3F part of the design is worth the churn.
- **Motion is hard to judge from text spec.** Addressed by Phase 0 (below).

## Phase 0 — Motion spike (before committing to full rewrite)

Throwaway prototype, ~2 hours, lives on a branch. Minimal scope:

- One-file React component (~300 LOC) rendering directly into a canvas.
- Stub scene: 12 nodes on a sphere, 20 edges, 3 packets in flight.
- Full rotation + parallax + packet interpolation + cursor ripple.
- Placeholder content pool (~5 fragments per signal).
- No hover labels, no mobile mode, no tests.

**Checkpoint:** Dirk looks at it in the browser. Specifically evaluate: (1) does the ASCII density feel libretto-like without becoming noisy, (2) does the packet flow read as "data moving" or as "random characters," (3) does the cursor ripple feel alive or glitchy. If yes on all three, proceed with the full rewrite exactly as specced here. If no on any, we revise that aspect of the spec *before* writing production code. This is the answer to "hard to picture until it's done."

## File-touch summary

**Created:**
- `components/AsciiScene/index.tsx`
- `components/AsciiScene/scene-model.ts`
- `components/AsciiScene/project.ts`
- `components/AsciiScene/render-ascii.ts`
- `components/AsciiScene/content-pool.ts`
- `components/AsciiScene/__tests__/*.test.ts`
- `tests/e2e/ascii-hero.spec.ts` (Playwright)

**Modified:**
- `components/Hero.tsx` — swap `SceneGraph` for `AsciiScene` in the dynamic import
- `app/globals.css` — add palette B custom properties (signal colors)
- `package.json` — remove R3F deps after verifying they're unused elsewhere in `landing/`

**Deleted:**
- `components/SceneGraph.tsx`
