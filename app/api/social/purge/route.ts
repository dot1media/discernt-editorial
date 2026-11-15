import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSchema, audit } from "@/lib/schema";
import { requireCapability } from "@/lib/session";
import { deleteFromFacebook, metaConfigured } from "@/lib/social/meta";

export const runtime = "nodejs";

// Start-fresh sweep: delete every Facebook post Discernt published (by stored
// id) from the Page. Instagram is NOT deletable through Meta's API, so those
// are left in place and reported so they can be removed by hand in the app.
export async function POST() {
  const gate = await requireCapability("publish.toNews");
  if ("response" in gate) return gate.response;
  const { account } = gate;
  await ensureSchema();

  if (!metaConfigured()) {
    return NextResponse.json({ error: "Meta is not configured on this deployment." }, { status: 400 });
  }

  const rows = (await sql`
    SELECT id, fb_post_id FROM social_posts
    WHERE fb_post_id IS NOT NULL AND fb_post_id <> ''
  `) as any[];

  let deleted = 0;
  const failures: { id: string; error: string }[] = [];
  for (const r of rows) {
    try {
      await deleteFromFacebook(String(r.fb_post_id));
      await sql`UPDATE social_posts SET fb_post_id = NULL, updated_at = now() WHERE id = ${r.id}`;
      deleted++;
    } catch (e: any) {
      failures.push({ id: String(r.id), error: e?.message || "failed" });
    }
  }

  const igCount =
    ((await sql`SELECT COUNT(*)::int AS c FROM social_posts WHERE ig_post_id IS NOT NULL AND ig_post_id <> ''`) as any[])[0]?.c || 0;

  await audit(account.email, "social.purgeFacebook", "social", "all", { deleted, failed: failures.length });

  return NextResponse.json({
    ok: true,
    deleted,
    failed: failures.length,
    failures,
    instagramRemaining: igCount,
    instagramNote: "Instagram posts can't be deleted through Meta's API. Remove the Instagram posts by hand in the Instagram app.",
  });
}
