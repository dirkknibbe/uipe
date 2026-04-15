"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export function WaitlistForm({ section = "unknown" }: { section?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "loading") return;
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, section }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setStatus("success");
        setMessage("You're on the list. We'll reach out when early access opens.");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong. Try again?");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Try again?");
    }
  }

  const disabled = status === "loading" || status === "success";

  return (
    <form onSubmit={submit} className="max-w-xl" noValidate>
      <div className="flex flex-col sm:flex-row gap-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-raised)]/60 backdrop-blur-sm p-1.5 focus-within:border-[color:var(--color-accent-violet)]/60 transition-colors">
        <label htmlFor={`email-${section}`} className="sr-only">
          Email address
        </label>
        <input
          id={`email-${section}`}
          type="email"
          required
          placeholder="you@company.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          className="flex-1 px-3 py-3 bg-transparent text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:outline-none font-mono text-sm"
        />
        <button
          type="submit"
          disabled={disabled}
          style={{
            boxShadow:
              "0 0 0 1px rgba(139,92,246,0.35), 0 6px 24px -6px rgba(139,92,246,0.45)",
          }}
          className="px-6 py-3 rounded-md bg-[color:var(--color-ink)] text-[color:var(--color-bg)] font-semibold text-[13px] tracking-[0.02em] uppercase hover:bg-white active:translate-y-[1px] transition-[background-color,transform] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {status === "loading"
            ? "Joining…"
            : status === "success"
              ? "Joined ✓"
              : "Join the waitlist"}
        </button>
      </div>
      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${
            status === "error"
              ? "text-[color:var(--color-accent-amber)]"
              : "text-[color:var(--color-ink-dim)]"
          }`}
        >
          {message}
        </p>
      )}
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
        no spam · unsubscribe any time
      </p>
    </form>
  );
}
