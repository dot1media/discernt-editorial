import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSchema, audit } from "@/lib/schema";
import { can, type AccountPermissions } from "@/lib/permissions";
import { computeOutletReliability, buildReliabilityDigest } from "@/lib/ai/reliability";
import { sendEmail } from "@/lib/mail";

export const runtime = "nodejs";
export const maxDuration = 120;

// Weekly outlet-reliability digest for the newsroom. Vercel Cron calls this on a
// schedule (see vercel.json). Self-guarding: it does nothing (returns skipped)
// when there is no rated evidence yet, no recipients, or no email provider
// configured, so it is safe to deploy before email is set up.
//
// Auth: Vercel Cron sends Authorization: Bearer $CRON_SECRET; ?secret= and
// x-cron-secret are also accepted for manual runs.
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return NextResponse.json({ error: "Cron is not configured (set CRON_SECRET)." }, { status: 503 });
  const url = new URL(request.url);
  const provided =
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-cron-secret") ||
    url.searchParams.get("secret") ||
    "";
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  await ensureSchema();

  const minStories = Math.max(1, Number(process.env.RELIABILITY_MIN_STORIES) || 5);
  const report = await computeOutletReliability({ minStories });
  const digest = buildReliabilityDigest(report);
  if (!digest) return NextResponse.json({ skipped: true, reason: "No human-rated outlets yet." });

  // Recipients: an explicit env list wins; otherwise everyone who can approve
  // review (editors and owners); finally the newsroom address as a backstop.
  let recipients: string[] = [];
  const envTo = (process.env.RELIABILITY_DIGEST_TO || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (envTo.length) {
    recipients = envTo;
  } else {
    try {
      const rows = (await sql`SELECT email, role, overrides FROM admin_accounts WHERE NOT disabled`) as
        { email: string; role: string; overrides: any }[];
      recipients = rows
        .filter((r) => can({ role: r.role, overrides: r.overrides || {} } as AccountPermissions, "review.approve"))
        .map((r) => r.email)
        .filter(Boolean);
    } catch { /* fall through to backstop */ }
    if (recipients.length === 0) recipients = ["contact@dot1.media"];
  }

  const sent = await sendEmail({ to: recipients, subject: digest.subject, html: digest.html, text: digest.text });
  if (!sent.ok) return NextResponse.json({ skipped: true, reason: sent.error || "email not sent", recipients: recipients.length });

  const suggestions = report.outlets.filter((o) => o.suggestion).length;
  await audit("ai-desk", "reliability.digest", "email", "weekly", { provider: sent.provider, recipients: recipients.length, suggestions });
  return NextResponse.json({ ok: true, provider: sent.provider, recipients: recipients.length, outlets: report.outlets.filter((o) => o.ratedStories > 0).length, suggestions });
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
