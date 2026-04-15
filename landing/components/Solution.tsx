"use client";

type Artifact =
  | { kind: "scene"; rows: Array<{ tag: string; attrs?: string; role?: string; note?: string; violet?: boolean }> }
  | { kind: "config"; lines: Array<{ key?: string; value?: string; comment?: string }> }
  | { kind: "timeline"; frames: Array<{ t: string; state: string; delta?: string }> };

type Prop = {
  index: string;
  title: string;
  body: string;
  artifact: Artifact;
};

const PROPS: Prop[] = [
  {
    index: "01",
    title: "Human-level understanding.",
    body: "Not just HTML. The page the way a human sees it — visual hierarchy, state, motion, meaning. Every node carries role, affordance, salience, and confirmed text.",
    artifact: {
      kind: "scene",
      rows: [
        { tag: "heading", role: "heading[1]", note: "salience=0.98" },
        { tag: "button", role: "button", note: "primary · violet glow", violet: true },
        { tag: "form", role: "form", note: "1 input · 1 submit" },
        { tag: "textbox", role: "textbox", attrs: "email · required" },
        { tag: "region", role: "decoration", note: "non-interactive" },
      ],
    },
  },
  {
    index: "02",
    title: "MCP-native.",
    body: "One line in your agent's config. Works with Claude Code, Cursor, Zed — anything that speaks MCP. No adapters, no wrappers, no bespoke plumbing.",
    artifact: {
      kind: "config",
      lines: [
        { key: "mcpServers", value: "{" },
        { key: "  uipe", value: "{" },
        { key: "    url", value: '"https://mcpaasta.uipe.dev/mcp"' },
        { key: "    transport", value: '"sse"' },
        { value: "  }" },
        { value: "}" },
        { comment: "// 12 tools exposed · one config line" },
      ],
    },
  },
  {
    index: "03",
    title: "Temporal awareness.",
    body: "Knows what just happened. Did the click work? Did the page load? Did that spinner stop? Frame-by-frame diffs turn guesswork into ground truth.",
    artifact: {
      kind: "timeline",
      frames: [
        { t: "t+0ms", state: "click(button.primary)" },
        { t: "t+127ms", state: "url_changed", delta: "/login → /dashboard" },
        { t: "t+841ms", state: "loaded", delta: "role=main appeared" },
        { t: "t+2.1s", state: "settled", delta: "no layout shift" },
      ],
    },
  },
];

function Artifact({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "scene") {
    return (
      <div className="font-mono text-[12px] leading-[1.55] space-y-[3px]">
        {artifact.rows.map((row, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span
              className={
                row.violet
                  ? "text-[color:var(--color-accent-violet)]"
                  : "text-[color:var(--color-accent-violet)]/85"
              }
            >
              {row.tag}
            </span>
            {row.role && (
              <span className="text-[color:var(--color-accent-amber)]">
                role={row.role}
              </span>
            )}
            {row.attrs && (
              <span className="text-[color:var(--color-ink-faint)]">
                {row.attrs}
              </span>
            )}
            {row.note && (
              <span className="text-[color:var(--color-ink-faint)] italic">
                {row.note}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (artifact.kind === "config") {
    return (
      <div className="font-mono text-[12px] leading-[1.55]">
        {artifact.lines.map((line, i) => {
          if (line.comment) {
            return (
              <div
                key={i}
                className="text-[color:var(--color-ink-faint)] mt-2"
              >
                {line.comment}
              </div>
            );
          }
          return (
            <div key={i} className="flex">
              {line.key && (
                <>
                  <span className="text-[color:var(--color-accent-violet)]">
                    &quot;{line.key.trimStart()}&quot;
                  </span>
                  <span className="text-[color:var(--color-ink-faint)]">
                    :&nbsp;
                  </span>
                </>
              )}
              <span className="text-[color:var(--color-ink)]">
                {line.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="font-mono text-[12px] leading-[1.55] space-y-1.5">
      {artifact.frames.map((frame, i) => (
        <div key={i} className="flex items-baseline gap-3">
          <span className="text-[color:var(--color-ink-faint)] w-[4.5rem] shrink-0">
            {frame.t}
          </span>
          <span className="text-[color:var(--color-accent-violet)]">
            {frame.state}
          </span>
          {frame.delta && (
            <span className="text-[color:var(--color-ink-dim)]">
              → {frame.delta}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ prop, alt }: { prop: Prop; alt: boolean }) {
  // Staggered layout: copy + artifact swap sides on alternating rows,
  // and odd rows get a slight left offset to break symmetry.
  return (
    <div
      className={`grid grid-cols-1 lg:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.1fr)] gap-6 lg:gap-10 items-start py-14 sm:py-20 border-b border-[color:var(--color-line)]/40 ${
        alt ? "lg:pl-16" : ""
      }`}
    >
      {/* Index gutter */}
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)] pt-2 lg:pt-3">
        §02·{prop.index}
      </div>

      {/* Copy — on alt rows, render the artifact first then copy by reversing
          order visually with order- utilities. Kept conservative to keep a
          clear left-to-right read on mobile. */}
      <div className={`max-w-[42ch] ${alt ? "lg:order-3" : ""}`}>
        <h3 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-0.02em] leading-[1.1] text-balance">
          {prop.title}
        </h3>
        <p className="mt-4 text-[15px] sm:text-base text-[color:var(--color-ink-dim)] leading-[1.65]">
          {prop.body}
        </p>
      </div>

      {/* Artifact — terminal-chrome block echoing Problem.tsx */}
      <div className={alt ? "lg:order-2" : ""}>
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-line)]/60 bg-black/20">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-violet)]/80" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-blue)]/60" />
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-amber)]/60" />
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
              {prop.artifact.kind === "scene"
                ? "scene_graph.json"
                : prop.artifact.kind === "config"
                  ? "mcp.config.json"
                  : "frame_delta.log"}
            </span>
          </div>
          <div className="p-4 overflow-x-auto">
            <Artifact artifact={prop.artifact} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Solution() {
  return (
    <section
      id="solution"
      className="relative border-b border-[color:var(--color-line)]/40 bg-[color:var(--color-bg)]"
    >
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 pt-24 sm:pt-32">
        {/* Eyebrow rail */}
        <div className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-line)]/50 pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            §02 · the solution
          </span>
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            three signals · one representation
          </span>
        </div>

        {/* Section intro */}
        <div className="max-w-[52ch] pt-12 sm:pt-16 pb-4">
          <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] text-balance">
            A unified scene graph
            <br />
            <span className="text-[color:var(--color-ink-dim)]">
              your agent can actually reason about.
            </span>
          </h2>
        </div>

        {/* Staggered rows */}
        <div>
          {PROPS.map((prop, i) => (
            <Row key={prop.index} prop={prop} alt={i % 2 === 1} />
          ))}
        </div>

        {/* Section footer note */}
        <div className="pt-10 pb-24 sm:pb-32">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            exposed as 12 mcp tools · drop-in for claude code, cursor, zed.
          </p>
        </div>
      </div>
    </section>
  );
}
