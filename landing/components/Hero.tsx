"use client";

import dynamic from "next/dynamic";
import { WaitlistForm } from "./WaitlistForm";

const SceneGraph = dynamic(
  () => import("./AsciiSpike").then((m) => m.AsciiSpike),
  { ssr: false },
);

export function Hero() {
  return (
    <section className="relative min-h-[100dvh] border-b border-[color:var(--color-line)]/40">
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

      {/* Editorial version stamp — top-right of hero, below nav */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-20 right-6 sm:right-10 z-20 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]"
      >
        v0.1.0-alpha
        <span className="mx-1.5 text-[color:var(--color-line)]">·</span>
        2026.04.15
      </div>

      {/* Scene graph — extends beyond the hero boundaries and fades at the
          edges via mask-image, so spheres flow past the nav/rule instead of
          being sharply clipped. */}
      <div
        className="absolute inset-x-0 -top-8 -bottom-48 z-0 pointer-events-none lg:pointer-events-auto"
        style={{
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
        }}
      >
        <SceneGraph />
      </div>

      {/* Subtle left-only gradient so copy stays legible — 3D bleeds to all other edges */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-16 bottom-0 z-[1] pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, rgba(11,11,15,0.88) 0%, rgba(11,11,15,0.5) 28%, rgba(11,11,15,0) 45%)",
        }}
      />

      {/* Copy — floats over the 3D on the left half */}
      <div className="relative z-10 min-h-[calc(100dvh-4rem)] flex flex-col px-6 sm:px-10 lg:px-16 pt-[18vh] pb-16 lg:max-w-[50%]">
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
    </section>
  );
}
