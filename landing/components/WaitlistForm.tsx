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

  return (
    <form
      onSubmit={submit}
      className="flex flex-col sm:flex-row gap-3 max-w-xl"
      noValidate
    >
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
        disabled={status === "loading" || status === "success"}
        className="flex-1 px-4 py-3 rounded-lg bg-black/40 backdrop-blur-sm border border-[color:var(--color-line)] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] focus:outline-none focus:border-[color:var(--color-accent-violet)] transition-colors font-mono text-sm"
      />
      <button
        type="submit"
        disabled={status === "loading" || status === "success"}
        className="px-5 py-3 rounded-lg bg-[color:var(--color-ink)] text-[color:var(--color-bg)] font-medium text-sm hover:bg-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {status === "loading"
          ? "Joining…"
          : status === "success"
            ? "Joined ✓"
            : "Join waitlist"}
      </button>
      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          className={`sm:basis-full text-sm ${
            status === "error"
              ? "text-[color:var(--color-accent-amber)]"
              : "text-[color:var(--color-ink-dim)]"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
