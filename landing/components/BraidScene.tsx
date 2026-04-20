"use client";

import { motion } from "motion/react";

const VIEW_W = 1600;
const VIEW_H = 720;

const SIGNALS = [
  { name: "DOM", color: "#7dd3fc", freq: 3.8, amp: 120, thick: 1.6 },
  { name: "a11y", color: "#c084fc", freq: 4.2, amp: 110, thick: 1.6 },
  { name: "vision", color: "#d4d4d8", freq: 4.0, amp: 115, thick: 1.4 },
  { name: "time", color: "#ff6b35", freq: 3.6, amp: 130, thick: 2.0 },
] as const;

const STEPS = 180; // path resolution

function strandPath(
  phase: number,
  amp: number,
  freq: number,
  width: number,
  height: number,
): string {
  const cy = height / 2;
  const pts: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = t * width;
    // Primary sine + slower secondary for richer weave.
    const y =
      cy +
      Math.sin(t * Math.PI * freq + phase) * amp +
      Math.sin(t * Math.PI * (freq / 2.3) + phase * 1.7) * (amp * 0.22);
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

// A faint mesh of "joining" short connector lines at the right side of the
// canvas — where the braid resolves into a single coherent graph. Static SVG,
// animated opacity on loop so it pulses as the strands arrive.
function JoinMesh() {
  const joinX = VIEW_W * 0.78;
  const joinY = VIEW_H / 2;
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return {
      x2: joinX + Math.cos(a) * 110,
      y2: joinY + Math.sin(a) * 90,
    };
  });
  return (
    <motion.g
      animate={{ opacity: [0.15, 0.45, 0.15] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
    >
      {rays.map((r, i) => (
        <line
          key={i}
          x1={joinX}
          y1={joinY}
          x2={r.x2}
          y2={r.y2}
          stroke="#a8a29e"
          strokeWidth="0.6"
          strokeLinecap="round"
        />
      ))}
      <circle cx={joinX} cy={joinY} r="3" fill="#a8a29e" />
    </motion.g>
  );
}

export function BraidScene() {
  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* Very faint horizontal rule at the braid centerline — an editorial
            beat that anchors the weave. */}
        <line
          x1={0}
          y1={VIEW_H / 2}
          x2={VIEW_W}
          y2={VIEW_H / 2}
          stroke="#ffffff"
          strokeOpacity={0.04}
          strokeWidth={0.5}
        />

        <JoinMesh />

        {SIGNALS.map((sig, i) => {
          const phase = (i / SIGNALS.length) * Math.PI * 2;
          const d = strandPath(phase, sig.amp, sig.freq, VIEW_W, VIEW_H);
          return (
            <motion.path
              key={sig.name}
              d={d}
              stroke={sig.color}
              strokeWidth={sig.thick}
              strokeLinecap="round"
              fill="none"
              style={{
                // Glow via SVG filter would be nice but costs performance;
                // stroke already reads luminous on the dark bg.
                mixBlendMode: "screen",
              }}
              initial={{ pathLength: 0, opacity: 0.4 }}
              animate={{
                pathLength: [0, 1, 1, 0],
                opacity: [0.4, 0.85, 0.85, 0.25],
              }}
              transition={{
                duration: 7.5,
                times: [0, 0.4, 0.7, 1],
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.25, // staggered start = braiding effect
              }}
            />
          );
        })}

        {/* Signal labels, drifting in behind their strands */}
        {SIGNALS.map((sig, i) => (
          <motion.text
            key={`label-${sig.name}`}
            x={40}
            y={VIEW_H / 2 - 140 + i * 90}
            fontFamily="JetBrains Mono, monospace"
            fontSize={11}
            fill={sig.color}
            style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.65, 0.65, 0] }}
            transition={{
              duration: 7.5,
              times: [0, 0.4, 0.7, 1],
              repeat: Infinity,
              delay: i * 0.25,
            }}
          >
            {sig.name}
          </motion.text>
        ))}
      </svg>
    </div>
  );
}
