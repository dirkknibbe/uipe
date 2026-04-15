"use client";

import { useState } from "react";
import { WaitlistForm } from "./WaitlistForm";

const MCP_CONFIG = `{
  "mcpServers": {
    "uipe": {
      "url": "https://mcpaasta.uipe.dev/mcp",
      "transport": "sse"
    }
  }
}`;

const EDITORS = ["Claude Code", "Cursor", "Zed", "Windsurf"];

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      // Silently no-op; clipboard may be denied in some contexts.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--color-line)] text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-ink-dim)] transition-colors"
    >
      {state === "copied" ? "copied ✓" : "copy"}
    </button>
  );
}

export function DevSnippet() {
  return (
    <section
      id="dev-snippet"
      className="relative border-b border-[color:var(--color-line)]/40 bg-[color:var(--color-bg)]"
    >
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 pt-24 sm:pt-32 pb-24 sm:pb-32">
        {/* Eyebrow rail */}
        <div className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-line)]/50 pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            §05 · integrate
          </span>
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            one config block · any mcp-native agent
          </span>
        </div>

        {/* Grid: intro left, code block right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_1.1fr] gap-12 lg:gap-20 pt-12 sm:pt-16">
          {/* Left — intro + editors + CTA */}
          <div className="space-y-8">
            <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] text-balance">
              Drop it into your agent.
              <br />
              <span className="text-[color:var(--color-ink-dim)]">
                One config block, no SDK.
              </span>
            </h2>

            <p className="text-[15px] sm:text-base text-[color:var(--color-ink-dim)] leading-[1.65] max-w-[48ch]">
              UIPE ships as a remote MCP server. If your agent speaks the
              Model Context Protocol, it speaks UIPE.
            </p>

            <div className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                built for agent-native editors
              </div>
              <ul className="flex flex-wrap gap-2">
                {EDITORS.map((e) => (
                  <li
                    key={e}
                    className="font-mono text-[12px] px-3 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-ink-dim)] bg-[color:var(--color-bg-raised)]/40"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA repeat */}
            <div className="pt-6 border-t border-[color:var(--color-line)]/40">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)] mb-3">
                early access
              </div>
              <WaitlistForm section="dev-snippet" />
            </div>
          </div>

          {/* Right — code block with terminal chrome */}
          <div>
            <div
              className="rounded-xl overflow-hidden border border-[color:var(--color-accent-violet)]/30 bg-[color:var(--color-bg-raised)]/60"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(139,92,246,0.12), 0 40px 100px -40px rgba(139,92,246,0.35)",
              }}
            >
              {/* Chrome header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-accent-violet)]/20 bg-black/20">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-violet)]" />
                  <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-blue)]/70" />
                  <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-amber)]/70" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
                  .mcp.json · claude · cursor · zed
                </span>
                <CopyButton text={MCP_CONFIG} />
              </div>

              {/* Body — hand-highlighted JSON */}
              <pre
                aria-label="MCP config snippet"
                className="p-6 sm:p-8 overflow-x-auto font-mono text-[13px] sm:text-sm leading-[1.7]"
              >
                <code>
                  <span className="text-[color:var(--color-ink-faint)]">{"{"}</span>
                  {"\n  "}
                  <span className="text-[color:var(--color-accent-violet)]">&quot;mcpServers&quot;</span>
                  <span className="text-[color:var(--color-ink-faint)]">:</span> <span className="text-[color:var(--color-ink-faint)]">{"{"}</span>
                  {"\n    "}
                  <span className="text-[color:var(--color-accent-violet)]">&quot;uipe&quot;</span>
                  <span className="text-[color:var(--color-ink-faint)]">:</span> <span className="text-[color:var(--color-ink-faint)]">{"{"}</span>
                  {"\n      "}
                  <span className="text-[color:var(--color-accent-blue)]">&quot;url&quot;</span>
                  <span className="text-[color:var(--color-ink-faint)]">:</span> <span className="text-[color:var(--color-ink)]">&quot;https://mcpaasta.uipe.dev/mcp&quot;</span>
                  <span className="text-[color:var(--color-ink-faint)]">,</span>
                  {"\n      "}
                  <span className="text-[color:var(--color-accent-blue)]">&quot;transport&quot;</span>
                  <span className="text-[color:var(--color-ink-faint)]">:</span> <span className="text-[color:var(--color-accent-amber)]">&quot;sse&quot;</span>
                  {"\n    "}
                  <span className="text-[color:var(--color-ink-faint)]">{"}"}</span>
                  {"\n  "}
                  <span className="text-[color:var(--color-ink-faint)]">{"}"}</span>
                  {"\n"}
                  <span className="text-[color:var(--color-ink-faint)]">{"}"}</span>
                </code>
              </pre>
            </div>

            {/* Caption under block */}
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
              coming soon · join the waitlist for early access
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
