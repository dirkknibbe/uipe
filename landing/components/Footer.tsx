export function Footer() {
  return (
    <footer
      className="relative bg-[color:var(--color-bg)]"
      aria-label="Site footer"
    >
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 py-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-8">
          {/* Wordmark + tagline */}
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[15px] font-semibold tracking-tight text-[color:var(--color-ink)]">
              uipe
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
              perception engine
            </span>
          </div>

          {/* Links — editorial mono */}
          <nav
            aria-label="Footer links"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]"
          >
            <a
              href="https://github.com/dirkknibbe/ui-perception-engine"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[color:var(--color-ink-dim)] transition-colors"
            >
              github
            </a>
            <a
              href="#dev-snippet"
              className="hover:text-[color:var(--color-ink-dim)] transition-colors"
            >
              docs
            </a>
            <a
              href="mailto:hello@uipe.dev"
              className="hover:text-[color:var(--color-ink-dim)] transition-colors"
            >
              contact
            </a>
            <span
              aria-hidden
              className="hidden sm:inline text-[color:var(--color-line)]"
            >
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent-amber)]" />
              <span>pre-launch · building in public</span>
            </span>
          </nav>
        </div>

        {/* Bottom rail — tiny print */}
        <div className="mt-10 pt-6 border-t border-[color:var(--color-line)]/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
          <div>© 2026 uipe · acceptable use · privacy</div>
          <div>
            paid tiers settled via x402 · usdc on base
            <span aria-hidden className="mx-2 text-[color:var(--color-line)]">
              ·
            </span>
            <span>v0.1.0-alpha</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
