import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/schema";
import { requireCapability } from "@/lib/session";
import { computeOutletReliability } from "@/lib/ai/reliability";

export const runtime = "nodejs";

// GET: per-outlet reliability for the AI desk — human-rated verification, claim
// outcomes, and (where the evidence is strong enough) a suggested track-record
// adjustment for an editor to approve. Read-only: it never changes a baseline.
// Optional ?minStories=N sets the sample floor a suggestion needs (default 5).
export async function GET(req: Request) {
  const gate = await requireCapability("story.create");
  if ("response" in gate) return gate.response;
  await ensureSchema();
  const n = Number(new URL(req.url).searchParams.get("minStories"));
  const report = await computeOutletReliability(Number.isFinite(n) && n > 0 ? { minStories: n } : {});
  return NextResponse.json(report);
}
