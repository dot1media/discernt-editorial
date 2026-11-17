/**
 * Feed sources for the automated content pipeline.
 *
 * Each source maps to one of the app's news categories and carries an SCI
 * (Source Credibility Index) baseline. Three of the five SCI indicators are
 * properties of the OUTLET rather than the individual article — track
 * record, editorial standards, and transparency — so they are set here
 * deterministically instead of being guessed per-article. The remaining
 * two (primary-source access, verification) are assessed per article.
 *
 * Edit freely: add/remove feeds, tune baselines, or override the entire
 * list at deploy time with the PIPELINE_FEEDS env var (JSON array of
 * FeedSource). Feeds that fail to fetch are skipped and logged — a bad URL
 * never breaks the run.
 */

export type NewsCategory =
  | 'world' | 'politics' | 'faith' | 'culture'
  | 'technology' | 'health' | 'business' | 'environment';

export interface SciBaseline {
  /** 3.3 Transparency & accountability of the outlet (0–2) */
  transparency: 0 | 1 | 2;
  /** 3.4 Historical track-record accuracy of the outlet (0–2) */
  trackRecord: 0 | 1 | 2;
  /** 3.5 Editorial standards / methodology of the outlet (0–2) */
  editorialStandards: 0 | 1 | 2;
}

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  category: NewsCategory;
  sciBaseline: SciBaseline;
  enabled: boolean;
  /**
   * Dossier source_type for members produced by this source. Registry feeds
   * leave it unset (treated as secondary reporting); the corroboration layer
   * sets it, marking primary documents (government_document, public_record,
   * press_release, …) so the writer and scorer can treat them as firsthand.
   */
  sourceType?: string;
}

/** source_type values that count as a firsthand/primary source for scoring
 *  sciPrimarySourceAccess. Mirrors the newsroom SOURCE_TYPES list. */
export const PRIMARY_SOURCE_TYPES = new Set([
  'primary', 'government_document', 'public_record', 'press_release', 'organization',
]);

export const DEFAULT_FEEDS: FeedSource[] = [
  // ── Discernt beat: reputable Christian news outlets covering God's work —
  //    the gospel advancing, church growth, redemption, revival, answered
  //    prayer, testimony, and the persecuted church. Grouped by lane below.
  //    Feeds that fail are skipped at runtime; override with PIPELINE_FEEDS
  //    at deploy time. The app's per-beat discovery scouts reach far wider
  //    (world news, local languages); these feeds seed the AI Desk.
  //
  //    NOTE: Open Doors and CBN feed URLs are best-effort and should be
  //    confirmed against the live sites — if one 404s it is simply skipped,
  //    and the per-beat scouts surface that outlet's stories via web search
  //    regardless.

  // Missions & church growth
  { id: 'mnn', name: 'Mission Network News', url: 'https://www.mnnonline.org/feed/', category: 'world', sciBaseline: { transparency: 2, trackRecord: 2, editorialStandards: 1 }, enabled: true },
  { id: 'baptist-press', name: 'Baptist Press', url: 'https://www.baptistpress.com/feed/', category: 'faith', sciBaseline: { transparency: 2, trackRecord: 1, editorialStandards: 1 }, enabled: true },

  // Global faith reporting
  { id: 'christianity-today', name: 'Christianity Today', url: 'https://feeds.christianitytoday.com/christianitytoday/ctmag', category: 'faith', sciBaseline: { transparency: 2, trackRecord: 2, editorialStandards: 2 }, enabled: true },
  { id: 'religion-news', name: 'Religion News Service', url: 'https://religionnews.com/feed/', category: 'world', sciBaseline: { transparency: 2, trackRecord: 2, editorialStandards: 2 }, enabled: true },
  { id: 'catholic-news-agency', name: 'Catholic News Agency', url: 'https://www.catholicnewsagency.com/rss/news.xml', category: 'world', sciBaseline: { transparency: 2, trackRecord: 2, editorialStandards: 1 }, enabled: true },

  // Persecuted church
  { id: 'open-doors', name: 'Open Doors', url: 'https://www.opendoors.org/en-US/feed/', category: 'world', sciBaseline: { transparency: 2, trackRecord: 2, editorialStandards: 1 }, enabled: true },

  // Testimony & revival
  { id: 'cbn-news', name: 'CBN News', url: 'https://www2.cbn.com/rss/cbnnews.xml', category: 'world', sciBaseline: { transparency: 1, trackRecord: 1, editorialStandards: 1 }, enabled: true },
  { id: 'premier-christian', name: 'Premier Christian News', url: 'https://premierchristian.news/en/rss.xml', category: 'world', sciBaseline: { transparency: 1, trackRecord: 1, editorialStandards: 1 }, enabled: true },

  // Additional reputable faith outlets
  { id: 'gospel-coalition', name: 'The Gospel Coalition', url: 'https://www.thegospelcoalition.org/feed/', category: 'culture', sciBaseline: { transparency: 2, trackRecord: 1, editorialStandards: 1 }, enabled: true },
  { id: 'christian-post', name: 'The Christian Post', url: 'https://www.christianpost.com/rss', category: 'faith', sciBaseline: { transparency: 2, trackRecord: 1, editorialStandards: 1 }, enabled: true },
];

/** Category → fallback hero image (matches the visual style already used in-app). */
/**
 * Fallback image POOLS by category. When an RSS item carries no image, one
 * of these is chosen deterministically per-article (hashed from the article
 * link) so that imageless stories in the same category don't all share one
 * identical photo. Deterministic selection means the same article always
 * gets the same fallback (stable across re-runs), while different articles
 * spread across the pool.
 */
export const CATEGORY_FALLBACK_POOLS: Record<NewsCategory, string[]> = {
  world: [
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1492962827063-e5ea0d8c01f5?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1519452575417-564c1401ecc0?w=1600&q=80&auto=format',
  ],
  politics: [
    'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1575320181282-9afab399332c?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1591189863430-ab87e120f312?w=1600&q=80&auto=format',
  ],
  faith: [
    'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1544427920-c49ccfb85579?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1490127252417-7c393f993ee4?w=1600&q=80&auto=format',
  ],
  culture: [
    'https://images.unsplash.com/photo-1461360228754-6e81c478b882?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1600&q=80&auto=format',
  ],
  technology: [
    'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&q=80&auto=format',
  ],
  health: [
    'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1526256262350-7da7584cf5eb?w=1600&q=80&auto=format',
  ],
  business: [
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1444653614773-995cb1ef9efa?w=1600&q=80&auto=format',
  ],
  environment: [
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=1600&q=80&auto=format',
    'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=1600&q=80&auto=format',
  ],
};

/** Deterministic per-article fallback image: same link → same image, but
 *  different links spread across the category pool. */
export function fallbackImageFor(category: NewsCategory, seed: string): string {
  const pool = CATEGORY_FALLBACK_POOLS[category] || CATEGORY_FALLBACK_POOLS.world;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

/** Back-compat: the old single-image map, now sourced from the pools. */
export const CATEGORY_FALLBACK_IMAGES: Record<NewsCategory, string> = {
  world: CATEGORY_FALLBACK_POOLS.world[0],
  politics: CATEGORY_FALLBACK_POOLS.politics[0],
  faith: CATEGORY_FALLBACK_POOLS.faith[0],
  culture: CATEGORY_FALLBACK_POOLS.culture[0],
  technology: CATEGORY_FALLBACK_POOLS.technology[0],
  health: CATEGORY_FALLBACK_POOLS.health[0],
  business: CATEGORY_FALLBACK_POOLS.business[0],
  environment: CATEGORY_FALLBACK_POOLS.environment[0],
};

/** Resolve the active feed list: env override → defaults. */
export function getFeeds(): FeedSource[] {
  const raw = process.env.PIPELINE_FEEDS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`📡 Using ${parsed.length} feeds from PIPELINE_FEEDS env override`);
        return parsed as FeedSource[];
      }
    } catch (e: any) {
      console.error('❌ PIPELINE_FEEDS is not valid JSON — falling back to defaults:', e.message);
    }
  }
  return DEFAULT_FEEDS.filter((f) => f.enabled);
}
