/**
 * Relevant, license-clear imagery for stories that arrive without the outlet's
 * own photo. Openverse aggregates CC-licensed and public-domain images and
 * returns machine-readable attribution, so every picture we use can be credited.
 * Best-effort and bounded: any failure returns null and the caller keeps its
 * branded category fallback.
 */
export interface SourcedImage {
  url: string;
  credit: string;
}

// Very common words carry no visual meaning, so they never count toward a match.
const IMAGE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'after',
  'news', 'story', 'report', 'update', 'latest', 'photo', 'image', 'picture',
  'says', 'said', 'amid', 'new', 'how', 'why', 'what', 'who', 'plans', 'plan',
]);

/** Content tokens of a phrase: lowercased words of 3+ letters that aren't
 *  stopwords (3 so meaningful short words like oil, gun, war, aid, law count). */
function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) || []).filter((t) => !IMAGE_STOPWORDS.has(t));
}

// Openverse metadata that marks a result as NOT a news-usable photograph of the
// subject: logos, icons, diagrams, clip art, and the like. A map is allowed (it
// can legitimately illustrate a place).
const NON_PHOTO = /\b(logo|icon|clipart|clip art|sprite|watermark|favicon|emoji|wordmark|infographic|diagram|vector|illustration of a|screenshot)\b/i;

function resultHay(result: any): { title: string; all: string } {
  const title = String(result?.title || '').toLowerCase();
  const parts: string[] = [title];
  if (Array.isArray(result?.tags)) for (const t of result.tags) parts.push(String(t?.name || '').toLowerCase());
  return { title, all: parts.join(' ') };
}

/** How many distinct query tokens appear in an Openverse result's own title/tags. */
function relevanceScore(queryTokens: string[], hay: string): number {
  let hits = 0;
  for (const tok of queryTokens) if (hay.includes(tok)) hits++;
  return hits;
}

export async function searchOpenverseImage(query: string, timeoutMs = 4500): Promise<SourcedImage | null> {
  const q = (query || '').trim();
  if (q.length < 3) return null;
  // A result must share the story's subject, not merely one incidental word.
  // The ANCHOR (the most distinctive query token) must appear, AND enough of the
  // whole query must match — so "Alaska pipeline" no longer matches a generic
  // Alaska landscape that happens to say "Alaska".
  const queryTokens = contentTokens(q);
  if (queryTokens.length === 0) return null;
  // Anchor = the longest content token (the proper noun / central object).
  const anchor = queryTokens.reduce((a, b) => (b.length > a.length ? b : a), queryTokens[0]);
  const minHits = queryTokens.length <= 1 ? 1 : Math.max(2, Math.ceil(queryTokens.length * 0.6));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      'https://api.openverse.org/v1/images/?' +
      new URLSearchParams({
        q: q.slice(0, 120),
        mature: 'false',
        aspect_ratio: 'wide',
        size: 'large',
        page_size: '10',
      }).toString();
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Discernt-ContentPipeline/1.0 (+https://dot1.media)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    // Keep only usable, reasonably wide photos with a direct file url, then rank
    // by how well each result's own metadata matches the story's subject. A result
    // that clears the relevance bar and the highest score wins; if nothing clears
    // it, return null so the caller keeps its on-topic branded category fallback
    // instead of showing a picture of something unrelated.
    const usable = results.filter(
      (r) => r?.url && /^https?:\/\//i.test(r.url) && (!r.width || r.width >= 1000),
    );
    const candidates = usable.length ? usable : results.filter((r) => r?.url && /^https?:\/\//i.test(r.url));
    // Rank by title match first (a strong signal the photo IS the subject), then
    // by total overlap. A result must contain the anchor, clear the hit floor,
    // and not be a logo/icon/diagram, or it is rejected so the on-topic branded
    // category fallback is kept instead of an unrelated picture.
    let pick: any = null;
    let bestTitle = -1;
    let bestAll = -1;
    for (const r of candidates) {
      const { title, all } = resultHay(r);
      if (!all.includes(anchor)) continue;                 // subject must be present
      if (NON_PHOTO.test(all)) continue;                   // not a logo/icon/diagram
      const score = relevanceScore(queryTokens, all);
      if (score < minHits) continue;
      const titleScore = relevanceScore(queryTokens, title);
      if (titleScore > bestTitle || (titleScore === bestTitle && score > bestAll)) {
        bestTitle = titleScore; bestAll = score; pick = r;
      }
    }
    if (!pick?.url) return null;
    const creator = (pick.creator || 'Unknown').toString().slice(0, 80);
    const via = (pick.source || 'Openverse').toString().slice(0, 40);
    const license = (pick.license || '').toString().toUpperCase();
    const ver = pick.license_version ? ' ' + pick.license_version : '';
    const credit = `${creator} / ${via}${license ? ` (${license}${ver})` : ''}`.slice(0, 300);
    return { url: String(pick.url), credit };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
