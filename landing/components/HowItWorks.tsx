"use client";

type Stream = {
  key: "dom" | "a11y" | "vision" | "time";
  label: string;
  color: string;
  caption: string;
  // Start point on the 1000x560 SVG viewBox; streams end at center (500, 280).
  start: { x: number; y: number };
  // Control offset for the quadratic bezier, relative to start.
  control: { x: number; y: number };
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
    control: { x: 260, y: 200 },
    delay: 0,
  },
  {
    key: "a11y",
    label: "Accessibility tree",
    color: "var(--color-accent-blue)",
    caption: 'role=heading level=1 · "See the web…"',
    start: { x: 920, y: 80 },
    control: { x: 740, y: 200 },
    delay: 400,
  },
  {
    key: "vision",
    label: "Vision",
    color: "var(--color-accent-amber)",
    caption: "primary_cta@(x:234, y:512) conf=0.94",
    start: { x: 80, y: 480 },
    control: { x: 260, y: 360 },
    delay: 800,
  },
  {
    key: "time",
    label: "Time",
    color: "color-mix(in oklch, var(--color-ink-dim) 65%, transparent)",
    caption: "frame_delta_847ms · state_changed",
    start: { x: 920, y: 480 },
    control: { x: 740, y: 360 },
    delay: 1200,
  },
];

const CENTER = { x: 500, y: 280 };

// Build a quadratic bezier path that arcs from start to the center.
function pathFor(s: Stream) {
  return `M ${s.start.x} ${s.start.y} Q ${s.control.x} ${s.control.y} ${CENTER.x} ${CENTER.y}`;
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

            {/* Streams */}
            {STREAMS.map((s) => (
              <g key={s.key}>
                {/* Subtle underlay line to give the stream a faint trail */}
                <path
                  d={pathFor(s)}
                  stroke={s.color}
                  strokeOpacity={0.12}
                  strokeWidth={1}
                  fill="none"
                />
                {/* Animated flowing dashes */}
                <path
                  d={pathFor(s)}
                  stroke={s.color}
                  strokeWidth={1.4}
                  fill="none"
                  strokeOpacity={0.9}
                  className={
                    s.key === "time" ? "uipe-stream uipe-stream-slow" : "uipe-stream"
                  }
                  style={{ animationDelay: `-${s.delay}ms` }}
                />
                {/* Origin dot */}
                <circle
                  cx={s.start.x}
                  cy={s.start.y}
                  r={4}
                  fill={s.color}
                  opacity={0.95}
                />
              </g>
            ))}

            {/* Central halo */}
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={120}
              fill="url(#uipe-halo-grad)"
              className="uipe-halo"
            />
            {/* Central core */}
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={44}
              fill="url(#uipe-core-grad)"
              className="uipe-core"
            />
            {/* Central outline ring */}
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={56}
              fill="none"
              stroke="rgba(139,92,246,0.55)"
              strokeWidth={1}
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
