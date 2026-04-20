"use client";

import dynamic from "next/dynamic";

const SceneGraphFusion = dynamic(
  () => import("./SceneGraphFusion").then((m) => m.SceneGraphFusion),
  { ssr: false },
);

type SignalKey = "dom" | "a11y" | "vision" | "time";

type Stream = {
  key: SignalKey;
  label: string;
  color: string;
  caption: string;
  // Anchor corner (percent of the diagram box).
  anchor: { x: string; y: string };
  align: "left" | "right";
  description: string;
};

const STREAMS: Stream[] = [
  {
    key: "dom",
    label: "DOM",
    color: "var(--color-accent-violet)",
    caption: "html > body > main > header > h1 · 847 nodes",
    anchor: { x: "3%", y: "4%" },
    align: "left",
    description: "Structural markup — tags, attributes, text nodes, containment.",
  },
  {
    key: "a11y",
    label: "Accessibility tree",
    color: "var(--color-accent-blue)",
    caption: 'role=heading level=1 · "See the web…"',
    anchor: { x: "3%", y: "4%" },
    align: "right",
    description: "Semantic roles and states derived from ARIA and heuristics.",
  },
  {
    key: "vision",
    label: "Vision",
    color: "var(--color-accent-amber)",
    caption: "primary_cta@(x:234, y:512) conf=0.94",
    anchor: { x: "3%", y: "4%" },
    align: "left",
    description: "Pixel truth — a screenshot parsed by a local vision model.",
  },
  {
    key: "time",
    label: "Time",
    color: "#ff6b35",
    caption: "frame_delta_847ms · state_changed",
    anchor: { x: "3%", y: "4%" },
    align: "right",
    description: "Frame-to-frame deltas that reveal what just changed.",
  },
];

// Corner positions in the diagram container for the label overlays.
const CORNER_POSITIONS: Record<
  SignalKey,
  { top?: string; bottom?: string; left?: string; right?: string; textAlign: "left" | "right" }
> = {
  dom: { top: "6%", left: "3%", textAlign: "left" },
  a11y: { top: "6%", right: "3%", textAlign: "right" },
  vision: { bottom: "6%", left: "3%", textAlign: "left" },
  time: { bottom: "6%", right: "3%", textAlign: "right" },
};

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

        {/* Diagram — canvas-driven ASCII streams converge on a forming
            cluster of voxel-shaded spheres. Labels are HTML overlays. */}
        <div
          className="relative rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/40 overflow-hidden"
          style={{ aspectRatio: "1000 / 560" }}
        >
          <SceneGraphFusion />

          {/* Corner labels + captions */}
          {STREAMS.map((s) => {
            const pos = CORNER_POSITIONS[s.key];
            return (
              <div
                key={`label-${s.key}`}
                className="pointer-events-none absolute z-10"
                style={{
                  top: pos.top,
                  bottom: pos.bottom,
                  left: pos.left,
                  right: pos.right,
                  textAlign: pos.textAlign,
                }}
              >
                <div
                  className="font-display text-[15px] font-semibold text-[color:var(--color-ink)] leading-tight"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {s.label}
                </div>
                <div
                  className="font-mono text-[10px] text-[color:var(--color-ink-faint)] mt-1"
                  style={{ letterSpacing: "0.04em" }}
                >
                  {s.caption}
                </div>
              </div>
            );
          })}

          {/* Center caption — SCENE GRAPH label, positioned below the cluster */}
          <div
            className="pointer-events-none absolute z-10 left-1/2 -translate-x-1/2"
            style={{ top: "62%", textAlign: "center" }}
          >
            <div
              className="font-mono text-[11px] uppercase text-[color:var(--color-ink)]"
              style={{ letterSpacing: "0.22em" }}
            >
              scene graph
            </div>
            <div
              className="font-mono text-[10px] text-[color:var(--color-ink-faint)] mt-1"
              style={{ letterSpacing: "0.15em" }}
            >
              12 mcp tools · one representation
            </div>
          </div>
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
                {s.description}
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
