import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = { email?: string; section?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// TODO: swap for Vercel KV (or Upstash) in production. In-memory Set for local dev
// is fine for now — the API surface is stable.
const dev_waitlist = new Set<string>();

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Please provide a valid email." },
      { status: 400 },
    );
  }
  if (email.length > 254) {
    return NextResponse.json(
      { ok: false, error: "Email is too long." },
      { status: 400 },
    );
  }

  const section = typeof body.section === "string" ? body.section : "unknown";

  if (process.env.KV_REST_API_URL) {
    // Production path — Vercel KV. Kept behind env so local dev works without credentials.
    const { kv } = await import("@vercel/kv");
    const exists = await kv.sismember("waitlist:emails", email);
    if (exists) {
      return NextResponse.json({ ok: true, alreadyJoined: true });
    }
    await kv.sadd("waitlist:emails", email);
    await kv.hset(`waitlist:meta:${email}`, {
      email,
      section,
      signedUpAt: new Date().toISOString(),
      ua: req.headers.get("user-agent") ?? "unknown",
      referrer: req.headers.get("referer") ?? "direct",
    });
  } else {
    dev_waitlist.add(email);
    console.log(
      `[waitlist] ${email} joined from ${section} (dev in-memory, ${dev_waitlist.size} total)`,
    );
  }

  return NextResponse.json({ ok: true });
}
