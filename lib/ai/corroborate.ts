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
 * genuinely overlaps the event, and hand them back as additional SourceMembers.
 * The writer then synthesizes one account across outlets and attributes where
 * they converge and diverge; the independent scorer raises Source Credibility
 * (verification) only because several outlets now carry the same facts.
 *
 * This never publishes anything: corroborating outlets land in the draft's
 * dossier as PENDING sources, their claims stay "unconfirmed", and confidence
 * stays developing/moderate until a human completes the dual-rater review. It
 * is a research aid for the editor, not a verification shortcut. Any failure
 * (network, parse, no results) returns [] so a run is never broken.
 */

import { parseFeedBody } from './rss';
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

export interface CorroborateOpts {
  /** How many ADDITIONAL distinct outlets to try to add. */
  want: number;
  timeoutMs?: number;
}

/**
 * Find additional outlets covering the lead member's event. Returns up to
 * `want` SourceMembers, each a distinct outlet not already present, whose
 * headline overlaps the event. Best-effort and side-effect free.
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

  const url =
    'https://news.google.com/rss/search?' +
    new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' }).toString();
  const xml = await fetchXml(url, opts.timeoutMs ?? 9000);
  if (!xml) return [];

  const items = parseFeedBody(xml);
  const leadTokens = tokens(lead.item.title);
  const leadWhen = lead.item.publishedAt?.getTime() ?? null;
  const taken = new Set<string>([...existingOutlets].map((n) => n.toLowerCase()));
  const out: SourceMember[] = [];

  for (const it of items) {
    if (out.length >= want) break;
    const { headline, outlet } = splitOutlet(it.title);
    if (!outlet || !it.link) continue;
    const key = outlet.toLowerCase();
    if (taken.has(key)) continue;                       // one member per outlet, and never the lead's outlet

    // Same event: the corroborating headline must share the lead's distinctive words.
    const ct = tokens(headline);
    let inter = 0;
    for (const t of ct) if (leadTokens.has(t)) inter++;
    const union = ct.size + leadTokens.size - inter;
    const jaccard = union ? inter / union : 0;
    if (!(inter >= 2 || jaccard >= 0.3)) continue;

    // Recency: within six days of the lead when both dates are known.
    if (leadWhen && it.publishedAt) {
      if (Math.abs(it.publishedAt.getTime() - leadWhen) > 6 * 24 * 3600 * 1000) continue;
    }

    taken.add(key);
    const source: FeedSource = {
      id: `corr-${slug(outlet)}`,
      name: outlet,
      url: it.link,
      category: lead.source.category as NewsCategory,
      sciBaseline: baselineFor(outlet),
      enabled: true,
    };
    // Carry the cleaned headline (outlet suffix stripped) so the writer and the
    // dossier read naturally.
    out.push({ item: { ...it, title: headline }, source });
  }
  return out;
}
