/**
 * Active corroboration for the AI desk.
 *
 * The passive wire desk only groups outlets that happen to publish the same
 * event into the same fetch window, with overlapping headlines. In practice
 * most events arrive in just one of our feeds, so a story would be written
 * from a single outlet. That is the gap this closes.
 *
 * Given the lead outlet's report, we ask Google News (keyless RSS search) which
 * OTHER outlets are covering the same event, keep only the ones whose headline
 * genuinely overlaps the event, then for each one:
 *   - resolve the Google News redirect to the publisher's own canonical URL, so
 *     the citation points at the outlet, not the aggregator, and
 *   - fetch a real excerpt (og:description / meta description) from that page,
 *     so the writer has genuine cross-outlet TEXT to synthesize, not just a
 *     headline.
 * The writer then writes one account across outlets and attributes where they
 * converge and diverge; the independent scorer raises Source Credibility
 * (verification) only because several outlets now carry the same facts.
 *
 * This never publishes anything: corroborating outlets land in the draft's
 * dossier as PENDING sources, their claims stay "unconfirmed", and confidence
 * stays developing/moderate until a human completes the dual-rater review. It
 * is a research aid for the editor, not a verification shortcut. Any failure
 * (network, parse, no results) degrades gracefully — a story is still written
 * from whatever outlets we already have.
 */

import type { FeedSource, SciBaseline, NewsCategory } from './sources';
import type { SourceMember } from './generate';

const UA = 'Discernt-ContentPipeline/1.0 (+https://dot1.media)';

// Shared, deliberately small stopword set for headline tokenization (kept local
// so this module has no dependency on the clustering internals in run.ts).
const STOP = new Set(
  ('a an the and or but of to in on for with at by from as is are was were be been being this that these those it its he she they them his her their you your we our us not no new news say says said after over amid into out up down off about more most will would can could may might has have had just report reports live latest update updates breaking opinion analysis watch video photos').split(' '),
);

function tokens(title: string): Set<string> {
  return new Set(
    (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

// Distinctive entities — proper nouns and multi-digit numbers — which identify
// an event ACROSS languages (place names, people, organizations, dates and
// counts survive translation; ordinary words do not). This is what lets a
// Spanish or Portuguese report be matched to an English lead.
function strongTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of (title || '').matchAll(/\b\d{2,}\b/g)) out.add(m[0]);
  for (const w of (title || '').split(/\s+/)) {
    const bare = w.replace(/[^\p{L}\p{N}]/gu, '');
    if (bare.length >= 3 && /^\p{Lu}/u.test(bare)) out.add(bare.toLowerCase());
  }
  return out;
}

// Discernt launches in English, Spanish, Portuguese and French, and its mission
// is global (the gospel among every people, the persecuted church). For the
// world beat we also ask Google News in those languages so international faith
// events are corroborated from regional outlets, not just English ones.
interface Locale { lang: string; label: string; hl: string; gl: string; ceid: string }
const EN_LOCALE: Locale = { lang: 'en', label: 'English', hl: 'en-US', gl: 'US', ceid: 'US:en' };
const INTL_LOCALES: Locale[] = [
  { lang: 'es', label: 'Spanish', hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  { lang: 'pt', label: 'Portuguese', hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
  { lang: 'fr', label: 'French', hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
];

/** Build a news-search query from the lead headline: its most distinctive words,
 *  proper-noun-looking terms first, capped so the query stays specific. */
function queryFromTitle(title: string): string {
  const raw = (title || '').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ');
  const scored: { w: string; s: number }[] = [];
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z0-9]/g, '');
    if (bare.length < 3) continue;
    if (STOP.has(bare.toLowerCase())) continue;
    let s = bare.length;
    if (/^[A-Z]/.test(bare)) s += 6;          // proper nouns carry the event
    if (/^[A-Z]{2,}$/.test(bare)) s += 4;     // acronyms (NATO, PCUSA)
    scored.push({ w: bare, s });
  }
  // Keep original order but prefer the highest-signal terms; cap at 8 words.
  const keep = new Set(scored.sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.w.toLowerCase()));
  const ordered = words.map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter((w) => keep.has(w.toLowerCase()));
  return ordered.join(' ').slice(0, 160);
}

/** Split a Google News headline ("Real headline - The Publisher") into the two
 *  parts. Google appends " - <source>" to every title. */
function splitOutlet(title: string): { headline: string; outlet: string } {
  const i = title.lastIndexOf(' - ');
  if (i > 0 && i > title.length - 60) {
    return { headline: title.slice(0, i).trim(), outlet: title.slice(i + 3).trim() };
  }
  return { headline: title.trim(), outlet: '' };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'outlet';
}

// Cautious default for an outlet we have not vetted in the registry. A handful
// of well-known wires/outlets get a documented higher baseline; everything else
// is treated as middle-of-the-road until an editor says otherwise. These three
// indicators only describe the corroborating outlet in the dossier — the score's
// outlet-level SCI still comes from the lead (registry) source.
const KNOWN: Record<string, SciBaseline> = {
  'associated press': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'ap news': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  reuters: { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'bbc': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'bbc news': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  npr: { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'the new york times': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'the washington post': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'the wall street journal': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'the guardian': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'christianity today': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'religion news service': { transparency: 2, trackRecord: 2, editorialStandards: 2 },
  'catholic news agency': { transparency: 2, trackRecord: 2, editorialStandards: 1 },
};
function baselineFor(outlet: string): SciBaseline {
  return KNOWN[outlet.toLowerCase()] || { transparency: 1, trackRecord: 1, editorialStandards: 1 };
}

/* ----------------------------- fetch helpers ----------------------------- */

const GOOGLE_HOST = /(?:^|\.)google\.com$|(?:^|\.)gstatic\.com$|(?:^|\.)googleusercontent\.com$/i;
function hostOf(u: string): string { try { return new URL(u).hostname; } catch { return ''; } }
function isGoogle(u: string): boolean { return GOOGLE_HOST.test(hostOf(u)); }

function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(
    String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

/** A Google News RSS item, with the publisher domain and name from <source>. */
interface GNItem {
  title: string;
  link: string;
  description: string;
  publishedAt: Date | null;
  sourceName: string;
  sourceUrl: string;
  lang: string;
}

/** Parse Google News RSS, keeping the per-item <source url="…">Name</source>
 *  so we can see each item's actual publisher domain without resolving it. */
function parseGoogleNews(xml: string, lang: string): GNItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out: GNItem[] = [];
  for (const b of blocks) {
    const title = stripTags((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let link = ((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    if (!/^https?:/i.test(link)) link = ((b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '').trim();
    if (!title || !/^https?:/i.test(link)) continue;
    const description = stripTags((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 1200);
    const rawDate = (b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1];
    let publishedAt: Date | null = null;
    if (rawDate) { const d = new Date(rawDate); if (!isNaN(d.getTime())) publishedAt = d; }
    const sm = b.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    out.push({
      title: decodeEntities(title),
      link: decodeEntities(link),
      description,
      publishedAt,
      sourceName: sm ? stripTags(sm[2]) : '',
      sourceUrl: sm ? decodeEntities(sm[1]) : '',
      lang,
    });
  }
  return out;
}

/** Classify an item as a firsthand/primary source by its publisher domain and
 *  name, returning the dossier source_type to use, or null for ordinary
 *  secondary reporting. Deliberately conservative: only clear primary classes
 *  (government, courts, press-release wires, academic) qualify. */
function primaryKind(it: GNItem): string | null {
  const host = hostOf(it.sourceUrl || it.link).toLowerCase();
  const name = (it.sourceName || '').toLowerCase();
  if (/(?:^|\.)gov(?:$|\.)/.test(host) || /(?:^|\.)mil(?:$|\.)/.test(host)) {
    return /court|judiciary|judicial/.test(host + ' ' + name) ? 'public_record' : 'government_document';
  }
  if (/\b(white house|department of|u\.s\.|united nations|parliament|ministry of|governor|attorney general|supreme court|european commission)\b/.test(name)) {
    return /court|supreme court/.test(name) ? 'public_record' : 'government_document';
  }
  if (/prnewswire|globenewswire|businesswire|business-wire|einpresswire|presswire|accesswire|newswire/.test(host) ||
      /\bnewswire\b|\bpress release\b|\bpresswire\b/.test(name)) {
    return 'press_release';
  }
  if (/(?:^|\.)edu(?:$|\.)/.test(host)) return 'primary';
  return null;
}

async function fetchXml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ finalUrl: string; html: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 250000); // head is enough for meta tags
    return { finalUrl: res.url || url, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function metaContent(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}
function extractDescription(html: string): string {
  const d = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  return decodeEntities(d).replace(/\s+/g, ' ').trim().slice(0, 600);
}
function extractCanonical(html: string): string {
  const c = metaContent(html, [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
  ]);
  return /^https?:\/\//i.test(c) && !isGoogle(c) ? decodeEntities(c) : '';
}
/** Pull the publisher destination out of a Google News interstitial page. */
function targetFromGoogle(html: string): string {
  const re = /(?:href|data-n-au)=["'](https?:\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (!isGoogle(u) && !/(?:schema|w3|gmpg|ogp)\.org|gvt\d\.com/.test(u)) return decodeEntities(u);
  }
  return '';
}

/** Resolve a Google News (or direct) link to the publisher's canonical URL and
 *  a real excerpt. Best-effort: returns the original link and an empty excerpt
 *  on any failure. */
async function resolveArticle(link: string, timeoutMs: number): Promise<{ url: string; excerpt: string }> {
  if (!isGoogle(link)) {
    const r = await fetchHtml(link, timeoutMs);
    if (!r) return { url: link, excerpt: '' };
    return { url: extractCanonical(r.html) || (isGoogle(r.finalUrl) ? link : r.finalUrl), excerpt: extractDescription(r.html) };
  }
  const r = await fetchHtml(link, timeoutMs);
  if (!r) return { url: link, excerpt: '' };
  if (!isGoogle(r.finalUrl)) {
    // The redirect already landed us on the publisher's page.
    return { url: extractCanonical(r.html) || r.finalUrl, excerpt: extractDescription(r.html) };
  }
  // Still on Google: dig the destination out of the interstitial, then fetch it.
  const tgt = targetFromGoogle(r.html);
  if (tgt) {
    const r2 = await fetchHtml(tgt, timeoutMs);
    if (r2) return { url: extractCanonical(r2.html) || (isGoogle(r2.finalUrl) ? tgt : r2.finalUrl), excerpt: extractDescription(r2.html) };
    return { url: tgt, excerpt: '' };
  }
  return { url: link, excerpt: '' };
}

/* -------------------------------- public --------------------------------- */

export interface CorroborateOpts {
  /** How many ADDITIONAL distinct outlets to try to add. */
  want: number;
  /** Budget for each discovery RSS fetch (per locale). */
  timeoutMs?: number;
  /** Budget for each per-article resolve+excerpt fetch. */
  perArticleMs?: number;
  /** Also search the app's launch languages for regional coverage. Defaults to
   *  true for the world beat, false otherwise. */
  international?: boolean;
}

const LANG_LABEL: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French' };

/**
 * Find additional outlets covering the lead member's event. Returns up to
 * `want` SourceMembers, each a distinct outlet not already present, whose
 * headline overlaps the event — with the publisher's canonical URL and a real
 * excerpt attached where they could be resolved. Best-effort and side-effect
 * free.
 */
export async function corroborate(
  lead: SourceMember,
  existingOutlets: Set<string>,
  opts: CorroborateOpts,
): Promise<SourceMember[]> {
  const want = Math.max(0, opts.want);
  if (want === 0) return [];
  const q = queryFromTitle(lead.item.title);
  if (q.length < 6) return [];

  // English always; for the world beat (international faith events) also ask in
  // the app's launch languages so regional outlets corroborate the story.
  const international = opts.international ?? (lead.source.category === 'world');
  const locales = international ? [EN_LOCALE, ...INTL_LOCALES] : [EN_LOCALE];
  const searched = await Promise.allSettled(
    locales.map(async (loc) => {
      const url = 'https://news.google.com/rss/search?' +
        new URLSearchParams({ q, hl: loc.hl, gl: loc.gl, ceid: loc.ceid }).toString();
      const xml = await fetchXml(url, opts.timeoutMs ?? 9000);
      return xml ? parseGoogleNews(xml, loc.lang) : [];
    }),
  );
  const items: GNItem[] = searched.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  if (items.length === 0) return [];

  const leadTokens = tokens(lead.item.title);
  const leadStrong = strongTokens(lead.item.title);
  const leadWhen = lead.item.publishedAt?.getTime() ?? null;
  const taken = new Set<string>([...existingOutlets].map((n) => n.toLowerCase()));

  // Same event: English coverage is matched on word overlap; non-English
  // coverage on shared distinctive entities (proper nouns / numbers), the part
  // of a headline that survives translation.
  const onEvent = (it: GNItem, headline: string): boolean => {
    if (it.lang === 'en') {
      const ct = tokens(headline);
      let inter = 0;
      for (const t of ct) if (leadTokens.has(t)) inter++;
      const union = ct.size + leadTokens.size - inter;
      return inter >= 2 || (union ? inter / union : 0) >= 0.3;
    }
    const cs = strongTokens(headline);
    let s = 0;
    for (const t of cs) if (leadStrong.has(t)) s++;
    return s >= 1;
  };
  const recent = (it: GNItem): boolean =>
    !(leadWhen && it.publishedAt && Math.abs(it.publishedAt.getTime() - leadWhen) > 6 * 24 * 3600 * 1000);

  // One pass, no network: pick up to `want` distinct secondary outlets, and up
  // to one firsthand/primary source (government, court, wire, academic) — the
  // single thing that most separates reporting from rewrite.
  interface Pick { headline: string; outlet: string; it: GNItem; kind: string | null }
  const secondary: Pick[] = [];
  let primary: Pick | null = null;
  for (const it of items) {
    const { headline } = splitOutlet(it.title);
    const outlet = it.sourceName || splitOutlet(it.title).outlet;
    if (!outlet || !it.link) continue;
    const key = outlet.toLowerCase();
    if (taken.has(key)) continue;                       // one member per outlet, never the lead's
    if (!onEvent(it, headline) || !recent(it)) continue; // same event, recent

    const kind = primaryKind(it);
    if (kind) {
      if (!primary) { primary = { headline, outlet, it, kind }; taken.add(key); }
    } else if (secondary.length < want) {
      secondary.push({ headline, outlet, it, kind: null });
      taken.add(key);
    }
    if (secondary.length >= want && primary) break;
  }
  const picks = [...secondary, ...(primary ? [primary] : [])];
  if (picks.length === 0) return [];

  // Resolve each to the publisher's canonical URL + a real excerpt, in parallel
  // so this adds one round-trip, not one per outlet.
  const perMs = opts.perArticleMs ?? 5000;
  const resolved = await Promise.allSettled(picks.map((p) => resolveArticle(p.it.link, perMs)));

  return picks.map((p, i) => {
    const r = resolved[i].status === 'fulfilled'
      ? (resolved[i] as PromiseFulfilledResult<{ url: string; excerpt: string }>).value
      : { url: p.it.link, excerpt: '' };
    const link = r.url || p.it.link;
    // Tag non-English coverage so the writer attributes it as such and the
    // dossier shows the reach ("as reported in Spanish by …").
    const langTag = p.it.lang !== 'en' ? `[${LANG_LABEL[p.it.lang] || p.it.lang}-language coverage] ` : '';
    const description = langTag + (r.excerpt || p.it.description || '');
    const source: FeedSource = {
      id: `${p.kind ? 'primary' : 'corr'}-${slug(p.outlet)}`,
      name: p.outlet,
      url: link,
      category: lead.source.category as NewsCategory,
      sciBaseline: baselineFor(p.outlet),
      enabled: true,
      ...(p.kind ? { sourceType: p.kind } : null),
    };
    return {
      item: { title: p.headline, link, description, publishedAt: p.it.publishedAt, imageUrl: null, imageWidth: null },
      source,
    };
  });
}
