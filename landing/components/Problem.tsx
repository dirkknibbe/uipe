"use client";

type TreeNode = {
  tag: string;
  attrs?: string;
  text?: string;
  children?: TreeNode[];
  role?: string;
  note?: string;
  muted?: boolean;
};

function Tree({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const pad = depth * 14;
  return (
    <div>
      <div
        className="flex items-baseline gap-2 py-[3px] leading-[1.4]"
        style={{ paddingLeft: pad }}
      >
        <span
          className={
            node.muted
              ? "text-[color:var(--color-ink-faint)]"
              : "text-[color:var(--color-accent-violet)]"
          }
        >
          {node.tag}
        </span>
        {node.attrs && (
          <span className="text-[color:var(--color-ink-faint)]">
            {node.attrs}
          </span>
        )}
        {node.role && (
          <span className="text-[color:var(--color-accent-amber)]">
            role={node.role}
          </span>
        )}
        {node.text && (
          <span className="text-[color:var(--color-ink)]">
            &quot;{node.text}&quot;
          </span>
        )}
        {node.note && (
          <span className="text-[color:var(--color-ink-faint)] italic">
            {node.note}
          </span>
        )}
      </div>
      {node.children?.map((child, i) => (
        <Tree key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// Actual structural output of our own landing as captured by a naive
// DOM walker — the kind of signal an agent without UIPE has access to.
const BEFORE: TreeNode = {
  tag: "section",
  attrs: ".relative",
  children: [
    { tag: "header", children: [{ tag: "nav", note: "4 links, no context" }] },
    {
      tag: "div",
      attrs: ".grid",
      children: [
        {
          tag: "div",
          attrs: ".flex.flex-col",
          children: [
            { tag: "div", note: "empty wrapper" },
            {
              tag: "h1",
              children: [
                { tag: "span", text: "See the web", muted: true },
                { tag: "span", text: "the way humans do." },
              ],
            },
            { tag: "p", text: "A perception layer that gives your…" },
            {
              tag: "form",
              children: [
                { tag: "input", attrs: "type=email, placeholder=you@…" },
                { tag: "button", text: "Join the waitlist" },
              ],
            },
          ],
        },
        { tag: "div", attrs: ".hidden.lg:block", note: "canvas — opaque" },
      ],
    },
  ],
};

// Same page, enriched by UIPE's fused scene graph. Every node has
// role, affordance, visual salience, and confirmed text.
const AFTER: TreeNode = {
  tag: "scene",
  attrs: "viewport=1440x900",
  children: [
    {
      tag: "region",
      role: "banner",
      note: "top navigation — 4 anchor links",
    },
    {
      tag: "region",
      role: "hero",
      children: [
        {
          tag: "heading",
          role: "heading[1]",
          text: "See the web the way humans do.",
          note: "primary, 72px, salience=0.98",
        },
        {
          tag: "text",
          text: "A perception layer that gives your agent human-level web understanding…",
        },
        {
          tag: "form",
          role: "form",
          note: "waitlist capture — 1 input, 1 submit",
          children: [
            {
              tag: "textbox",
              role: "textbox",
              attrs: "email · required",
            },
            {
              tag: "button",
              role: "button",
              text: "Join the waitlist",
              note: "primary CTA · violet glow · salience=0.92",
            },
          ],
        },
      ],
    },
    {
      tag: "region",
      role: "decoration",
      note: "3D scene graph — animated, non-interactive",
    },
  ],
};

export function Problem() {
  return (
    <section
      id="problem"
      className="relative border-b border-[color:var(--color-line)]/40 bg-[color:var(--color-bg)]"
    >
      {/* Section eyebrow rail */}
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 pt-24 sm:pt-32">
        <div className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-line)]/50 pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            §01 · the problem
          </span>
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            proof · captured on this page
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.1fr)] gap-10 lg:gap-16 pt-12 sm:pt-16">
          {/* Left: the argument */}
          <div className="max-w-[52ch] space-y-6">
            <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] text-balance">
              Agents can read HTML.
              <br />
              <span className="text-[color:var(--color-ink-dim)]">
                They can&rsquo;t see the page.
              </span>
            </h2>
            <p className="text-lg text-[color:var(--color-ink-dim)] leading-[1.6]">
              Modern web apps hide meaning in CSS, layout, animation, and
              canvas rendering. An agent with only DOM access is blind to what
              a human instantly understands — which button is primary, what
              state a form is in, whether the spinner means loading or frozen.
            </p>
            <p className="text-lg text-[color:var(--color-ink-dim)] leading-[1.6]">
              This is why agents that work great in demos fall apart on real
              websites.
            </p>

            <div className="pt-4 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/50 p-5 font-mono text-[12px] leading-[1.6] text-[color:var(--color-ink-dim)]">
              <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                captured on uipe.dev
              </div>
              <div>
                <span className="text-[color:var(--color-accent-violet)]">
                  h1
                </span>{" "}
                <span className="text-[color:var(--color-ink-faint)]">
                  {"> span:"}
                </span>{" "}
                <span className="text-[color:var(--color-ink)]">
                  &quot;the way humans do.&quot;
                </span>
              </div>
              <div className="mt-2 text-[color:var(--color-ink-faint)]">
                A naive extractor grabs the inner span and loses the outer
                clause. The agent thinks the headline is four words. It
                isn&rsquo;t.
              </div>
            </div>
          </div>

          {/* Right: the two code blocks */}
          <div className="space-y-10">
            {/* Before */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                  Without UIPE
                </h3>
                <span className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">
                  dom only
                </span>
              </div>
              <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/50 font-mono text-[12px] leading-[1.4] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-line)]/60 bg-black/20">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-ink-faint)]/50" />
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-ink-faint)]/50" />
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-ink-faint)]/50" />
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
                    structural.json
                  </span>
                </div>
                <div className="p-4 overflow-x-auto">
                  <Tree node={BEFORE} />
                </div>
              </div>
            </div>

            {/* After */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-accent-violet)]">
                  With UIPE
                </h3>
                <span className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">
                  dom + a11y + vision + time
                </span>
              </div>
              <div
                className="rounded-lg border border-[color:var(--color-accent-violet)]/40 bg-[color:var(--color-bg-raised)]/50 font-mono text-[12px] leading-[1.4] overflow-hidden"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(139,92,246,0.12), 0 24px 60px -24px rgba(139,92,246,0.3)",
                }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-accent-violet)]/20 bg-black/20">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-violet)]" />
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-blue)]" />
                    <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-amber)]" />
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
                    scene_graph.json
                  </span>
                </div>
                <div className="p-4 overflow-x-auto">
                  <Tree node={AFTER} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer of the section — a quiet note */}
        <div className="pt-12 pb-24 sm:pb-32">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            these trees are the actual output shape. not a mockup.
          </p>
        </div>
      </div>
    </section>
  );
}
