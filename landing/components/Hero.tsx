"use client";

import dynamic from "next/dynamic";
import { WaitlistForm } from "./WaitlistForm";

const SceneGraph = dynamic(
  () => import("./SceneGraph").then((m) => m.SceneGraph),
  { ssr: false },
);

export function Hero() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden">
      {/* Top bar — thin hairline rule, spans full width */}
      <header className="relative z-20 border-b border-[color:var(--color-line)]/40">
        <div className="flex items-center justify-between px-6 sm:px-10 h-16">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[15px] font-semibold tracking-tight text-[color:var(--color-ink)]">
              uipe
            </span>
            <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
              perception engine
            </span>
          </div>
          <nav className="hidden sm:flex items-center gap-8 text-[13px] text-[color:var(--color-ink-dim)]">
            <a className="hover:text-[color:var(--color-ink)] transition-colors" href="#problem">
              Problem
            </a>
            <a className="hover:text-[color:var(--color-ink)] transition-colors" href="#how">
              How it works
            </a>
            <a className="hover:text-[color:var(--color-ink)] transition-colors" href="#pricing">
              Pricing
            </a>
            <a
              className="hover:text-[color:var(--color-ink)] transition-colors"
              href="https://github.com/dirkknibbe/ui-perception-engine"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Main grid: copy left, scene graph right — contained, not full-bleed */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_1.2fr] min-h-[calc(100dvh-4rem)]">
        {/* Left column: headline, subhead, CTA */}
        <div className="relative z-10 flex flex-col px-6 sm:px-10 lg:px-16 pt-[18vh] pb-16">
          <div className="max-w-[56ch] space-y-10">
            <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent-amber)]" />
              building in public · early access soon
            </div>

            <h1 className="font-display tracking-[-0.025em] leading-[0.95] text-balance">
              <span className="block text-5xl sm:text-6xl md:text-7xl font-semibold text-[color:var(--color-ink)]">
                See the web
              </span>
              <span className="block text-5xl sm:text-6xl md:text-7xl font-semibold text-[color:var(--color-ink-dim)]">
                the way humans do.
              </span>
            </h1>

            <p className="text-lg text-[color:var(--color-ink-dim)] max-w-[48ch] leading-[1.55]">
              A perception layer that gives your agent human-level web
              understanding. DOM, accessibility, vision, and time — fused into a
              single scene graph. Ships as an MCP server.
            </p>

            <div className="pt-2">
              <WaitlistForm section="hero" />
            </div>
          </div>
        </div>

        {/* Right column: scene graph — contained within its column */}
        <div className="relative hidden lg:block border-l border-[color:var(--color-line)]/30">
          <div className="absolute inset-0">
            <SceneGraph />
          </div>
        </div>
      </div>

      {/* Mobile: scene graph as subtle backdrop behind hero on small screens only */}
      <div className="lg:hidden absolute inset-x-0 top-16 bottom-0 -z-0 opacity-40 pointer-events-none">
        <SceneGraph />
      </div>
    </section>
  );
}
