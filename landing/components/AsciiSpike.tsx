"use client";
import { useEffect, useMemo, useRef } from "react";

type Signal = "DOM" | "a11y" | "vision" | "time";
type Pt = [number, number, number];

const SIGNAL_CYCLE: Signal[] = ["DOM", "a11y", "vision", "time"];

// Place 12 nodes on a fibonacci sphere — the whole graph reads as a single
// 3D polyhedron. Each node is also a voxel sphere, so the hero is
// "spheres-on-a-sphere."
const GRAPH_RADIUS = 2.2;
function buildFibNodes(count: number): Array<{ pos: Pt; signal: Signal }> {
  const out: Array<{ pos: Pt; signal: Signal }> = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const theta = Math.acos(1 - 2 * t);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    out.push({
      pos: [
        GRAPH_RADIUS * Math.sin(theta) * Math.cos(phi),
        GRAPH_RADIUS * Math.sin(theta) * Math.sin(phi),
        GRAPH_RADIUS * Math.cos(theta),
      ],
      signal: SIGNAL_CYCLE[i % 4],
    });
  }
  return out;
}
const NODES = buildFibNodes(12);

// Connect each node to its 3 nearest neighbors — clean graph-on-sphere.
function buildNearestEdges(nodes: typeof NODES, k = 3): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const dists = nodes.map((n, j) => {
      if (j === i) return { j, d: Infinity };
      const dx = n.pos[0] - nodes[i].pos[0];
      const dy = n.pos[1] - nodes[i].pos[1];
      const dz = n.pos[2] - nodes[i].pos[2];
      return { j, d: dx * dx + dy * dy + dz * dz };
    }).sort((a, b) => a.d - b.d);
    for (let n = 0; n < k; n++) {
      const j = dists[n].j;
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push(i < j ? [i, j] : [j, i]); }
    }
  }
  return edges;
}
const EDGES = buildNearestEdges(NODES, 3);

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
  // Larger scale factor → graph fills more of the hero; copy still readable
  // on the left half because the hero copy is lg:max-w-[50%].
  const scale = Math.min(w, h) / 1.35;
  const px = (x / d) * scale + w / 2;
  const py = (y / d) * scale + h / 2;
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

  // 460 samples per sphere — dense enough for libretto-like voxel shading
  // at the larger on-screen radius.
  const spherePoints = useMemo(() => fibSphere(460), []);

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

      // Hover: per-node hit test scaled to each sphere's visible radius.
      // Back-hemisphere nodes (large d) are skipped so the front sphere can
      // always "take" the hover when the cursor is over it.
      let hoverIdx = -1;
      let hoverBoost = 0;
      if (mouse.current.active) {
        for (let i = 0; i < projected.length; i++) {
          const [nx, ny, depth] = projected[i];
          if (depth > 4.8) continue; // back side of the graph shell
          const nodeR = 90 / Math.max(1.2, depth - 1.5);
          const hitR = nodeR * 1.45;
          const d = Math.hypot(nx - mouse.current.x, ny - mouse.current.y);
          if (d < hitR) {
            const localBoost = 1 - d / hitR;
            if (localBoost > hoverBoost) {
              hoverBoost = localBoost;
              hoverIdx = i;
            }
          }
        }
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
        const nodeMargin = 80;

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
          if (distA < 72 || distB < 72) continue;
          ctx.fillStyle = COLOR[p.signal];
          ctx.fillText(p.content, x, y);
        }
      }

      // 3) Nodes as light-shaded voxel spheres (libretto-style 3D).
      for (let i = 0; i < NODES.length; i++) {
        const [cx, cy, depth] = projected[i];
        const baseR = 90;
        const depthR = baseR / Math.max(1.2, depth - 1.5);
        const boostR = i === hoverIdx ? depthR * (1 + hoverBoost * 0.55) : depthR;

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
          if (i === hoverIdx) intensity = Math.min(1, intensity + hoverBoost * 0.38);
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
