"use client";

import { motion } from "motion/react";

type Stream = {
  key: "dom" | "a11y" | "vision" | "time";
  label: string;
  color: string;
  caption: string;
  // Start point on the 1000x560 SVG viewBox; streams end at center (500, 280).
  start: { x: number; y: number };
  // Phase (radians) for the sine wiggle that makes strands cross — offsets
  // between strands are what produces the weave.
  phase: number;
  // Delay (ms) for staggered entrance.
  delay: number;
};

const STREAMS: Stream[] = [
  {
    key: "dom",
    label: "DOM",
    color: "var(--color-accent-violet)",
    caption: "html > body > main > header > h1 · 847 nodes",
    start: { x: 80, y: 80 },
    phase: 0,
    delay: 0,
  },
  {
    key: "a11y",
    label: "Accessibility tree",
    color: "var(--color-accent-blue)",
    caption: 'role=heading level=1 · "See the web…"',
    start: { x: 920, y: 80 },
    phase: Math.PI,
    delay: 400,
  },
  {
    key: "vision",
    label: "Vision",
    color: "var(--color-accent-amber)",
    caption: "primary_cta@(x:234, y:512) conf=0.94",
    start: { x: 80, y: 480 },
    phase: Math.PI * 0.5,
    delay: 800,
  },
  {
    key: "time",
    label: "Time",
    color: "color-mix(in oklch, var(--color-ink-dim) 65%, transparent)",
    caption: "frame_delta_847ms · state_changed",
    start: { x: 920, y: 480 },
    phase: Math.PI * 1.5,
    delay: 1200,
  },
];

const CENTER = { x: 500, y: 280 };

// Build a wiggly path from start to center. The strand follows the straight
// line start → center but oscillates perpendicular to it with a sine wave,
// enveloped so the wiggle fades to zero at both endpoints. Different phases
// across strands make them cross each other en route, forming a braid.
function pathFor(s: Stream) {
  const steps = 80;
  const dx = CENTER.x - s.start.x;
  const dy = CENTER.y - s.start.y;
  const len = Math.hypot(dx, dy);
  // Perpendicular unit vector for the wiggle offset.
  const pxDir = -dy / len;
  const pyDir = dx / len;
  const amp = 70;            // wiggle amplitude
  const crossings = 2.6;     // number of sine half-cycles along the strand
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Straight-line baseline.
    const bx = s.start.x + dx * t;
    const by = s.start.y + dy * t;
    // Envelope — sin(πt) — zero at both endpoints, peak mid-strand.
    const envelope = Math.sin(t * Math.PI);
    const w = Math.sin(t * Math.PI * crossings + s.phase) * amp * envelope;
    const x = bx + pxDir * w;
    const y = by + pyDir * w;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export function HowItWorks() {
  return (
    <section
      id="how"
      className="relative border-b border-[color:var(--color-line)]/40 bg-[color:var(--color-bg)]"
    >
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 pt-24 sm:pt-32">
        {/* Eyebrow rail */}
        <div className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-line)]/50 pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            §03 · how it works
          </span>
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            four signals · one representation
          </span>
        </div>

        {/* Intro */}
        <div className="max-w-[52ch] pt-12 sm:pt-16 pb-8">
          <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] text-balance">
            Four signals,
            <br />
            <span className="text-[color:var(--color-ink-dim)]">
              fused into one scene graph.
            </span>
          </h2>
          <p className="mt-6 text-[15px] sm:text-base text-[color:var(--color-ink-dim)] leading-[1.65] max-w-[48ch]">
            UIPE captures what a browser renders and what a user experiences —
            then merges them. The result is a single representation your agent
            can reason about in one pass.
          </p>
        </div>

        {/* Diagram */}
        <div className="relative rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/40 overflow-hidden">
          {/* Scoped CSS for stream dash animation */}
          <style>{`
            @keyframes uipe-flow {
              from { stroke-dashoffset: 0; }
              to { stroke-dashoffset: -240; }
            }
            @keyframes uipe-pulse {
              0%, 100% { transform: scale(1); opacity: 0.9; }
              50% { transform: scale(1.08); opacity: 1; }
            }
            @keyframes uipe-halo {
              0%, 100% { opacity: 0.35; transform: scale(1); }
              50% { opacity: 0.7; transform: scale(1.15); }
            }
            .uipe-stream {
              stroke-dasharray: 4 10;
              animation: uipe-flow 3.2s linear infinite;
            }
            .uipe-stream-slow {
              animation-duration: 6s;
            }
            .uipe-core {
              transform-origin: 500px 280px;
              transform-box: fill-box;
              animation: uipe-pulse 2.6s ease-in-out infinite;
            }
            .uipe-halo {
              transform-origin: 500px 280px;
              animation: uipe-halo 2.6s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .uipe-stream, .uipe-core, .uipe-halo {
                animation: none;
              }
            }
          `}</style>

          <svg
            viewBox="0 0 1000 560"
            className="w-full h-auto block"
            role="img"
            aria-label="Four signals — DOM, accessibility tree, vision, and time — converge into a unified scene graph"
          >
            <defs>
              <radialGradient id="uipe-core-grad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="rgba(139,92,246,0.9)" />
                <stop offset="45%" stopColor="rgba(59,130,246,0.35)" />
                <stop offset="100%" stopColor="rgba(11,11,15,0)" />
              </radialGradient>
              <radialGradient id="uipe-halo-grad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="rgba(139,92,246,0.45)" />
                <stop offset="60%" stopColor="rgba(139,92,246,0.12)" />
                <stop offset="100%" stopColor="rgba(11,11,15,0)" />
              </radialGradient>
            </defs>

            {/* Streams — each knits in from its origin to the center, one
                after another, in stagger. Full loop: all four knit in,
                hold, then fade out together. */}
            {STREAMS.map((s, i) => {
              const stream_in = 2.0;     // seconds for a strand to draw
              const stagger = 0.55;      // seconds between strands starting
              const total_in = stream_in + stagger * (STREAMS.length - 1);
              const hold = 2.4;
              const fade = 1.2;
              const loop = total_in + hold + fade;
              const myStart = stagger * i;
              const myEnd = myStart + stream_in;
              return (
                <g key={s.key}>
                  {/* Static underlay trail */}
                  <path
                    d={pathFor(s)}
                    stroke={s.color}
                    strokeOpacity={0.12}
                    strokeWidth={1}
                    fill="none"
                  />
                  {/* Motion-driven "knit" — pathLength animates 0→1, stays
                      lit through hold, then fades opacity at the end. */}
                  <motion.path
                    d={pathFor(s)}
                    stroke={s.color}
                    strokeWidth={1.6}
                    fill="none"
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0.35 }}
                    animate={{
                      pathLength: [0, 0, 1, 1, 0],
                      opacity: [0.35, 0.35, 0.95, 0.95, 0.1],
                    }}
                    transition={{
                      duration: loop,
                      times: [
                        0,
                        myStart / loop,
                        myEnd / loop,
                        (total_in + hold) / loop,
                        1,
                      ],
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  {/* Packet head — small node that rides the front of the
                      stream and "arrives" at the center. */}
                  <motion.circle
                    r={3.5}
                    fill={s.color}
                    initial={{ opacity: 0 }}
                    animate={{
                      offsetDistance: ["0%", "0%", "100%", "100%", "100%"],
                      opacity: [0, 1, 1, 0, 0],
                    }}
                    style={{
                      offsetPath: `path("${pathFor(s)}")`,
                      offsetRotate: "0deg",
                    }}
                    transition={{
                      duration: loop,
                      times: [
                        0,
                        myStart / loop,
                        myEnd / loop,
                        (myEnd + 0.15) / loop,
                        1,
                      ],
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  {/* Origin dot pulses when this strand starts drawing */}
                  <motion.circle
                    cx={s.start.x}
                    cy={s.start.y}
                    r={4}
                    fill={s.color}
                    initial={{ opacity: 0.6 }}
                    animate={{ opacity: [0.6, 0.6, 1, 1, 0.3] }}
                    transition={{
                      duration: loop,
                      times: [
                        0,
                        (myStart - 0.1) / loop,
                        myStart / loop,
                        (total_in + hold) / loop,
                        1,
                      ],
                      repeat: Infinity,
                    }}
                  />
                </g>
              );
            })}

            {/* Central halo — brightens as each strand arrives, peak once
                all four are in. */}
            <motion.circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={120}
              fill="url(#uipe-halo-grad)"
              initial={{ opacity: 0.2, scale: 0.9 }}
              animate={{
                opacity: [0.2, 0.28, 0.42, 0.58, 0.75, 0.4, 0.15],
                scale: [0.9, 0.93, 0.98, 1.04, 1.1, 1.0, 0.9],
              }}
              transition={{
                duration: 2.0 + 0.55 * 3 + 2.4 + 1.2,
                times: [0, 0.12, 0.28, 0.45, 0.62, 0.82, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }}
              style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}
            />
            {/* Central core */}
            <motion.circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={44}
              fill="url(#uipe-core-grad)"
              initial={{ opacity: 0.4, scale: 0.92 }}
              animate={{
                opacity: [0.4, 0.55, 0.7, 0.85, 1.0, 0.65, 0.25],
                scale: [0.92, 0.95, 1.0, 1.05, 1.12, 1.0, 0.9],
              }}
              transition={{
                duration: 2.0 + 0.55 * 3 + 2.4 + 1.2,
                times: [0, 0.12, 0.28, 0.45, 0.62, 0.82, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }}
              style={{ transformOrigin: `${CENTER.x}px ${CENTER.y}px` }}
            />
            {/* Central outline ring */}
            <motion.circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={56}
              fill="none"
              stroke="rgba(139,92,246,0.55)"
              strokeWidth={1}
              initial={{ opacity: 0.3 }}
              animate={{ opacity: [0.3, 0.4, 0.6, 0.85, 0.45, 0.2] }}
              transition={{
                duration: 2.0 + 0.55 * 3 + 2.4 + 1.2,
                times: [0, 0.2, 0.45, 0.62, 0.82, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            {/* Central inner nodes hint — three small instances mirroring the hero */}
            <g opacity={0.95}>
              <circle cx={CENTER.x - 12} cy={CENTER.y - 6} r={3.5} fill="#8b5cf6" />
              <circle cx={CENTER.x + 10} cy={CENTER.y + 4} r={3} fill="#38bdf8" />
              <circle cx={CENTER.x - 2} cy={CENTER.y + 14} r={2.5} fill="#f59e0b" />
              <line
                x1={CENTER.x - 12}
                y1={CENTER.y - 6}
                x2={CENTER.x + 10}
                y2={CENTER.y + 4}
                stroke="rgba(245,245,247,0.35)"
                strokeWidth={0.8}
              />
              <line
                x1={CENTER.x + 10}
                y1={CENTER.y + 4}
                x2={CENTER.x - 2}
                y2={CENTER.y + 14}
                stroke="rgba(245,245,247,0.35)"
                strokeWidth={0.8}
              />
            </g>

            {/* Stream labels + captions */}
            {STREAMS.map((s) => {
              const anchor = s.start.x < CENTER.x ? "start" : "end";
              const labelX = s.start.x + (anchor === "start" ? 12 : -12);
              const labelY = s.start.y;
              return (
                <g key={`label-${s.key}`}>
                  <text
                    x={labelX}
                    y={labelY - 6}
                    textAnchor={anchor}
                    fill="var(--color-ink)"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {s.label}
                  </text>
                  <text
                    x={labelX}
                    y={labelY + 12}
                    textAnchor={anchor}
                    fill="var(--color-ink-faint)"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.caption}
                  </text>
                </g>
              );
            })}

            {/* Center label */}
            <text
              x={CENTER.x}
              y={CENTER.y + 96}
              textAnchor="middle"
              fill="var(--color-ink)"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
              }}
            >
              scene graph
            </text>
            <text
              x={CENTER.x}
              y={CENTER.y + 114}
              textAnchor="middle"
              fill="var(--color-ink-faint)"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.15em",
              }}
            >
              12 mcp tools · one representation
            </text>
          </svg>
        </div>

        {/* Legend below the diagram — clarifies what each signal captures */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 pt-12">
          {STREAMS.map((s) => (
            <div key={`legend-${s.key}`} className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                  {s.key}
                </span>
              </div>
              <div className="font-display text-[15px] font-semibold text-[color:var(--color-ink)]">
                {s.label}
              </div>
              <p className="text-[13px] text-[color:var(--color-ink-dim)] leading-[1.55]">
                {s.key === "dom" &&
                  "Structural markup — tags, attributes, text nodes, containment."}
                {s.key === "a11y" &&
                  "Semantic roles and states derived from ARIA and heuristics."}
                {s.key === "vision" &&
                  "Pixel truth — a screenshot parsed by a local vision model."}
                {s.key === "time" &&
                  "Frame-to-frame deltas that reveal what just changed."}
              </p>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div className="pt-12 pb-24 sm:pb-32">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            no single signal is enough. the fusion is the product.
          </p>
        </div>
      </div>
    </section>
  );
}
