/**
 * Outlet reliability — a read-only learning signal for the AI desk.
 *
 * The registry in sources.ts carries a static SCI baseline per outlet
 * (transparency / track record / editorial standards). Over time the newsroom
 * accumulates evidence about how those outlets actually perform: how editors
 * score their stories' verification, and how their factual claims resolve. This
 * module turns that evidence into a per-outlet report and, where the evidence
 * is strong and plentiful enough, a SUGGESTED baseline adjustment.
 *
 * Two hard rules keep this safe:
 *   1. HUMAN signal only. We aggregate human (rater 2) ratings and editor-
 *      resolved claims, never the AI scorer's own first-pass numbers. Letting
 *      the AI's scores feed back into the baselines that shape the next AI pass
 *      would be a self-reinforcing bias loop. Excluding rater_kind='ai' closes
 *      it.
 *   2. SUGGEST, never apply. This function returns suggestions; it does not
 *      write to the registry. An editor reviews each one and changes the
 *      baseline by hand (sources.ts or the PIPELINE_FEEDS override). Baselines
 *      never move on their own.
 *
 * It is also conservative: a suggestion needs a minimum sample, moves track
 * record by at most one step, and stays within 0..2.
 */

import { sql } from '@/lib/db';
import { getFeeds, type SciBaseline } from '@/lib/ai/sources';

export interface OutletReliability {
  outlet: string;
  /** AI stories from this outlet that carry a human (rater 2) rating. */
  ratedStories: number;
  /** Mean human-assigned sciVerification (0..2), or null when no rated stories. */
  meanHumanVerification: number | null;
  /** Mean human-assigned sciPrimarySourceAccess (0..2), or null. */
  meanHumanPrimaryAccess: number | null;
  claimsTotal: number;
  claimsConfirmed: number;
  claimsFalseOrDisputed: number;
  /** Share of resolved claims that came out false or disputed (0..1), or null. */
  badClaimRate: number | null;
  /** The outlet's current registry baseline, when it is a registry feed. */
  baseline: SciBaseline | null;
  /** A suggested, bounded baseline change for an editor to approve — or null. */
  suggestion: { field: 'trackRecord'; from: number; to: number; direction: 'up' | 'down'; reason: string } | null;
}

export interface ReliabilityReport {
  generatedAt: string;
  minStories: number;
  outlets: OutletReliability[];
  note: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute per-outlet reliability from human ratings and resolved claims.
 * Read-only. `minStories` is the sample floor a suggestion needs (default 5).
 */
export async function computeOutletReliability(opts: { minStories?: number } = {}): Promise<ReliabilityReport> {
  const minStories = Math.max(3, opts.minStories ?? 5);

  // Human SCI means per outlet (rater 2 only; AI first-pass scores excluded).
  const sciRows = (await sql`
    SELECT s.source_name AS outlet,
           count(*)::int AS rated,
           avg((r.scores->>'sciVerification')::numeric)        AS mean_verif,
           avg((r.scores->>'sciPrimarySourceAccess')::numeric) AS mean_primary
    FROM story_ratings r
    JOIN stories s ON s.id = r.story_id
    WHERE r.rater_kind = 'human'
      AND s.origin = 'ai'
      AND coalesce(s.source_name, '') <> ''
    GROUP BY s.source_name
  `) as { outlet: string; rated: number; mean_verif: string | null; mean_primary: string | null }[];

  // Editor-resolved claim outcomes per outlet.
  const claimRows = (await sql`
    SELECT s.source_name AS outlet,
           count(*) FILTER (WHERE vc.status = 'confirmed')::int           AS confirmed,
           count(*) FILTER (WHERE vc.status IN ('false', 'disputed'))::int AS bad,
           count(*) FILTER (WHERE vc.status <> 'unconfirmed')::int         AS resolved
    FROM verification_claims vc
    JOIN stories s ON s.id = vc.story_id
    WHERE s.origin = 'ai'
      AND coalesce(s.source_name, '') <> ''
    GROUP BY s.source_name
  `) as { outlet: string; confirmed: number; bad: number; resolved: number }[];

  const claimsByOutlet = new Map(claimRows.map((c) => [c.outlet, c]));
  const baselineByOutlet = new Map(getFeeds().map((f) => [f.name, f.sciBaseline]));

  const outlets: OutletReliability[] = sciRows.map((row) => {
    const outlet = row.outlet;
    const ratedStories = row.rated || 0;
    const meanHumanVerification = row.mean_verif != null ? round2(Number(row.mean_verif)) : null;
    const meanHumanPrimaryAccess = row.mean_primary != null ? round2(Number(row.mean_primary)) : null;
    const c = claimsByOutlet.get(outlet);
    const claimsConfirmed = c?.confirmed ?? 0;
    const claimsFalseOrDisputed = c?.bad ?? 0;
    const resolved = c?.resolved ?? 0;
    const claimsTotal = resolved;
    const badClaimRate = resolved > 0 ? round2(claimsFalseOrDisputed / resolved) : null;
    const baseline = baselineByOutlet.get(outlet) ?? null;

    let suggestion: OutletReliability['suggestion'] = null;
    // Suggestions only for registry outlets with enough human-rated evidence.
    if (baseline && ratedStories >= minStories && meanHumanVerification != null) {
      const strong = meanHumanVerification >= 1.6 && (badClaimRate == null || badClaimRate <= 0.1);
      const weak = meanHumanVerification <= 0.8 || (badClaimRate != null && badClaimRate >= 0.3);
      if (strong && baseline.trackRecord < 2) {
        suggestion = {
          field: 'trackRecord', from: baseline.trackRecord, to: baseline.trackRecord + 1, direction: 'up',
          reason: `Over ${ratedStories} human-rated stories, editors scored verification ${meanHumanVerification}/2 on average${badClaimRate != null ? ` with a ${Math.round(badClaimRate * 100)}% false/disputed claim rate` : ''}. Consistently stronger than the current track-record baseline of ${baseline.trackRecord}/2.`,
        };
      } else if (weak && baseline.trackRecord > 0) {
        suggestion = {
          field: 'trackRecord', from: baseline.trackRecord, to: baseline.trackRecord - 1, direction: 'down',
          reason: `Over ${ratedStories} human-rated stories, editors scored verification ${meanHumanVerification}/2 on average${badClaimRate != null ? ` with a ${Math.round(badClaimRate * 100)}% false/disputed claim rate` : ''}. Consistently weaker than the current track-record baseline of ${baseline.trackRecord}/2.`,
        };
      }
    }

    return {
      outlet, ratedStories, meanHumanVerification, meanHumanPrimaryAccess,
      claimsTotal, claimsConfirmed, claimsFalseOrDisputed, badClaimRate, baseline, suggestion,
    };
  });

  // Most evidence first; outlets with a pending suggestion float to the top.
  outlets.sort((a, b) => Number(!!b.suggestion) - Number(!!a.suggestion) || b.ratedStories - a.ratedStories);

  return {
    generatedAt: new Date().toISOString(),
    minStories,
    outlets,
    note: 'Suggestions are advisory and come only from human ratings and editor-resolved claims. Baselines never change automatically; an editor applies any change in sources.ts or the PIPELINE_FEEDS override.',
  };
}
