# Kling 3.0 Prompts — UIPE Landing Hero Assets

Generate these as 5-10s seamless loops at 1920x1080 (or 2560x1440 for retina), 24-30fps. Export MP4 (H.264) and WebM (VP9) for web.

## Aesthetic guardrails (apply to all prompts)

- High-end, cinematic, premium feel
- Dark ambient environment with a single light source (warm + cool contrast)
- Slow, confident motion — not fast or frenetic
- No human figures, no faces, no UI chrome, no text overlay
- Physical materiality: glass, fine mesh, soft volumetric light
- Color palette: near-black base, deep violet and electric blue accents, occasional warm amber highlight

## Prompt 1 — Hero tentpole (primary asset)

**Intent:** Abstract visualization of "perception" — a latent grid of signals fusing into a single understanding.

> A cinematic macro shot of a translucent glass surface suspended in dark space, with faint luminous grid lines tracing across it. From four directions, streams of soft particles — violet, cyan, amber, and pure white — flow inward and converge at the center, forming a single glowing spherical node that pulses gently. The camera slowly orbits the node at a low angle. Deep volumetric fog catches the light. Shallow depth of field, anamorphic lens flare, 24fps, photorealistic rendering. Seamless 8-second loop.

## Prompt 2 — Problem side (before UIPE)

**Intent:** Blind navigation — elements in darkness, motion that doesn't land, a sense of fumbling.

> A dark void with faint geometric shapes — rectangles, grids, buttons — fading in and out of visibility like signals in noise. A soft beam of white light sweeps across them but never quite illuminates any one fully. Occasionally a shape highlights briefly and dissolves. Cool desaturated palette, deep blue-black, hints of pale gray. Slow, uncertain motion. Shot like a high-end tech brand piece, cinematic and understated. 6-second loop.

## Prompt 3 — Solution side (with UIPE)

**Intent:** Clarity, alignment, effortless recognition.

> A dark scene with faint architectural shapes. A warm golden light sweeps through, and as it passes, each shape becomes crisp and labeled with a subtle luminous outline — the whole scene snaps into hierarchical order. The camera moves forward through the now-aligned structure as if gliding through understood space. Soft volumetric light, amber and deep violet accents, cinematic anamorphic look. 8-second loop.

## Prompt 4 — Background ambient (for section transitions)

**Intent:** Subtle texture for use behind content sections. Low visual weight.

> Slowly drifting particles of light in deep space, so subtle they're almost imperceptible. A faint gradient of deep violet to near-black background. Occasional slow lens flare. Completely ambient, no focal point. Like the quiet moments between shots in a high-end tech brand film. 10-second seamless loop.

## Prompt 5 — Signal fusion (for "how it works" section)

**Intent:** Literal visual of four inputs merging — abstract but legible.

> Four distinct horizontal threads of light — violet, cyan, amber, and pale green — flow from left to right at different speeds and heights. As they cross the center of the frame they weave together into a single braided ribbon of iridescent light that continues to the right, emitting a soft glow. Deep black background with subtle volumetric fog. Shot macro, shallow depth of field, cinematic. 6-second loop.

## Optional B-roll (use as accents, not headliners)

**B1 — Grid collapse:** A sparse grid of glowing points in 3D space collapses inward into a dense cluster, then resolves into a clean, structured lattice. 4-second loop.

**B2 — Glass through glass:** Camera moves slowly through a sequence of parallel translucent panels, each catching light differently. 5-second loop.

## Pipeline notes

- Generate at highest available quality in Kling 3.0
- If Kling's output is too frenetic, add "slow, deliberate, calm" to the prompt
- If it's too literal (e.g., shows actual web UI), add "abstract, non-representational, no text, no UI"
- If lighting feels flat, add "anamorphic lens flare, volumetric god rays, cinematic lighting"
- Export with alpha channel where possible for overlay flexibility

## Fallback

If Kling 3.0 isn't producing quality output for the hero within a few tries, pivot to:

- **Runway Gen-3** — similar quality, different aesthetic bias
- **Hand-coded CSS/WebGL hero** — already planned as Plan B (see PLAN.md)

A handcrafted shader/canvas hero that hits the brief is better than a mediocre video.
