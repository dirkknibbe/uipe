"use client";

type Tier = {
  key: "free" | "scan" | "deep";
  label: string;
  price: string;
  unit: string;
  blurb: string;
  limits: string[];
  primary?: boolean;
};

const TIERS: Tier[] = [
  {
    key: "free",
    label: "Free",
    price: "$0",
    unit: "GitHub OAuth",
    blurb: "Hack, explore, prototype. Same engine, quota-metered.",
    limits: [
      "10 Scan sessions / day",
      "2 Deep sessions / day",
      "GitHub account, 30 days old",
      "Community support",
    ],
  },
  {
    key: "scan",
    label: "Scan",
    price: "$0.03",
    unit: "per session",
    blurb: "Structural + a11y + fast vision. The everyday workhorse.",
    limits: [
      "DOM + a11y + OmniParser",
      "Typical agent eval loop",
      "Sub-second for most pages",
      "Pay-as-you-go via x402",
    ],
    primary: true,
  },
  {
    key: "deep",
    label: "Deep",
    price: "$0.12",
    unit: "per session",
    blurb: "Scan plus frontier vision and temporal analysis.",
    limits: [
      "Everything in Scan",
      "Frontier vision pass",
      "Frame-by-frame temporal diff",
      "Pay-as-you-go via x402",
    ],
  },
];

function TierCard({ tier }: { tier: Tier }) {
  const violet = tier.primary;
  return (
    <div
      className={`relative rounded-xl overflow-hidden border bg-[color:var(--color-bg-raised)]/50 ${
        violet
          ? "border-[color:var(--color-accent-violet)]/40"
          : "border-[color:var(--color-line)]"
      }`}
      style={
        violet
          ? {
              boxShadow:
                "0 0 0 1px rgba(139,92,246,0.16), 0 30px 80px -32px rgba(139,92,246,0.35)",
            }
          : undefined
      }
    >
      {/* Chrome header — mirrors Problem / Solution blocks */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b bg-black/20 ${
          violet
            ? "border-[color:var(--color-accent-violet)]/20"
            : "border-[color:var(--color-line)]/60"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              violet
                ? "bg-[color:var(--color-accent-violet)]"
                : "bg-[color:var(--color-ink-faint)]/60"
            }`}
          />
          <span
            className={`h-2 w-2 rounded-full ${
              violet
                ? "bg-[color:var(--color-accent-blue)]/70"
                : "bg-[color:var(--color-ink-faint)]/40"
            }`}
          />
          <span
            className={`h-2 w-2 rounded-full ${
              violet
                ? "bg-[color:var(--color-accent-amber)]/70"
                : "bg-[color:var(--color-ink-faint)]/30"
            }`}
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
          tier · {tier.key}
        </span>
      </div>

      {/* Body */}
      <div className="p-6 sm:p-8 space-y-6">
        <div>
          <div
            className={`font-mono text-[11px] uppercase tracking-[0.22em] mb-3 ${
              violet
                ? "text-[color:var(--color-accent-violet)]"
                : "text-[color:var(--color-ink-faint)]"
            }`}
          >
            {tier.label}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-5xl sm:text-6xl font-semibold tracking-[-0.03em] text-[color:var(--color-ink)]">
              {tier.price}
            </span>
            <span className="font-mono text-[12px] text-[color:var(--color-ink-dim)]">
              {tier.unit}
            </span>
          </div>
        </div>

        <p className="text-[15px] text-[color:var(--color-ink-dim)] leading-[1.6] max-w-[32ch]">
          {tier.blurb}
        </p>

        <ul className="space-y-2.5 font-mono text-[12px] leading-[1.5]">
          {tier.limits.map((l, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[color:var(--color-ink-dim)]"
            >
              <span
                className={
                  violet
                    ? "text-[color:var(--color-accent-violet)]"
                    : "text-[color:var(--color-ink-faint)]"
                }
                aria-hidden
              >
                ·
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Pricing() {
  return (
    <section
      id="pricing"
      className="relative border-b border-[color:var(--color-line)]/40 bg-[color:var(--color-bg)]"
    >
      <div className="mx-auto max-w-[88rem] px-6 sm:px-10 lg:px-16 pt-24 sm:pt-32">
        {/* Eyebrow rail */}
        <div className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-line)]/50 pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            §04 · pricing
          </span>
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            pay per session · no subscription
          </span>
        </div>

        {/* Intro */}
        <div className="max-w-[52ch] pt-12 sm:pt-16 pb-12 sm:pb-16">
          <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] text-balance">
            Pay what a coffee costs.
            <br />
            <span className="text-[color:var(--color-ink-dim)]">
              Get a month of agent evaluations.
            </span>
          </h2>
          <p className="mt-6 text-[15px] sm:text-base text-[color:var(--color-ink-dim)] leading-[1.65] max-w-[48ch]">
            Transparent per-session pricing. No seats, no minimums, no retainer.
            Spin up an agent, use what you need, stop when you're done.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {TIERS.map((tier) => (
            <TierCard key={tier.key} tier={tier} />
          ))}
        </div>

        {/* Footnote */}
        <div className="pt-10 pb-24 sm:pb-32 space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            paid tiers settled via x402 · usdc on base
          </p>
          <p className="font-mono text-[11px] text-[color:var(--color-ink-faint)]">
            Free tier requires a GitHub account that&rsquo;s at least 30 days
            old. Soft limits; we&rsquo;ll contact you before anything hard
            stops.
          </p>
        </div>
      </div>
    </section>
  );
}
