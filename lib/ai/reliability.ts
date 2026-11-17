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

/* --------------------------- weekly email digest --------------------------- */

const esc = (s: string): string =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Render the reliability report as an internal email (Discernt gold style).
 * Returns null when there is nothing worth sending (no human-rated outlets yet).
 */
export function buildReliabilityDigest(report: ReliabilityReport): { subject: string; html: string; text: string } | null {
  const rated = report.outlets.filter((o) => o.ratedStories > 0);
  if (rated.length === 0) return null;
  const suggestions = rated.filter((o) => o.suggestion);
  const date = new Date(report.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const subject = suggestions.length
    ? `Discernt outlet reliability: ${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} to review`
    : `Discernt outlet reliability: weekly summary`;

  const fmt = (n: number | null, suffix = '') => (n == null ? '&middot;' : `${n}${suffix}`);
  const rows = rated
    .map((o) => {
      const sug = o.suggestion
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:12px;background:${o.suggestion.direction === 'up' ? '#E7EFE9' : '#F6E7E4'};color:#1B1917;">track ${o.suggestion.from} &rarr; ${o.suggestion.to}</span>`
        : '<span style="color:#9A9285;">&middot;</span>';
      const sugReason = o.suggestion ? `<div style="font-size:12px;color:#767065;padding-top:4px;">${esc(o.suggestion.reason)}</div>` : '';
      return `<tr>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;font-weight:bold;color:#1B1917;">${esc(o.outlet)}${sugReason}</td>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;text-align:center;color:#33302B;">${o.ratedStories}</td>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;text-align:center;color:#33302B;">${fmt(o.meanHumanVerification, '/2')}</td>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;text-align:center;color:#33302B;">${o.badClaimRate == null ? '&middot;' : Math.round(o.badClaimRate * 100) + '%'}</td>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;text-align:center;color:#33302B;">${o.baseline ? o.baseline.trackRecord + '/2' : '&middot;'}</td>
        <td style="padding:10px 12px;border-top:1px solid #E6DED1;text-align:center;">${sug}</td>
      </tr>`;
    })
    .join('');

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE4;padding:28px 0;font-family:Georgia,'Times New Roman',serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#F8F5EF;border:1px solid #E0D7C8;">
      <tr><td style="background:#14120F;padding:22px 30px;">
        <div style="color:#F3EEE4;font-size:20px;font-weight:bold;letter-spacing:1px;">DISCERNT</div>
        <div style="color:#8A6A17;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Newsroom &middot; Outlet Reliability</div>
      </td></tr>
      <tr><td style="padding:26px 30px 8px;">
        <div style="font-size:12px;letter-spacing:2px;color:#8A6A17;text-transform:uppercase;font-weight:bold;">Weekly digest &middot; ${esc(date)}</div>
        <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#33302B;">${rated.length} outlet${rated.length > 1 ? 's' : ''} now carry human-rated evidence${suggestions.length ? `, and ${suggestions.length} ${suggestions.length > 1 ? 'have' : 'has'} a track-record suggestion worth a look.` : '. No baseline changes are suggested this week.'}</p>
      </td></tr>
      <tr><td style="padding:14px 30px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr style="color:#8A6A17;text-transform:uppercase;font-size:11px;letter-spacing:1px;">
            <td style="padding:0 12px 6px;">Outlet</td>
            <td style="padding:0 12px 6px;text-align:center;">Rated</td>
            <td style="padding:0 12px 6px;text-align:center;">Human verif.</td>
            <td style="padding:0 12px 6px;text-align:center;">False / disputed</td>
            <td style="padding:0 12px 6px;text-align:center;">Track baseline</td>
            <td style="padding:0 12px 6px;text-align:center;">Suggestion</td>
          </tr>
          ${rows}
        </table>
      </td></tr>
      <tr><td style="padding:18px 30px 26px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#767065;">${esc(report.note)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text =
    `Discernt — Outlet Reliability (weekly digest, ${date})\n\n` +
    `${rated.length} outlet(s) with human-rated evidence; ${suggestions.length} suggestion(s).\n\n` +
    rated
      .map((o) => {
        const base = `${o.outlet}: ${o.ratedStories} rated, verification ${fmtText(o.meanHumanVerification)}/2, false/disputed ${o.badClaimRate == null ? 'n/a' : Math.round(o.badClaimRate * 100) + '%'}, track baseline ${o.baseline ? o.baseline.trackRecord : 'n/a'}/2`;
        return o.suggestion ? `${base}\n  SUGGESTION: track ${o.suggestion.from} -> ${o.suggestion.to}. ${o.suggestion.reason}` : base;
      })
      .join('\n') +
    `\n\n${report.note}`;

  return { subject, html, text };
}

const fmtText = (n: number | null) => (n == null ? 'n/a' : String(n));
