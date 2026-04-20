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
