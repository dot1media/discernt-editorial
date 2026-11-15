import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSchema, audit } from "@/lib/schema";
import { requireCapability } from "@/lib/session";
import { readJson } from "@/lib/api";
import { CATEGORIES } from "@/lib/newsroom";
import { deleteFromFacebook, metaConfigured } from "@/lib/social/meta";

export const runtime = "nodejs";

const STATUSES = new Set(["draft", "approved", "scheduled", "posted", "failed"]);
const TARGETS = new Set(["instagram", "facebook", "x"]);
const CATEGORY_SET = new Set<string>(CATEGORIES as readonly string[]);

// Edit a queued post: captions, targets, status (approve), schedule time.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("publish.toNews");
  if ("response" in gate) return gate.response;
  const { account } = gate;
  await ensureSchema();
  const { id } = await params;
  const b = await readJson(req);

  const rows = (await sql`SELECT id, status FROM social_posts WHERE id = ${id} LIMIT 1`) as any[];
  if (!rows.length) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (typeof b.caption_instagram === "string") {
    await sql`UPDATE social_posts SET caption_instagram=${b.caption_instagram}, updated_at=now() WHERE id=${id}`;
  }
  if (typeof b.caption_facebook === "string") {
    await sql`UPDATE social_posts SET caption_facebook=${b.caption_facebook}, updated_at=now() WHERE id=${id}`;
  }
  if (typeof b.caption_x === "string") {
    await sql`UPDATE social_posts SET caption_x=${b.caption_x}, updated_at=now() WHERE id=${id}`;
  }
  if (Array.isArray(b.targets)) {
    const t = b.targets.filter((x: string) => TARGETS.has(x));
    await sql`UPDATE social_posts SET targets=${JSON.stringify(t)}, updated_at=now() WHERE id=${id}`;
  }
  if (typeof b.style === "string" && ["a", "b", "c"].includes(b.style)) {
    await sql`UPDATE social_posts SET style=${b.style}, updated_at=now() WHERE id=${id}`;
  }
  if (typeof b.category === "string" && CATEGORY_SET.has(b.category)) {
    await sql`UPDATE social_posts SET category=${b.category}, updated_at=now() WHERE id=${id}`;
  }
  if (typeof b.status === "string" && STATUSES.has(b.status)) {
    await sql`UPDATE social_posts SET status=${b.status}, error='', updated_at=now() WHERE id=${id}`;
    await audit(account.email, "social.status", "social", id, { status: b.status });
  }
  if ("scheduled_at" in b) {
    const at = b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null;
    await sql`UPDATE social_posts SET scheduled_at=${at}, updated_at=now() WHERE id=${id}`;
  }

  const updated = (await sql`SELECT * FROM social_posts WHERE id = ${id} LIMIT 1`) as any[];
  return NextResponse.json({ post: updated[0] });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("publish.toNews");
  if ("response" in gate) return gate.response;
  const { account } = gate;
  await ensureSchema();
  const { id } = await params;

  // If this post went live, take the Facebook post down too. Instagram has no
  // delete endpoint in Meta's API, so an IG post can only be removed by hand.
  const rows = (await sql`SELECT fb_post_id, ig_post_id FROM social_posts WHERE id = ${id} LIMIT 1`) as any[];
  const rec = rows[0] || {};
  let fbDeleted = false;
  let fbError = "";
  if (rec.fb_post_id && metaConfigured()) {
    try { await deleteFromFacebook(String(rec.fb_post_id)); fbDeleted = true; }
    catch (e: any) { fbError = e?.message || "Facebook delete failed"; }
  }
  const igNote = rec.ig_post_id ? "Instagram posts can't be deleted through Meta's API — remove it in the Instagram app." : "";

  await sql`DELETE FROM social_posts WHERE id = ${id}`;
  await audit(account.email, "social.delete", "social", id, { fbDeleted, fbError, hadIg: !!rec.ig_post_id });
  return NextResponse.json({ ok: true, fbDeleted, fbError, igNote });
}
