# ASCII Scene-Graph Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the R3F scene-graph hero with a pure-canvas ASCII scene graph. Nodes/edges on a sphere; data packets carry real UIPE-shape text fragments (DOM / a11y / vision / time) along edges. Palette B (ember) — `time` is the protagonist color.

**Architecture:** Four pure TS modules (`types`, `project`, `content-pool`, `scene-model`, `render-ascii`) + one React component (`AsciiScene/index.tsx`) that owns canvas, RAF, mouse, resize, and the DOM label overlay. R3F + three.js deleted from the hero path.

**Tech Stack:** Next.js 15, React 19, TypeScript, Canvas2D (no WebGL), Vitest (new — to be added), Playwright (already installed). Font: JetBrains Mono (already loaded site-wide).

**Design reference:** `landing/docs/superpowers/specs/2026-04-20-ascii-hero-design.md` — read before starting.

---

## Prerequisites

- CWD for all commands: `/Users/dirkknibbe/uipe/ui-perception-engine/landing/`
- Type-check: `pnpm exec tsc --noEmit` (ground truth)
- Tests: `pnpm exec vitest run --reporter=verbose`
- Dev: `pnpm dev` (port 3001, not 3000)
- **tsc must be clean at every commit.**

---

## Phase 0 — Motion spike (throwaway prototype)

**Purpose:** Give Dirk something to look at in the browser before committing to the full rewrite. Three acceptance criteria at checkpoint:
1. ASCII density feels libretto-like without becoming noisy.
2. Packet flow reads as "data moving," not random characters.
3. Cursor ripple feels alive, not glitchy.

If any answer is "no," iterate on the spike or revise the spec before Phase 1.

### Task 0.1: Create spike branch

- [ ] **Step 1: Create branch**

```bash
git checkout -b hero/ascii-spike
```

Expected: `Switched to a new branch 'hero/ascii-spike'`

### Task 0.2: Scaffold one-file spike component

**Files:**
- Create: `landing/components/AsciiSpike.tsx`

- [ ] **Step 1: Write the spike**

Path: `landing/components/AsciiSpike.tsx`

```tsx
"use client";
import { useEffect, useRef } from "react";

type Signal = "DOM" | "a11y" | "vision" | "time";
type Pt = [number, number, number];

const NODES: Array<{ pos: Pt; signal: Signal }> = [
  { pos: [1.8, 0.6, 0], signal: "DOM" },
  { pos: [-1.5, 1.2, 0.8], signal: "DOM" },
  { pos: [0.8, -1.8, 0.3], signal: "DOM" },
  { pos: [1.2, 1.0, -1.2], signal: "a11y" },
  { pos: [-1.9, -0.4, 0.5], signal: "a11y" },
  { pos: [0.2, 1.9, 0.4], signal: "a11y" },
  { pos: [-0.6, -1.0, 1.8], signal: "vision" },
  { pos: [1.8, -0.8, -0.6], signal: "vision" },
  { pos: [-1.3, 0.5, -1.6], signal: "vision" },
  { pos: [0.5, 0.0, 2.0], signal: "time" },
  { pos: [-0.8, 1.6, -0.8], signal: "time" },
  { pos: [0.9, -1.4, -1.3], signal: "time" },
];

const EDGES: Array<[number, number]> = [
  [0, 1], [0, 3], [1, 2], [2, 5], [3, 4], [4, 6],
  [5, 9], [6, 7], [7, 10], [8, 11], [9, 10], [10, 11],
  [0, 9], [3, 5], [6, 11], [1, 8], [4, 7], [2, 10], [8, 9], [11, 0],
];

const CONTENT: Record<Signal, string[]> = {
  DOM: ["<h1>", "<button.primary>", "aria-labelledby", "role=\"banner\""],
  a11y: ["role=heading", "focusable", "name=\"See the web...\""],
  vision: ["primary_cta@(234,512)", "bbox=[0,0,240,48]", "salience=0.94"],
  time: ["Δ=847ms", "state_changed", "mutation", "frame_Δ=33ms"],
};

const COLOR: Record<Signal, string> = {
  DOM: "#7dd3fc",
  a11y: "#c084fc",
  vision: "#d4d4d8",
  time: "#ff6b35",
};

type Packet = {
  edgeIdx: number;
  progress: number;
  content: string;
  signal: Signal;
};

function rotate(p: Pt, rx: number, ry: number): Pt {
  const [x, y, z] = p;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const y2 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return [x1, y2, z2];
}

function project(p: Pt, w: number, h: number): [number, number, number] {
  const [x, y, z] = p;
  const fov = 3.5;
  const d = fov + z;
  const px = (x / d) * (w / 6) + w / 2;
  const py = (y / d) * (h / 6) + h / 2;
  return [px, py, d];
}

export function AsciiSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const packets: Packet[] = [];
    let spawnClock = 0;
    let raf = 0;
    let last = performance.now();
    const fontSize = 11, cellW = 6.6, cellH = 12;

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
      mouse.current.active = true;
    };
    const onLeave = () => { mouse.current.active = false; };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      spawnClock -= dt;
      if (spawnClock <= 0 && packets.length < 6) {
        const edgeIdx = Math.floor(Math.random() * EDGES.length);
        const signal: Signal =
          Math.random() < 0.45
            ? "time"
            : (["DOM", "a11y", "vision"] as const)[Math.floor(Math.random() * 3)];
        const pool = CONTENT[signal];
        packets.push({
          edgeIdx,
          progress: 0,
          content: pool[Math.floor(Math.random() * pool.length)],
          signal,
        });
        spawnClock = 0.4 + Math.random() * 0.8;
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        packets[i].progress += dt / 2.5;
        if (packets[i].progress >= 1) packets.splice(i, 1);
      }

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const cols = Math.floor(W / cellW);
      const rows = Math.floor(H / cellH);

      const rx = Math.sin(t * 0.05) * 0.18;
      const ry = t * 0.09;
      const projected: Array<[number, number, number]> = NODES.map((n) =>
        project(rotate(n.pos, rx, ry), W, H),
      );

      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "rgba(168,162,158,0.10)";
      const noise = "·:.,";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (((r * 31 + c * 7) & 5) === 0) {
            ctx.fillText(noise[(r + c) % noise.length], c * cellW, (r + 1) * cellH);
          }
        }
      }

      ctx.fillStyle = "rgba(168,162,158,0.35)";
      for (const [a, b] of EDGES) {
        const [x1, y1] = projected[a];
        const [x2, y2] = projected[b];
        const steps = Math.max(1, Math.floor(Math.hypot(x2 - x1, y2 - y1) / cellW));
        for (let i = 0; i <= steps; i++) {
          const t2 = i / steps;
          ctx.fillText("·", x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
        }
      }

      for (let i = 0; i < NODES.length; i++) {
        const [x, y] = projected[i];
        ctx.fillStyle = COLOR[NODES[i].signal];
        ctx.fillText("@", x - cellW / 2, y + cellH / 2);
      }

      for (const p of packets) {
        const [a, b] = EDGES[p.edgeIdx];
        const [x1, y1] = projected[a];
        const [x2, y2] = projected[b];
        ctx.fillStyle = COLOR[p.signal];
        ctx.fillText(p.content, x1 + (x2 - x1) * p.progress, y1 + (y2 - y1) * p.progress);
      }

      if (mouse.current.active) {
        const { x: mx, y: my } = mouse.current;
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cx = c * cellW;
            const cy = (r + 1) * cellH;
            const dist = Math.hypot(cx - mx, cy - my);
            if (dist < 120) {
              const d = Math.sin(dist * 0.1 - t * 4) * Math.exp(-dist / 120);
              if (Math.abs(d) > 0.3) {
                ctx.fillText("~", cx + Math.round(d * 2) * cellW, cy);
              }
            }
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} aria-hidden />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add landing/components/AsciiSpike.tsx
git commit -m "spike: one-file ASCII scene graph prototype"
```

### Task 0.3: Swap spike into Hero

**Files:**
- Modify: `landing/components/Hero.tsx:6-9`

- [ ] **Step 1: Change the dynamic import**

Edit `landing/components/Hero.tsx` — change:

```tsx
const SceneGraph = dynamic(
  () => import("./SceneGraph").then((m) => m.SceneGraph),
  { ssr: false },
);
```

To:

```tsx
const SceneGraph = dynamic(
  () => import("./AsciiSpike").then((m) => m.AsciiSpike),
  { ssr: false },
);
```

(Variable name stays `SceneGraph` for minimal churn; we'll rename properly in Phase 2.)

- [ ] **Step 2: Type-check + run dev server**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

Run: `pnpm dev`
Open http://localhost:3001 — hero should render the ASCII spike instead of the R3F scene graph.

- [ ] **Step 3: Commit**

```bash
git add landing/components/Hero.tsx
git commit -m "spike: wire AsciiSpike into hero"
```

### Task 0.4: Checkpoint — evaluate in browser

- [ ] **Step 1: Capture screenshot**

With `pnpm dev` running at http://localhost:3001, capture a screenshot (browser or UIPE `get_screenshot`). Save to `landing/screenshots/spike-YYYY-MM-DD.png` for reference.

- [ ] **Step 2: Score against criteria**

Answer in writing:
1. Density (libretto-like vs noisy): _______
2. Packet flow (data / random): _______
3. Cursor ripple (alive / glitchy): _______

- [ ] **Step 3: Decide**

- **All three pass:** proceed to Task 0.5.
- **Any fails:** iterate on `AsciiSpike.tsx` or update the spec at `landing/docs/superpowers/specs/2026-04-20-ascii-hero-design.md` before proceeding.

### Task 0.5: Return to master

Only after checkpoint-approved.

- [ ] **Step 1: Revert Hero.tsx**

```bash
git checkout master -- landing/components/Hero.tsx
```

- [ ] **Step 2: Keep the spike component on its branch**

The `hero/ascii-spike` branch remains as reference. Do not delete. Switch back to master:

```bash
git checkout master
```

Confirm: `landing/components/AsciiSpike.tsx` does not exist on master, `landing/components/SceneGraph.tsx` does exist, `landing/components/Hero.tsx` references `SceneGraph`.

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

---

## Phase 1 — Pure modules (TDD)

All Phase 1 tasks run on a new branch.

### Task 1.0: Branch + install vitest

**Files:**
- Modify: `landing/package.json`
- Create: `landing/vitest.config.ts`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b hero/ascii-scene
```

- [ ] **Step 2: Install vitest + happy-dom**

```bash
pnpm add -D vitest happy-dom @vitejs/plugin-react
```

(No testing-library yet — our current tests are pure TS math. Add it later if we write React unit tests for AsciiScene.)

- [ ] **Step 3: Create vitest config**

Path: `landing/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["components/**/__tests__/**/*.test.ts", "components/**/__tests__/**/*.test.tsx"],
  },
});
```

- [ ] **Step 4: Add test script**

Edit `landing/package.json` scripts block — add:

```json
"test": "vitest run --reporter=verbose",
"test:watch": "vitest"
```

- [ ] **Step 5: Type-check + smoke test**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

Run: `pnpm test` — expected "No test files found" (zero errors, zero tests).

- [ ] **Step 6: Commit**

```bash
git add landing/package.json landing/pnpm-lock.yaml landing/vitest.config.ts
git commit -m "chore(landing): add vitest + happy-dom for AsciiScene tests"
```

### Task 1.1: Shared types

**Files:**
- Create: `landing/components/AsciiScene/types.ts`

- [ ] **Step 1: Create types.ts**

```ts
export type Signal = "DOM" | "a11y" | "vision" | "time";

export type Node = {
  position: [number, number, number];
  signal: Signal;
  phase: number;
};

export type Edge = [number, number];

export type Packet = {
  edgeIdx: number;
  progress: number;
  content: string;
  signal: Signal;
};

export type Scene = {
  nodes: Node[];
  edges: Edge[];
  packets: Packet[];
  spawnClock: number;
};

export type ProjectedNode = { x: number; y: number; depth: number };

export type Cursor = { x: number; y: number; active: boolean };

export type Grid = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
};
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm exec tsc --noEmit` (expected: zero errors).

```bash
git add landing/components/AsciiScene/types.ts
git commit -m "feat(ascii-hero): add shared types"
```

### Task 1.2: project.ts — TDD rotation + projection

**Files:**
- Test: `landing/components/AsciiScene/__tests__/project.test.ts`
- Create: `landing/components/AsciiScene/project.ts`

- [ ] **Step 1: Write the failing test**

Path: `landing/components/AsciiScene/__tests__/project.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { rotate3, project } from "../project";

describe("rotate3", () => {
  it("identity: zero rotation returns the same point", () => {
    expect(rotate3([1, 2, 3], 0, 0)).toEqual([1, 2, 3]);
  });

  it("rotates 90° around Y: [1,0,0] -> [0,0,-1]", () => {
    const [x, y, z] = rotate3([1, 0, 0], 0, Math.PI / 2);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(-1, 5);
  });

  it("rotates 90° around X: [0,1,0] -> [0,0,1]", () => {
    const [x, y, z] = rotate3([0, 1, 0], Math.PI / 2, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(1, 5);
  });

  it("composes Y then X", () => {
    const [x, y, z] = rotate3([1, 0, 0], Math.PI / 2, Math.PI / 2);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(0, 5);
  });
});

describe("project", () => {
  it("origin projects to screen center", () => {
    const p = project([0, 0, 0], 1000, 600);
    expect(p.x).toBeCloseTo(500, 5);
    expect(p.y).toBeCloseTo(300, 5);
  });

  it("positive x shifts right of center", () => {
    const p = project([1, 0, 0], 1000, 600);
    expect(p.x).toBeGreaterThan(500);
  });

  it("positive y shifts below center (canvas Y grows down)", () => {
    const p = project([0, 1, 0], 1000, 600);
    expect(p.y).toBeGreaterThan(300);
  });

  it("farther z produces smaller offset (perspective)", () => {
    const near = project([1, 0, -1], 1000, 600);
    const far = project([1, 0, 2], 1000, 600);
    const nearOffset = Math.abs(near.x - 500);
    const farOffset = Math.abs(far.x - 500);
    expect(nearOffset).toBeGreaterThan(farOffset);
  });

  it("returns depth monotonic with z", () => {
    const a = project([0, 0, -2], 1000, 600);
    const b = project([0, 0, 2], 1000, 600);
    expect(b.depth).toBeGreaterThan(a.depth);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/project.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module "../project"`.

- [ ] **Step 3: Implement project.ts**

Path: `landing/components/AsciiScene/project.ts`

```ts
import type { ProjectedNode } from "./types";

export function rotate3(
  p: [number, number, number],
  rx: number,
  ry: number,
): [number, number, number] {
  const [x, y, z] = p;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const y2 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return [x1, y2, z2];
}

const FOV = 3.5;

export function project(
  p: [number, number, number],
  width: number,
  height: number,
): ProjectedNode {
  const [x, y, z] = p;
  const d = FOV + z;
  const scale = Math.min(width, height) / 6;
  return {
    x: (x / d) * scale + width / 2,
    y: (y / d) * scale + height / 2,
    depth: d,
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/project.test.ts --reporter=verbose`
Expected: 9/9 pass.

- [ ] **Step 5: Type-check + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add landing/components/AsciiScene/project.ts landing/components/AsciiScene/__tests__/project.test.ts
git commit -m "feat(ascii-hero): rotate3 + project pure math"
```

### Task 1.3: content-pool.ts — static data

**Files:**
- Create: `landing/components/AsciiScene/content-pool.ts`
- Test: `landing/components/AsciiScene/__tests__/content-pool.test.ts`

- [ ] **Step 1: Write the pool**

Path: `landing/components/AsciiScene/content-pool.ts`

```ts
import type { Signal } from "./types";

// Each pool has ≥15 entries, target 20. Fragments are ≤40 chars so they fit on a row.
const POOL: Record<Signal, string[]> = {
  DOM: [
    "<h1>",
    "<button.primary>",
    "<nav>",
    "<main role=\"main\">",
    "<section id=\"hero\">",
    "<form method=\"post\">",
    "<input type=\"email\">",
    "aria-labelledby=\"hd\"",
    "data-testid=\"cta\"",
    "role=\"banner\"",
    "role=\"dialog\"",
    "class=\"primary lg\"",
    "href=\"/docs\"",
    "<a.cta>",
    "<footer>",
    "tabindex=\"0\"",
    "<ul.grid>",
    "<li.card>",
    "<svg viewBox>",
    "<img alt=\"...\">",
  ],
  a11y: [
    "role=heading level=1",
    "name=\"See the web...\"",
    "focusable=true",
    "checked=false",
    "selected=true",
    "expanded=false",
    "disabled=false",
    "pressed=false",
    "role=button",
    "role=link",
    "role=textbox",
    "role=listbox",
    "haspopup=menu",
    "keyshortcuts=\"⌘K\"",
    "live=polite",
    "invalid=false",
    "readonly=false",
    "orientation=horizontal",
    "posinset=3/12",
    "level=2",
  ],
  vision: [
    "primary_cta@(234,512)",
    "bbox=[0,0,240,48]",
    "salience=0.94",
    "contrast=4.8",
    "occluded=false",
    "viewport_center=true",
    "z_index=10",
    "above_fold=true",
    "clickable_area=11520px²",
    "label=\"Log in\"",
    "color=#ff6b35",
    "text_weight=600",
    "icon_detected",
    "logo_match=0.87",
    "hero_region",
    "focus_ring_visible",
    "loading_spinner",
    "modal_overlay",
    "tooltip_near",
    "cursor_hover",
  ],
  time: [
    "Δ=847ms",
    "state_changed",
    "mutation",
    "idle",
    "frame_Δ=33ms",
    "settled",
    "animation_end",
    "transition_done",
    "fetch_complete",
    "hydrated",
    "interactive",
    "layout_shift=0.02",
    "scroll_end",
    "focus_gained",
    "focus_lost",
    "typing",
    "debounced",
    "throttle_skip",
    "reflow",
    "repaint",
  ],
};

function shuffled<T>(arr: T[], seed: number): T[] {
  const copy = arr.slice();
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class ContentQueue {
  private queues: Record<Signal, string[]>;
  private lastOnEdge = new Map<number, string>();
  private seed: number;

  constructor(seed = 42) {
    this.seed = seed;
    this.queues = {
      DOM: shuffled(POOL.DOM, seed + 1),
      a11y: shuffled(POOL.a11y, seed + 2),
      vision: shuffled(POOL.vision, seed + 3),
      time: shuffled(POOL.time, seed + 4),
    };
  }

  next(signal: Signal, edgeIdx: number): string {
    if (this.queues[signal].length === 0) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      this.queues[signal] = shuffled(POOL[signal], this.seed);
    }
    let pick = this.queues[signal].pop()!;
    const last = this.lastOnEdge.get(edgeIdx);
    if (pick === last && this.queues[signal].length > 0) {
      const alt = this.queues[signal].pop()!;
      this.queues[signal].push(pick);
      pick = alt;
    }
    this.lastOnEdge.set(edgeIdx, pick);
    return pick;
  }
}

export const POOL_FOR_TESTING = POOL;
```

- [ ] **Step 2: Write tests**

Path: `landing/components/AsciiScene/__tests__/content-pool.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ContentQueue, POOL_FOR_TESTING } from "../content-pool";
import type { Signal } from "../types";

describe("content-pool", () => {
  it("has ≥15 fragments per signal", () => {
    for (const sig of ["DOM", "a11y", "vision", "time"] as Signal[]) {
      expect(POOL_FOR_TESTING[sig].length).toBeGreaterThanOrEqual(15);
    }
  });

  it("fragments are ≤40 chars", () => {
    for (const sig of ["DOM", "a11y", "vision", "time"] as Signal[]) {
      for (const f of POOL_FOR_TESTING[sig]) {
        expect(f.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("next() returns a string from the requested signal pool", () => {
    const q = new ContentQueue(42);
    for (let i = 0; i < 30; i++) {
      const pick = q.next("time", 0);
      expect(POOL_FOR_TESTING.time).toContain(pick);
    }
  });

  it("does not repeat the same fragment consecutively on the same edge", () => {
    const q = new ContentQueue(42);
    let prev = "";
    for (let i = 0; i < 50; i++) {
      const pick = q.next("DOM", 5);
      expect(pick).not.toBe(prev);
      prev = pick;
    }
  });

  it("cycles the pool by reshuffling when exhausted", () => {
    const q = new ContentQueue(42);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(q.next("vision", 1));
    }
    expect(seen.size).toBe(POOL_FOR_TESTING.vision.length);
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/content-pool.test.ts --reporter=verbose`
Expected: 5/5 pass.

Run: `pnpm exec tsc --noEmit`

```bash
git add landing/components/AsciiScene/content-pool.ts landing/components/AsciiScene/__tests__/content-pool.test.ts
git commit -m "feat(ascii-hero): signal content pool with shuffled queue"
```

### Task 1.4: scene-model.ts — TDD tick

**Files:**
- Test: `landing/components/AsciiScene/__tests__/scene-model.test.ts`
- Create: `landing/components/AsciiScene/scene-model.ts`

- [ ] **Step 1: Write the failing test**

Path: `landing/components/AsciiScene/__tests__/scene-model.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createScene, tick } from "../scene-model";

describe("createScene", () => {
  it("creates 40 nodes balanced across 4 signals (10 each)", () => {
    const s = createScene(7);
    expect(s.nodes).toHaveLength(40);
    const counts = { DOM: 0, a11y: 0, vision: 0, time: 0 };
    for (const n of s.nodes) counts[n.signal]++;
    expect(counts).toEqual({ DOM: 10, a11y: 10, vision: 10, time: 10 });
  });

  it("creates ~60 edges (nearest-neighbor)", () => {
    const s = createScene(7);
    expect(s.edges.length).toBeGreaterThanOrEqual(40);
    expect(s.edges.length).toBeLessThanOrEqual(80);
  });

  it("is deterministic for the same seed", () => {
    const a = createScene(7);
    const b = createScene(7);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });

  it("starts with zero packets", () => {
    expect(createScene(7).packets).toEqual([]);
  });
});

describe("tick", () => {
  it("advances packet progress by dt/2.5", () => {
    const s = createScene(7);
    s.packets.push({ edgeIdx: 0, progress: 0, content: "x", signal: "DOM" });
    tick(s, 0.25);
    expect(s.packets[0].progress).toBeCloseTo(0.1, 5);
  });

  it("removes packets whose progress has reached 1", () => {
    const s = createScene(7);
    const mark = { edgeIdx: 0, progress: 0.95, content: "MARK", signal: "DOM" as const };
    s.packets.push(mark);
    tick(s, 0.25);
    // tick may spawn new packets on the same call; assertion is that the marked one is gone.
    expect(s.packets).not.toContain(mark);
  });

  it("spawns packets on Poisson schedule to target 5-8 in flight", () => {
    const s = createScene(7);
    for (let i = 0; i < 600; i++) tick(s, 1 / 60); // ~10s simulated
    expect(s.packets.length).toBeGreaterThanOrEqual(3);
    expect(s.packets.length).toBeLessThanOrEqual(10);
  });

  it("all spawned packets have progress in [0,1) and valid edgeIdx", () => {
    const s = createScene(7);
    for (let i = 0; i < 600; i++) tick(s, 1 / 60);
    for (const p of s.packets) {
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThan(1);
      expect(p.edgeIdx).toBeGreaterThanOrEqual(0);
      expect(p.edgeIdx).toBeLessThan(s.edges.length);
    }
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/scene-model.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module "../scene-model"`.

- [ ] **Step 3: Implement scene-model.ts**

Path: `landing/components/AsciiScene/scene-model.ts`

```ts
import type { Edge, Node, Scene, Signal } from "./types";
import { ContentQueue } from "./content-pool";

const SIGNALS: Signal[] = ["DOM", "a11y", "vision", "time"];

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScene(seed = 7, nodeCount = 40): Scene {
  const rand = mulberry32(seed);
  const nodes: Node[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const t = i / nodeCount;
    const theta = Math.acos(1 - 2 * t);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 2.4 + (rand() - 0.5) * 0.6;
    nodes.push({
      position: [
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta),
      ],
      signal: SIGNALS[i % 4],
      phase: rand() * Math.PI * 2,
    });
  }

  const edges: Edge[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const dists = nodes
      .map((n, j) => {
        if (j === i) return { j, d: Infinity };
        const dx = n.position[0] - nodes[i].position[0];
        const dy = n.position[1] - nodes[i].position[1];
        const dz = n.position[2] - nodes[i].position[2];
        return { j, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
      })
      .sort((a, b) => a.d - b.d);
    const k = 2 + Math.floor(rand() * 2);
    for (let n = 0; n < k; n++) {
      const j = dists[n].j;
      if (j > i) edges.push([i, j]);
    }
  }

  return { nodes, edges, packets: [], spawnClock: 0 };
}

const PACKET_DURATION = 2.5; // seconds
const TARGET_MIN = 5;
const TARGET_MAX = 8;

// Deterministic packet-spawn RNG — set from scene seed so tests are stable.
let spawnRand = mulberry32(1337);
export function _resetSpawnRand(seed: number) {
  spawnRand = mulberry32(seed);
}
const queue = new ContentQueue(42);

export function tick(scene: Scene, dt: number): void {
  // Advance + recycle.
  for (let i = scene.packets.length - 1; i >= 0; i--) {
    scene.packets[i].progress += dt / PACKET_DURATION;
    if (scene.packets[i].progress >= 1) scene.packets.splice(i, 1);
  }

  // Poisson-ish spawn: rate increases when below target min, decreases above max.
  scene.spawnClock -= dt;
  if (scene.spawnClock <= 0) {
    const count = scene.packets.length;
    if (count < TARGET_MAX) {
      const edgeIdx = Math.floor(spawnRand() * scene.edges.length);
      const nodeIdx = scene.edges[edgeIdx][0];
      const signal = scene.nodes[nodeIdx].signal;
      scene.packets.push({
        edgeIdx,
        progress: 0,
        content: queue.next(signal, edgeIdx),
        signal,
      });
    }
    // Faster spawns when under target, slower when above.
    const base = count < TARGET_MIN ? 0.25 : 0.7;
    scene.spawnClock = base + spawnRand() * 0.4;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/scene-model.test.ts --reporter=verbose`
Expected: 9/9 pass.

- [ ] **Step 5: Type-check + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add landing/components/AsciiScene/scene-model.ts landing/components/AsciiScene/__tests__/scene-model.test.ts
git commit -m "feat(ascii-hero): scene model with tick + Poisson packet spawn"
```

### Task 1.5: render-ascii.ts — snapshot-driven implementation

**Files:**
- Test: `landing/components/AsciiScene/__tests__/render-ascii.test.ts`
- Create: `landing/components/AsciiScene/render-ascii.ts`

- [ ] **Step 1: Write the snapshot test (fixed inputs, freeze t=0)**

Path: `landing/components/AsciiScene/__tests__/render-ascii.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { renderAscii } from "../render-ascii";
import { createScene } from "../scene-model";
import { rotate3, project } from "../project";

function projectAll(scene: ReturnType<typeof createScene>, w: number, h: number) {
  return scene.nodes.map((n) => project(rotate3(n.position, 0, 0), w, h));
}

describe("renderAscii", () => {
  it("produces a grid of correct dimensions", () => {
    const scene = createScene(7);
    const projected = projectAll(scene, 600, 200);
    const grid = renderAscii({
      projected,
      scene,
      cursor: { x: 0, y: 0, active: false },
      grid: { cols: 91, rows: 17, cellW: 6.6, cellH: 12 },
      time: 0,
    });
    expect(grid.cells.length).toBe(17);
    expect(grid.cells[0].length).toBe(91);
  });

  it("places glyphs at projected node positions", () => {
    const scene = createScene(7);
    const projected = projectAll(scene, 600, 200);
    const grid = renderAscii({
      projected,
      scene,
      cursor: { x: 0, y: 0, active: false },
      grid: { cols: 91, rows: 17, cellW: 6.6, cellH: 12 },
      time: 0,
    });
    // At least one cell should carry a signal (node) marker.
    const hasNode = grid.cells.some((row) => row.some((c) => c.signal !== undefined));
    expect(hasNode).toBe(true);
  });

  it("matches committed snapshot for fixed inputs", () => {
    const scene = createScene(7);
    // Stamp a deterministic packet.
    scene.packets = [{ edgeIdx: 0, progress: 0.5, content: "Δ=847ms", signal: "time" }];
    const projected = projectAll(scene, 600, 200);
    const grid = renderAscii({
      projected,
      scene,
      cursor: { x: 0, y: 0, active: false },
      grid: { cols: 91, rows: 17, cellW: 6.6, cellH: 12 },
      time: 0,
    });
    // Compact to string for readable snapshot.
    const ascii = grid.cells.map((row) => row.map((c) => c.ch).join("")).join("\n");
    expect(ascii).toMatchSnapshot();
  });

  it("cursor ripple changes the grid near the cursor", () => {
    const scene = createScene(7);
    const projected = projectAll(scene, 600, 200);
    const baseline = renderAscii({
      projected, scene,
      cursor: { x: 0, y: 0, active: false },
      grid: { cols: 91, rows: 17, cellW: 6.6, cellH: 12 },
      time: 0.5,
    });
    const rippled = renderAscii({
      projected, scene,
      cursor: { x: 300, y: 100, active: true },
      grid: { cols: 91, rows: 17, cellW: 6.6, cellH: 12 },
      time: 0.5,
    });
    let diffs = 0;
    for (let r = 0; r < 17; r++) {
      for (let c = 0; c < 91; c++) {
        if (baseline.cells[r][c].ch !== rippled.cells[r][c].ch) diffs++;
      }
    }
    expect(diffs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/render-ascii.test.ts --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement render-ascii.ts**

Path: `landing/components/AsciiScene/render-ascii.ts`

```ts
import type { Cursor, Grid, ProjectedNode, Scene, Signal } from "./types";

export type RenderCell = { ch: string; signal?: Signal };
export type RenderedGrid = { cells: RenderCell[][] };

export type RenderInput = {
  projected: ProjectedNode[];
  scene: Scene;
  cursor: Cursor;
  grid: Grid;
  time: number;
};

const AMBIENT = "·:.,";
const EDGE_RAMP = "·.:;~";
const NODE_GLYPH = "@";
const RIPPLE_GLYPH = "~";

function makeEmpty(grid: Grid): RenderCell[][] {
  const out: RenderCell[][] = new Array(grid.rows);
  for (let r = 0; r < grid.rows; r++) {
    out[r] = new Array(grid.cols);
    for (let c = 0; c < grid.cols; c++) out[r][c] = { ch: " " };
  }
  return out;
}

export function renderAscii(input: RenderInput): RenderedGrid {
  const { projected, scene, cursor, grid, time } = input;
  const cells = makeEmpty(grid);

  // 1. Ambient field: sparse pseudo-random glyphs.
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (((r * 31 + c * 7) & 7) === 0) {
        cells[r][c] = { ch: AMBIENT[(r + c) % AMBIENT.length] };
      }
    }
  }

  // 2. Edges: rasterize with density by depth.
  for (const [a, b] of scene.edges) {
    const pa = projected[a];
    const pb = projected[b];
    const ca = Math.round(pa.x / grid.cellW);
    const ra = Math.round(pa.y / grid.cellH);
    const cb = Math.round(pb.x / grid.cellW);
    const rb = Math.round(pb.y / grid.cellH);
    const steps = Math.max(1, Math.hypot(cb - ca, rb - ra));
    const depth = (pa.depth + pb.depth) / 2;
    const glyph = EDGE_RAMP[Math.min(
      EDGE_RAMP.length - 1,
      Math.max(0, Math.floor((depth - 1.5) * 1.2)),
    )];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const c = Math.round(ca + (cb - ca) * t);
      const r = Math.round(ra + (rb - ra) * t);
      if (r >= 0 && r < grid.rows && c >= 0 && c < grid.cols) {
        if (cells[r][c].ch === " " || AMBIENT.includes(cells[r][c].ch)) {
          cells[r][c] = { ch: glyph };
        }
      }
    }
  }

  // 3. Nodes: bright glyph, signal-tagged.
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    const c = Math.round(p.x / grid.cellW);
    const r = Math.round(p.y / grid.cellH);
    if (r >= 0 && r < grid.rows && c >= 0 && c < grid.cols) {
      cells[r][c] = { ch: NODE_GLYPH, signal: scene.nodes[i].signal };
    }
  }

  // 4. Packets: stamp text along edge.
  for (const p of scene.packets) {
    const [a, b] = scene.edges[p.edgeIdx];
    const pa = projected[a];
    const pb = projected[b];
    const x = pa.x + (pb.x - pa.x) * p.progress;
    const y = pa.y + (pb.y - pa.y) * p.progress;
    const r = Math.round(y / grid.cellH);
    const cStart = Math.round(x / grid.cellW);
    if (r < 0 || r >= grid.rows) continue;
    for (let i = 0; i < p.content.length; i++) {
      const c = cStart + i;
      if (c < 0 || c >= grid.cols) continue;
      cells[r][c] = { ch: p.content[i], signal: p.signal };
    }
  }

  // 5. Cursor ripple.
  if (cursor.active) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cx = c * grid.cellW;
        const cy = (r + 1) * grid.cellH;
        const dist = Math.hypot(cx - cursor.x, cy - cursor.y);
        if (dist < 120) {
          const d = Math.sin(dist * 0.1 - time * 4) * Math.exp(-dist / 120);
          if (Math.abs(d) > 0.3) {
            const shift = Math.round(d * 2);
            const targetC = c + shift;
            if (targetC >= 0 && targetC < grid.cols && cells[r][targetC].ch === " ") {
              cells[r][targetC] = { ch: RIPPLE_GLYPH };
            }
          }
        }
      }
    }
  }

  return { cells };
}
```

- [ ] **Step 4: Run, expect pass (snapshot will be written on first run)**

Run: `pnpm exec vitest run components/AsciiScene/__tests__/render-ascii.test.ts --reporter=verbose`
Expected: first run writes the snapshot and passes; subsequent runs compare against it.

- [ ] **Step 5: Type-check + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add landing/components/AsciiScene/render-ascii.ts landing/components/AsciiScene/__tests__/render-ascii.test.ts landing/components/AsciiScene/__tests__/__snapshots__
git commit -m "feat(ascii-hero): render-ascii pure grid renderer with snapshot test"
```

---

## Phase 2 — React component + integration

### Task 2.1: AsciiScene React component

**Files:**
- Create: `landing/components/AsciiScene/index.tsx`

- [ ] **Step 1: Write the component**

Path: `landing/components/AsciiScene/index.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Cursor, Grid, ProjectedNode, Signal } from "./types";
import { createScene, tick } from "./scene-model";
import { rotate3, project } from "./project";
import { renderAscii } from "./render-ascii";

const FONT_SIZE = 11;
const CELL_W = 6.6;
const CELL_H = 12;

const COLOR: Record<Signal, string> = {
  DOM: "#7dd3fc",
  a11y: "#c084fc",
  vision: "#d4d4d8",
  time: "#ff6b35",
};

const AMBIENT_COLOR = "rgba(168,162,158,0.35)";

export function AsciiScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mouse = useRef<Cursor>({ x: 0, y: 0, active: false });
  const [activeLabel, setActiveLabel] = useState<{
    x: number;
    y: number;
    text: string;
    signal: Signal;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext("2d")!;

    const scene = createScene(7);
    let grid: Grid = { cols: 0, rows: 0, cellW: CELL_W, cellH: CELL_H };
    let last = performance.now();
    let raf = 0;

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "alphabetic";
      grid = {
        cols: Math.floor(rect.width / CELL_W),
        rows: Math.floor(rect.height / CELL_H),
        cellW: CELL_W,
        cellH: CELL_H,
      };
    };
    resize();
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    });
    ro.observe(wrapper);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
      mouse.current.active = true;
    };
    const onLeave = () => {
      mouse.current.active = false;
      setActiveLabel(null);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      tick(scene, dt);

      const rx = Math.sin(t * 0.05) * 0.18 + mouse.current.y * 0.0002;
      const ry = t * 0.09 + mouse.current.x * 0.0002;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const projected: ProjectedNode[] = scene.nodes.map((n) =>
        project(rotate3(n.position, rx, ry), w, h),
      );

      // Hit-test: nearest node within 40px.
      if (mouse.current.active) {
        let best = -1;
        let bestD = 40;
        for (let i = 0; i < projected.length; i++) {
          const d = Math.hypot(projected[i].x - mouse.current.x, projected[i].y - mouse.current.y);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) {
          const n = scene.nodes[best];
          setActiveLabel({
            x: projected[best].x,
            y: projected[best].y,
            text: `${n.signal} · node_${best}`,
            signal: n.signal,
          });
        } else {
          setActiveLabel(null);
        }
      }

      const rendered = renderAscii({
        projected,
        scene,
        cursor: mouse.current,
        grid,
        time: t,
      });

      ctx.clearRect(0, 0, w, h);

      // Row-based painting: two passes — ambient then colored cells.
      for (let r = 0; r < grid.rows; r++) {
        // Ambient pass.
        ctx.fillStyle = AMBIENT_COLOR;
        let runStart = -1;
        let run = "";
        for (let c = 0; c < grid.cols; c++) {
          const cell = rendered.cells[r][c];
          if (cell.signal === undefined && cell.ch !== " ") {
            if (runStart < 0) runStart = c;
            run += cell.ch;
          } else if (runStart >= 0) {
            ctx.fillText(run, runStart * CELL_W, (r + 1) * CELL_H);
            runStart = -1;
            run = "";
          }
        }
        if (runStart >= 0) ctx.fillText(run, runStart * CELL_W, (r + 1) * CELL_H);

        // Colored pass.
        for (let c = 0; c < grid.cols; c++) {
          const cell = rendered.cells[r][c];
          if (cell.signal !== undefined) {
            ctx.fillStyle = COLOR[cell.signal];
            ctx.fillText(cell.ch, c * CELL_W, (r + 1) * CELL_H);
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapperRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <p className="sr-only">
        An animated graph of nodes representing DOM, accessibility, vision, and time signals,
        connected by edges with data packets flowing between them.
      </p>
      {activeLabel && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            left: activeLabel.x + 12,
            top: activeLabel.y - 8,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            color: COLOR[activeLabel.signal],
            background: "rgba(11,11,15,0.85)",
            border: `1px solid ${COLOR[activeLabel.signal]}`,
            padding: "2px 8px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            borderRadius: 2,
          }}
        >
          {activeLabel.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `.sr-only` utility if missing**

Check `landing/app/globals.css`. If `.sr-only` is not already defined, add:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add landing/components/AsciiScene/index.tsx landing/app/globals.css
git commit -m "feat(ascii-hero): AsciiScene React component with canvas + label overlay"
```

### Task 2.2: Wire AsciiScene into Hero.tsx

**Files:**
- Modify: `landing/components/Hero.tsx:6-9` + `landing/components/Hero.tsx:59`

- [ ] **Step 1: Update dynamic import**

Edit `landing/components/Hero.tsx` — replace:

```tsx
const SceneGraph = dynamic(
  () => import("./SceneGraph").then((m) => m.SceneGraph),
  { ssr: false },
);
```

With:

```tsx
const AsciiScene = dynamic(
  () => import("./AsciiScene").then((m) => m.AsciiScene),
  { ssr: false },
);
```

Then in the JSX, replace `<SceneGraph />` with `<AsciiScene />`.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Browser check**

Run: `pnpm dev`
Open http://localhost:3001 — confirm hero renders the full-fidelity AsciiScene (nodes, edges, packets flowing, hover labels, cursor ripple).

- [ ] **Step 4: Commit**

```bash
git add landing/components/Hero.tsx
git commit -m "feat(ascii-hero): wire AsciiScene into Hero"
```

### Task 2.3: Delete SceneGraph.tsx + remove R3F deps

**Files:**
- Delete: `landing/components/SceneGraph.tsx`
- Modify: `landing/package.json`

- [ ] **Step 1: Verify SceneGraph is unused**

Run:
```bash
grep -r "SceneGraph" landing/ --include="*.tsx" --include="*.ts" | grep -v "AsciiScene"
```
Expected: zero hits (all references now point to AsciiScene).

- [ ] **Step 2: Verify R3F deps are unused elsewhere**

Run:
```bash
grep -rE "@react-three|from \"three\"|from 'three'" landing/ --include="*.tsx" --include="*.ts"
```
Expected: zero hits.

- [ ] **Step 3: Delete the file**

```bash
rm landing/components/SceneGraph.tsx
```

- [ ] **Step 4: Remove deps**

```bash
pnpm remove @react-three/drei @react-three/fiber @react-three/postprocessing three @types/three
```

- [ ] **Step 5: Type-check + build**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm build`
Both expected: success.

- [ ] **Step 6: Commit**

```bash
git add landing/package.json landing/pnpm-lock.yaml landing/components/SceneGraph.tsx
git commit -m "chore(ascii-hero): remove SceneGraph.tsx + R3F deps"
```

### Task 2.4: Add palette B CSS custom properties

**Files:**
- Modify: `landing/app/globals.css`

- [ ] **Step 1: Add palette variables**

Append to the `:root` block (or create a `.hero-ascii` scoped block if `:root` is tight):

```css
:root {
  --signal-dom: #7dd3fc;
  --signal-a11y: #c084fc;
  --signal-vision: #d4d4d8;
  --signal-time: #ff6b35;
}
```

- [ ] **Step 2: Use the variables in AsciiScene**

In `landing/components/AsciiScene/index.tsx`, replace the hardcoded `COLOR` record with runtime-read CSS values:

```ts
const COLOR: Record<Signal, string> = (typeof window !== "undefined")
  ? {
      DOM: getComputedStyle(document.documentElement).getPropertyValue("--signal-dom").trim() || "#7dd3fc",
      a11y: getComputedStyle(document.documentElement).getPropertyValue("--signal-a11y").trim() || "#c084fc",
      vision: getComputedStyle(document.documentElement).getPropertyValue("--signal-vision").trim() || "#d4d4d8",
      time: getComputedStyle(document.documentElement).getPropertyValue("--signal-time").trim() || "#ff6b35",
    }
  : { DOM: "#7dd3fc", a11y: "#c084fc", vision: "#d4d4d8", time: "#ff6b35" };
```

This block must be inside the `useEffect` (or computed inside a `useMemo` with `typeof window` guard) to avoid SSR access of `document`.

Actual placement: compute inside `useEffect` right after `ctx = canvas.getContext("2d")!;`, assign to a local `color` variable, and use `color[...]` instead of `COLOR[...]` in the draw loop.

- [ ] **Step 3: Type-check + browser check**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm dev`
Confirm colors are unchanged visually.

- [ ] **Step 4: Commit**

```bash
git add landing/app/globals.css landing/components/AsciiScene/index.tsx
git commit -m "feat(ascii-hero): signal palette as CSS custom properties"
```

---

## Phase 3 — Adaptive behavior

### Task 3.1: Mobile lite mode

**Files:**
- Modify: `landing/components/AsciiScene/index.tsx`

- [ ] **Step 1: Add mobile detection + scaled constants**

Inside `useEffect`, after `resize()` runs once, compute:

```ts
const isMobile =
  window.matchMedia("(pointer: coarse)").matches ||
  window.innerWidth < 768;

const MOBILE_FONT = 14;
const MOBILE_CELL_W = 8;
const MOBILE_CELL_H = 16;

if (isMobile) {
  ctx.font = `${MOBILE_FONT}px "JetBrains Mono", monospace`;
  grid = {
    cols: Math.floor(canvas.clientWidth / MOBILE_CELL_W),
    rows: Math.floor(canvas.clientHeight / MOBILE_CELL_H),
    cellW: MOBILE_CELL_W,
    cellH: MOBILE_CELL_H,
  };
}
```

- [ ] **Step 2: Halve packet cadence on mobile**

Modify `scene-model.ts` — update `tick` signature:

```ts
export function tick(scene: Scene, dt: number, opts: { mobile?: boolean } = {}): void {
  // ... existing logic
  // When computing base spawn interval:
  const base = count < TARGET_MIN ? 0.25 : 0.7;
  const factor = opts.mobile ? 2 : 1;
  scene.spawnClock = (base + spawnRand() * 0.4) * factor;
}
```

Update the existing scene-model test to pass `opts`-less calls (should still work — default is `{}`).

- [ ] **Step 3: Pass `mobile` flag through from component**

In `AsciiScene/index.tsx`, capture `isMobile` outside the draw loop (close over it) and call `tick(scene, dt, { mobile: isMobile })`.

- [ ] **Step 4: Disable cursor ripple on touch**

In the same component, before the draw loop, set:
```ts
if (isMobile) mouse.current.active = false; // ripple off
```
And do not update `mouse.current.active = true` from `onMove` if `isMobile`.

- [ ] **Step 5: Tap-to-reveal labels on mobile**

Add `pointerdown` handler that mirrors `onMove` but sets a 2-second timeout to clear `activeLabel`:

```ts
const onTap = (e: PointerEvent) => {
  if (!isMobile) return;
  const rect = canvas.getBoundingClientRect();
  mouse.current.x = e.clientX - rect.left;
  mouse.current.y = e.clientY - rect.top;
  mouse.current.active = true;
  window.setTimeout(() => {
    mouse.current.active = false;
    setActiveLabel(null);
  }, 2000);
};
canvas.addEventListener("pointerdown", onTap);
```

Remember to remove the listener in cleanup.

- [ ] **Step 6: Type-check + mobile browser check**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm dev`
In browser DevTools device toolbar, verify mobile rendering works (iPhone 12 preset, Pixel 7).

- [ ] **Step 7: Commit**

```bash
git add landing/components/AsciiScene
git commit -m "feat(ascii-hero): mobile lite mode — reduced density, half cadence, tap-to-reveal"
```

### Task 3.2: Reduced motion

**Files:**
- Modify: `landing/components/AsciiScene/index.tsx`

- [ ] **Step 1: Detect reduced-motion**

Inside `useEffect`:

```ts
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

- [ ] **Step 2: Render one frame then stop**

If `reduceMotion`, replace the `requestAnimationFrame` loop with a single call to `draw(performance.now())` and skip the re-request. Also do not call `tick(scene, dt, ...)` — leave `scene.packets = []` so the static frame is packet-free.

Concrete: wrap the `requestAnimationFrame(draw)` at the bottom of `draw` in:

```ts
if (!reduceMotion) raf = requestAnimationFrame(draw);
```

And gate `tick(scene, dt, { mobile: isMobile })` with `if (!reduceMotion) tick(...)`.

- [ ] **Step 3: Browser check**

Run: `pnpm dev`. In DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → reduce. Reload. Scene should render once and freeze; no packets, no ripple, no rotation.

- [ ] **Step 4: Type-check + commit**

```bash
git add landing/components/AsciiScene/index.tsx
git commit -m "feat(ascii-hero): respect prefers-reduced-motion with static frame"
```

---

## Phase 4 — Integration test + verification

### Task 4.1: Playwright snapshot test

**Files:**
- Create: `landing/tests/e2e/ascii-hero.spec.ts`
- Modify: `landing/playwright.config.ts` (create if missing)

- [ ] **Step 1: Create Playwright config (if missing)**

Check `landing/playwright.config.ts`. If missing:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

Install if needed:
```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write integration test**

Path: `landing/tests/e2e/ascii-hero.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("hero renders AsciiScene canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("section canvas").first();
  await expect(canvas).toBeVisible();
  // Allow animation to stabilize.
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(400);
});

test("node hover reveals a label", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(500);
  // Move across the hero to find a node — best-effort sweep.
  const canvas = page.locator("section canvas").first();
  const box = (await canvas.boundingBox())!;
  for (let x = box.x + box.width * 0.5; x < box.x + box.width * 0.9; x += 20) {
    for (let y = box.y + box.height * 0.2; y < box.y + box.height * 0.8; y += 20) {
      await page.mouse.move(x, y);
      const label = page.locator("[role=\"status\"]");
      if (await label.count() > 0 && await label.isVisible()) {
        const text = await label.innerText();
        expect(text).toMatch(/^(DOM|a11y|vision|time) · /);
        return;
      }
    }
  }
  throw new Error("no hover label surfaced after sweeping the hero");
});
```

- [ ] **Step 3: Run**

```bash
pnpm exec playwright test
```
Expected: 2/2 pass.

- [ ] **Step 4: Commit**

```bash
git add landing/tests landing/playwright.config.ts landing/package.json landing/pnpm-lock.yaml
git commit -m "test(ascii-hero): playwright integration tests"
```

### Task 4.2: Bundle size check

- [ ] **Step 1: Measure post-rewrite bundle**

Run:
```bash
pnpm build
```

Note the `First Load JS` reported for `/` in the Next.js build output. Compare to a prior `master` build (request from Dirk or re-run on master). Target: ≥150KB gzip reduction.

- [ ] **Step 2: Record in design spec if target met**

If met, append a line to `landing/docs/superpowers/specs/2026-04-20-ascii-hero-design.md`:

```
**Bundle outcome:** before X KB → after Y KB (Δ = Z KB gzip).
```

If not met (<100KB reduction), stop and raise with Dirk — we may have missed a dep or the target was optimistic.

- [ ] **Step 3: Commit if updated**

```bash
git add landing/docs/superpowers/specs/2026-04-20-ascii-hero-design.md
git commit -m "docs(ascii-hero): record bundle outcome"
```

### Task 4.3: Lighthouse + axe + dogfood

- [ ] **Step 1: Run Lighthouse**

```bash
pnpm build && pnpm start &
pnpm exec lighthouse http://localhost:3001 --only-categories=performance,accessibility --output=json --output-path=./lighthouse-report.json --chrome-flags="--headless"
```

(Install `lighthouse` globally if missing, or use Chrome DevTools Lighthouse panel.)

Expected: perf ≥ 90, a11y = 100.

- [ ] **Step 2: Run axe-core**

Add an axe scan to the Playwright test (or run via browser extension). Expected: zero violations.

- [ ] **Step 3: Dogfood UIPE**

With the dev server running, use UIPE's MCP tools against `http://localhost:3001`:

```
navigate → http://localhost:3001
analyze_visual
get_scene (compact)
```

Expected: UIPE correctly identifies (1) the primary CTA, (2) the hero headline, (3) the waitlist form. If any is misidentified, that is a brand-promise problem — stop and investigate before shipping.

- [ ] **Step 4: impeccable:audit**

Invoke the `impeccable:audit` skill. Fix any red flags before shipping.

- [ ] **Step 5: Final commit + PR prep**

```bash
git status
```

Verify everything is committed. Push the branch and open a PR via `mcp__github__create_pull_request` (per Dirk's workflow — GitHub work uses the MCP, not `gh`).

---

## Rollback plan

If AsciiScene ships and is broken in a way that can't be quickly fixed:

1. `git revert` the integration commits from Phase 2 on master.
2. Restore `SceneGraph.tsx` from git history: `git checkout <master-sha> -- landing/components/SceneGraph.tsx`.
3. Restore R3F deps: `pnpm add @react-three/drei@^10.7.7 @react-three/fiber@^9.6.0 @react-three/postprocessing@^3.0.4 three@^0.183.2 && pnpm add -D @types/three@^0.183.1`.
4. Deploy.

The AsciiScene code remains on its branch for a follow-up rescue or rewrite.
