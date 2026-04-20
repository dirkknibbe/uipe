"use client";
import { useEffect, useMemo, useRef } from "react";

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

// Libretto-style density ramp: dim → bright for light-shaded voxel spheres.
const SHADE_RAMP = " .,:;+*=#%@";
// Stream chars that flow along edges.
const JUNK = "0123456789abcdefABCDEF!?/.:;-=+*^~<>[](){}";
const AMBIENT = "·.:";

// Top-left-front light direction (normalized).
const LIGHT: Pt = (() => {
  const v: Pt = [-0.45, -0.6, 0.7];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

// Fibonacci-sphere surface samples for voxel-shading each node.
function fibSphere(n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const theta = Math.acos(1 - 2 * t);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    pts.push([
      Math.sin(theta) * Math.cos(phi),
      Math.sin(theta) * Math.sin(phi),
      Math.cos(theta),
    ]);
  }
  return pts;
}

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

function hashedChar(pool: string, a: number, b: number): string {
  let s = ((a * 2654435761) ^ (b * 40503)) >>> 0;
  s = (s ^ (s >>> 13)) * 0x5bd1e995;
  s = s >>> 0;
  return pool[s % pool.length];
}

export function AsciiSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999, active: false });

  // 180 samples per sphere — dense enough for libretto-like voxel shading.
  const spherePoints = useMemo(() => fibSphere(180), []);

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
      ctx.textBaseline = "alphabetic";
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
    const onLeave = () => {
      mouse.current.active = false;
      mouse.current.x = -9999;
      mouse.current.y = -9999;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    // Reusable per-frame buffers for voxel-sphere rendering.
    // Keyed by "row,col" → intensity; we pick brightest per cell to avoid
    // darker samples painting over bright ones.
    const cellIntensity = new Map<string, number>();
    const cellGlyph = new Map<string, string>();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Packet lifecycle.
      spawnClock -= dt;
      if (spawnClock <= 0 && packets.length < 7) {
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
        spawnClock = 0.5 + Math.random() * 0.8;
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        packets[i].progress += dt / 2.8;
        if (packets[i].progress >= 1) packets.splice(i, 1);
      }

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const cols = Math.floor(W / cellW);
      const rows = Math.floor(H / cellH);

      const rx = Math.sin(t * 0.05) * 0.2;
      const ry = t * 0.09;
      const projected: Array<[number, number, number]> = NODES.map((n) =>
        project(rotate(n.pos, rx, ry), W, H),
      );

      // Hover: nearest node within 100px.
      let hoverIdx = -1;
      let hoverBoost = 0;
      if (mouse.current.active) {
        let best = Infinity;
        for (let i = 0; i < projected.length; i++) {
          const d = Math.hypot(
            projected[i][0] - mouse.current.x,
            projected[i][1] - mouse.current.y,
          );
          if (d < best) { best = d; hoverIdx = i; }
        }
        hoverBoost = Math.max(0, 1 - best / 100);
      }

      ctx.clearRect(0, 0, W, H);

      // 1) Sparse ambient field.
      ctx.fillStyle = "rgba(168,162,158,0.08)";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (((r * 31 + c * 7) & 15) === 0) {
            ctx.fillText(AMBIENT[(r + c) % AMBIENT.length], c * cellW, (r + 1) * cellH);
          }
        }
      }

      // 2) Edge streams — junk + UIPE packets.
      for (let ei = 0; ei < EDGES.length; ei++) {
        const [a, b] = EDGES[ei];
        const [x1, y1] = projected[a];
        const [x2, y2] = projected[b];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const step = cellW * 1.05;
        const steps = Math.max(1, Math.floor(len / step));
        const scroll = t * (6 + (ei % 3) * 2);
        const edgeHot = (hoverIdx === a || hoverIdx === b) ? 0.58 : 0.26;
        // Reserve room around node spheres so they read cleanly.
        const nodeMargin = 26;

        for (let i = 0; i <= steps; i++) {
          const frac = i / steps;
          const x = x1 + (x2 - x1) * frac;
          const y = y1 + (y2 - y1) * frac;
          const distA = Math.hypot(x - x1, y - y1);
          const distB = Math.hypot(x - x2, y - y2);
          if (distA < nodeMargin || distB < nodeMargin) continue;

          const ch = hashedChar(JUNK, ei * 101 + i, Math.floor(scroll));
          let alpha = edgeHot;
          if (mouse.current.active) {
            const d = Math.hypot(x - mouse.current.x, y - mouse.current.y);
            if (d < 160) alpha = Math.min(0.9, edgeHot + (1 - d / 160) * 0.35);
          }
          ctx.fillStyle = `rgba(168,162,158,${alpha})`;
          ctx.fillText(ch, x, y);
        }

        for (const p of packets) {
          if (p.edgeIdx !== ei) continue;
          const frac = p.progress;
          const x = x1 + (x2 - x1) * frac;
          const y = y1 + (y2 - y1) * frac;
          const distA = Math.hypot(x - x1, y - y1);
          const distB = Math.hypot(x - x2, y - y2);
          if (distA < 22 || distB < 22) continue;
          ctx.fillStyle = COLOR[p.signal];
          ctx.fillText(p.content, x, y);
        }
      }

      // 3) Nodes as light-shaded voxel spheres (libretto-style 3D).
      for (let i = 0; i < NODES.length; i++) {
        const [cx, cy, depth] = projected[i];
        const baseR = 28;
        const depthR = baseR / Math.max(1.2, depth - 1.5);
        const boostR = i === hoverIdx ? depthR * (1 + hoverBoost * 0.4) : depthR;

        cellIntensity.clear();
        cellGlyph.clear();

        // Sample the sphere surface — rotate points with the scene rotation.
        for (const sp of spherePoints) {
          const rp = rotate(sp, rx, ry);
          // Back-face cull: only draw points facing the camera.
          if (rp[2] < -0.05) continue;
          const sx = cx + rp[0] * boostR;
          const sy = cy + rp[1] * boostR;
          // Lambert shading: N · L.
          let ndotl = rp[0] * LIGHT[0] + rp[1] * LIGHT[1] + rp[2] * LIGHT[2];
          ndotl = Math.max(0, ndotl);
          // Rim / ambient lift so silhouette never goes to pure black.
          const ambient = 0.18;
          let intensity = ambient + ndotl * 0.82;
          if (i === hoverIdx) intensity = Math.min(1, intensity + hoverBoost * 0.25);
          if (intensity < 0.1) continue;
          const rampIdx = Math.min(
            SHADE_RAMP.length - 1,
            Math.floor(intensity * SHADE_RAMP.length),
          );
          const ch = SHADE_RAMP[rampIdx];
          // Quantize to char cell; keep the brightest sample per cell.
          const cellKey = `${Math.round(sy / cellH)},${Math.round(sx / cellW)}`;
          const prev = cellIntensity.get(cellKey) ?? 0;
          if (intensity > prev) {
            cellIntensity.set(cellKey, intensity);
            cellGlyph.set(cellKey, ch);
          }
        }

        ctx.fillStyle = COLOR[NODES[i].signal];
        for (const [key, ch] of cellGlyph) {
          const [r, c] = key.split(",").map(Number);
          ctx.fillText(ch, c * cellW, (r + 1) * cellH);
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
  }, [spherePoints]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} aria-hidden />
    </div>
  );
}
