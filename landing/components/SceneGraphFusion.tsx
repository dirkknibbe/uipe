"use client";

import { useEffect, useMemo, useRef } from "react";

type SignalKey = "dom" | "a11y" | "vision" | "time";
type Vec3 = [number, number, number];

// Start anchors expressed in the 1000×560 virtual viewBox so they track
// cleanly with the labels regardless of the actual canvas size.
const SIGNALS: Array<{
  key: SignalKey;
  color: string;
  start: [number, number];
}> = [
  { key: "dom", color: "#8b5cf6", start: [80, 80] },
  { key: "a11y", color: "#38bdf8", start: [920, 80] },
  { key: "vision", color: "#f59e0b", start: [80, 480] },
  { key: "time", color: "#ff6b35", start: [920, 480] },
];

const CENTER: [number, number] = [500, 280];
const VB_W = 1000;
const VB_H = 560;

const JUNK = "0123456789abcdefABCDEF!?/.:;-=+*^~<>[](){}";
const NODE_RAMP = " .,:;+*=#%@";

// Timing (seconds)
const STAGGER = 1.1; // gap between stream starts
const STREAM_DURATION = 1.9; // time for a stream to reach center
const SPHERE_FORM = 0.7; // time for its sphere to materialize once arrived
const HOLD = 2.4; // time all four stay fully formed
const FADE = 1.4; // fade-out
const LOOP =
  STAGGER * (SIGNALS.length - 1) + STREAM_DURATION + SPHERE_FORM + HOLD + FADE;

const LIGHT_RAW: Vec3 = [-0.45, -0.6, 0.7];
const LIGHT_MAG = Math.hypot(LIGHT_RAW[0], LIGHT_RAW[1], LIGHT_RAW[2]);
const LIGHT: Vec3 = [
  LIGHT_RAW[0] / LIGHT_MAG,
  LIGHT_RAW[1] / LIGHT_MAG,
  LIGHT_RAW[2] / LIGHT_MAG,
];

function fibSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
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

function rotateY(p: Vec3, angle: number): Vec3 {
  const [x, y, z] = p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, y, -x * s + z * c];
}

function rotateX(p: Vec3, angle: number): Vec3 {
  const [x, y, z] = p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, y * c - z * s, y * s + z * c];
}

function hashedChar(a: number, b: number): string {
  let s = ((a * 2654435761) ^ (b * 40503)) >>> 0;
  s = (s ^ (s >>> 13)) * 0x5bd1e995;
  s = s >>> 0;
  return JUNK[s % JUNK.length];
}

export function SceneGraphFusion() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sphere = useMemo(() => fibSphere(220), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const startTime = performance.now();
    const fontSize = 11;
    const cellW = 6.6;
    const cellH = 12;

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

    const draw = (now: number) => {
      const t = (now - startTime) / 1000;
      const cycle = t % LOOP;

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      // Scale viewBox → canvas, preserving aspect with letterbox.
      const scale = Math.min(W / VB_W, H / VB_H);
      const offX = (W - VB_W * scale) / 2;
      const offY = (H - VB_H * scale) / 2;
      const toCanvas = (x: number, y: number): [number, number] => [
        offX + x * scale,
        offY + y * scale,
      ];
      const [cx, cy] = toCanvas(CENTER[0], CENTER[1]);

      // Global fade envelope (fade out at end of loop).
      const lastPhaseStart = LOOP - FADE;
      const fadeOut =
        cycle < lastPhaseStart
          ? 1
          : 1 - (cycle - lastPhaseStart) / FADE;

      ctx.clearRect(0, 0, W, H);

      // === Streams: flowing junk chars from each anchor to center ===
      for (let i = 0; i < SIGNALS.length; i++) {
        const sig = SIGNALS[i];
        const streamT0 = i * STAGGER;
        const streamT1 = streamT0 + STREAM_DURATION;
        if (cycle < streamT0) continue;
        const streamHold = Math.min(1, (cycle - streamT0) / STREAM_DURATION);

        const [sx, sy] = toCanvas(sig.start[0], sig.start[1]);
        const dx = cx - sx;
        const dy = cy - sy;
        const len = Math.hypot(dx, dy);
        const step = cellW * 1.05;
        const steps = Math.max(1, Math.floor(len / step));
        const reachEnd = steps * streamHold;
        const scroll = t * 8 + i * 3;
        const centerMargin = 42; // keep space around the sphere cluster
        ctx.fillStyle = sig.color;
        for (let s = 0; s <= steps; s++) {
          if (s > reachEnd) break;
          const frac = s / steps;
          const x = sx + dx * frac;
          const y = sy + dy * frac;
          const distFromCenter = Math.hypot(x - cx, y - cy);
          if (distFromCenter < centerMargin) continue;
          const distFromStart = Math.hypot(x - sx, y - sy);
          if (distFromStart < 14) continue;
          // Tail fade — the last few chars of the traveling front are dimmer.
          const trailDist = reachEnd - s;
          let alpha = 0.55 + 0.35 * Math.min(1, trailDist / 10);
          if (cycle >= streamT1) {
            // Once arrived, stream dims to ambient level while the sphere
            // takes over as the focal point.
            const postArrival = cycle - streamT1;
            alpha = Math.max(0.25, 0.55 - postArrival * 0.15);
          }
          alpha *= fadeOut;
          ctx.globalAlpha = alpha;
          const ch = hashedChar(i * 101 + s, Math.floor(scroll));
          ctx.fillText(ch, x, y);
        }
        ctx.globalAlpha = 1;
      }

      // === Central cluster: one voxel-shaded ASCII sphere per signal ===
      // Each sphere forms as its stream arrives. Four arranged in a tight
      // cluster so they read as the scene-graph node being assembled.
      const rx = Math.sin(t * 0.25) * 0.2;
      const ry = t * 0.3;

      // Per-frame buffer (reused implicitly via Map/clear below).
      const cellIntensity = new Map<string, number>();
      const cellGlyph = new Map<string, string>();
      const cellColor = new Map<string, string>();

      for (let i = 0; i < SIGNALS.length; i++) {
        const sig = SIGNALS[i];
        const arriveT = i * STAGGER + STREAM_DURATION;
        if (cycle < arriveT) continue;
        const sphereProgress = Math.min(
          1,
          (cycle - arriveT) / SPHERE_FORM,
        );

        // Cluster offset — 4 spheres around the center, like a tetrahedron
        // flattened to 2D with slight vertical variation.
        const angle = (i / SIGNALS.length) * Math.PI * 2 - Math.PI / 4;
        const clusterR = 14 * scale;
        const nx = cx + Math.cos(angle) * clusterR;
        const ny = cy + Math.sin(angle) * clusterR * 0.75;
        const baseR = 22 * scale * (0.35 + 0.65 * sphereProgress);

        for (const sp of sphere) {
          let rot = rotateY(sp, ry + i * 0.8);
          rot = rotateX(rot, rx);
          if (rot[2] < -0.05) continue;
          const sxp = nx + rot[0] * baseR;
          const syp = ny + rot[1] * baseR;
          let ndotl = rot[0] * LIGHT[0] + rot[1] * LIGHT[1] + rot[2] * LIGHT[2];
          ndotl = Math.max(0, ndotl);
          const intensity = 0.18 + ndotl * 0.82;
          if (intensity < 0.1) continue;
          const rampIdx = Math.min(
            NODE_RAMP.length - 1,
            Math.floor(intensity * NODE_RAMP.length),
          );
          const ch = NODE_RAMP[rampIdx];
          const cellKey = `${Math.round(syp / cellH)},${Math.round(sxp / cellW)}`;
          const prev = cellIntensity.get(cellKey) ?? 0;
          if (intensity > prev) {
            cellIntensity.set(cellKey, intensity);
            cellGlyph.set(cellKey, ch);
            cellColor.set(cellKey, sig.color);
          }
        }

        // Faint connecting edges to every already-formed neighbor: when the
        // 2nd sphere materializes, an edge appears to the 1st; and so on.
        if (i > 0) {
          const prevArrive = (i - 1) * STAGGER + STREAM_DURATION + SPHERE_FORM;
          if (cycle >= prevArrive) {
            const prevAngle = ((i - 1) / SIGNALS.length) * Math.PI * 2 - Math.PI / 4;
            const prevNx = cx + Math.cos(prevAngle) * clusterR;
            const prevNy = cy + Math.sin(prevAngle) * clusterR * 0.75;
            ctx.strokeStyle = "rgba(168,162,158,0.35)";
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(prevNx, prevNy);
            ctx.lineTo(nx, ny);
            ctx.stroke();
          }
        }
      }

      // Paint the cluster cells.
      ctx.globalAlpha = fadeOut;
      for (const [key, ch] of cellGlyph) {
        const [r, c] = key.split(",").map(Number);
        ctx.fillStyle = cellColor.get(key) ?? "#ffffff";
        ctx.fillText(ch, c * cellW, (r + 1) * cellH);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sphere]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
