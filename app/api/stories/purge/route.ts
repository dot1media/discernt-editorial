import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSchema, audit } from "@/lib/schema";
import { requireCapability } from "@/lib/session";
import { purgeAllArticles } from "@/lib/newsArchive";

export const runtime = "nodejs";

// Start fresh: delete EVERY editorial story and EVERY published article. The app
// and the news site read news_stories, so this empties the newsroom and takes
// all articles down from the app and website. Photos and videos are managed
// separately. Irreversible — gated to story.delete (owners/editors).
export async function POST() {
  const gate = await requireCapability("story.delete");
  if ("response" in gate) return gate.response;
  const { account } = gate;
  await ensureSchema();

  const edRows = (await sql`SELECT COUNT(*)::int AS c FROM stories`) as any[];
  const editorial = edRows[0]?.c || 0;
  await sql`DELETE FROM stories`;

  let published = 0;
  let publishedError = "";
  try {
    published = await purgeAllArticles();
  } catch (e: any) {
    publishedError = e?.message || "news purge failed";
  }

  await audit(account.email, "stories.purgeAll", "story", "all", { editorial, published, publishedError });
  return NextResponse.json({ ok: true, editorial, published, publishedError });
}
