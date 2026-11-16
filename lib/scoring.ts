// D1-4LS scoring for the editorial portal. This mirrors the news app's canonical engine so a
// score computed here maps cleanly onto the news database when a story publishes. Same model:
// 4 indices (BAI, PSI, SCI, HII), 5 indicators each, every indicator 0-2, index total = sum of
// its 5 (0-10), overall = sum of the 4 (0-40). Totals are ALWAYS derived from indicators; any
// supplied total is advisory. Per the Handbook (Part IV): a score of 1 is ordinary competence,
// not failure; the profile matters more than the total; the person outranks the instrument.

export interface IndicatorScores {
  baiScripturalConsistency: number;
  baiDoctrinalIntegrity: number;
  baiMoralFramework: number;
  baiAnthropology: number;
  baiTeleology: number;
  psiTextualLinkage: number;
  psiEschatologicalFit: number;
  psiHistoricalContinuity: number;
  psiSpiritualImpact: number;
  psiTheologicalRestraint: number;
  sciPrimarySourceAccess: number;
  sciVerification: number;
  sciTransparency: number;
  sciTrackRecord: number;
  sciEditorialStandards: number;
  hiiHumanDignity: number;
  hiiCompassionEmpathy: number;
  hiiSocietalImpact: number;
  hiiJusticeResponsibility: number;
  hiiChristModeledCare: number;
}

export interface IndexTotals {
  biblicalAlignment: number;
  propheticSignificance: number;
  sourceCredibility: number;
  humanities: number;
  total: number;
}

export type ScoreConfidence = "high" | "moderate" | "developing";

export const INDICATOR_KEYS: (keyof IndicatorScores)[] = [
  "baiScripturalConsistency", "baiDoctrinalIntegrity", "baiMoralFramework", "baiAnthropology", "baiTeleology",
  "psiTextualLinkage", "psiEschatologicalFit", "psiHistoricalContinuity", "psiSpiritualImpact", "psiTheologicalRestraint",
  "sciPrimarySourceAccess", "sciVerification", "sciTransparency", "sciTrackRecord", "sciEditorialStandards",
  "hiiHumanDignity", "hiiCompassionEmpathy", "hiiSocietalImpact", "hiiJusticeResponsibility", "hiiChristModeledCare",
];

// Map each camelCase indicator to the news database column (news_stories table).
export const INDICATOR_DB_COLUMN: Record<keyof IndicatorScores, string> = {
  baiScripturalConsistency: "bai_scriptural_consistency",
  baiDoctrinalIntegrity: "bai_doctrinal_integrity",
  baiMoralFramework: "bai_moral_framework",
  baiAnthropology: "bai_anthropology",
  baiTeleology: "bai_teleology",
  psiTextualLinkage: "psi_textual_linkage",
  psiEschatologicalFit: "psi_eschatological_fit",
  psiHistoricalContinuity: "psi_historical_continuity",
  psiSpiritualImpact: "psi_spiritual_impact",
  psiTheologicalRestraint: "psi_theological_restraint",
  sciPrimarySourceAccess: "sci_primary_source_access",
  sciVerification: "sci_verification",
  sciTransparency: "sci_transparency",
  sciTrackRecord: "sci_track_record",
  sciEditorialStandards: "sci_editorial_standards",
  hiiHumanDignity: "hii_human_dignity",
  hiiCompassionEmpathy: "hii_compassion_empathy",
  hiiSocietalImpact: "hii_societal_impact",
  hiiJusticeResponsibility: "hii_justice_responsibility",
  hiiChristModeledCare: "hii_christ_modeled_care",
};

export const INDEX_META: { key: "SG" | "KS" | "SC" | "FE"; name: string; indicators: { key: keyof IndicatorScores; label: string; anchors: [string, string, string] }[] }[] = [
  {
    key: "SG", name: "Scriptural Grounding",
    indicators: [
      { key: "baiScripturalConsistency", label: "Scriptural Consistency", anchors: ["Contradicts clear biblical teaching", "Neutral or indirect alignment", "Explicitly consistent with Scripture"] },
      { key: "baiDoctrinalIntegrity", label: "Doctrinal Soundness", anchors: ["Affirms false or heretical claims", "Avoids error but lacks clarity", "Consistent with the historic Christian faith"] },
      { key: "baiMoralFramework", label: "Christ-Centeredness", anchors: ["Points away from Christ, toward spectacle", "Christ implicit or peripheral", "Clearly points to Jesus"] },
      { key: "baiAnthropology", label: "Image-Bearer Dignity", anchors: ["Dehumanizing or reductionist", "Partially dignifying", "Affirms every person as an image-bearer"] },
      { key: "baiTeleology", label: "Hope & Purpose", anchors: ["Purposeless or nihilistic", "Implicit meaning", "Carries redemptive hope and purpose"] },
    ],
  },
  {
    key: "KS", name: "Kingdom Significance",
    indicators: [
      { key: "psiTextualLinkage", label: "Gospel Advance", anchors: ["No gospel bearing", "Indirect bearing on the gospel", "The gospel clearly advancing"] },
      { key: "psiEschatologicalFit", label: "Movement of God", anchors: ["No sign of God at work", "Possible but unclear", "A documented move of God: revival, awakening, the church growing or enduring"] },
      { key: "psiHistoricalContinuity", label: "Redemption & Transformation", anchors: ["No life changed", "Some change", "Lives visibly redeemed and transformed"] },
      { key: "psiSpiritualImpact", label: "Answered Prayer", anchors: ["No prayer dimension", "Prayer present but incidental", "Clear, recounted answer to prayer"] },
      { key: "psiTheologicalRestraint", label: "Discernment & Restraint", anchors: ["Speculation or date-setting as certainty", "Some overreach", "Held soberly, with humility and watchfulness"] },
    ],
  },
  {
    key: "SC", name: "Source Credibility",
    indicators: [
      { key: "sciPrimarySourceAccess", label: "Primary-Source Access", anchors: ["No primary sourcing", "Some primary access", "Firsthand accounts, named witnesses, or primary documents"] },
      { key: "sciVerification", label: "Verification & Corroboration", anchors: ["Unverified", "Partially corroborated", "Independently corroborated, especially any miracle or healing claim"] },
      { key: "sciTransparency", label: "Outlet Transparency", anchors: ["Opaque sourcing", "Partial disclosure", "Fully transparent"] },
      { key: "sciTrackRecord", label: "Track Record", anchors: ["Poor reliability", "Mixed record", "Strong reliability"] },
      { key: "sciEditorialStandards", label: "Editorial Standards", anchors: ["No visible standards", "Some standards", "Rigorous standards"] },
    ],
  },
  {
    key: "FE", name: "Fruit & Edification",
    indicators: [
      { key: "hiiHumanDignity", label: "Faith Encouragement", anchors: ["Discourages or corrodes faith", "Neutral", "Strengthens and encourages faith"] },
      { key: "hiiCompassionEmpathy", label: "Compassion & Mercy", anchors: ["Callous", "Detached", "Genuinely compassionate and merciful"] },
      { key: "hiiSocietalImpact", label: "Fruit of the Spirit", anchors: ["Stirs division or strife", "Neutral", "Reconciliation, peace, and love evident"] },
      { key: "hiiJusticeResponsibility", label: "Justice & Righteousness", anchors: ["Unjust framing", "Mixed", "Just and righteous"] },
      { key: "hiiChristModeledCare", label: "Glory to God", anchors: ["Glorifies people or platforms", "Partial", "Gives glory to God"] },
    ],
  },
];

export function clampIndicator(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(2, n));
}

export function normalizeIndicators(raw: Partial<Record<keyof IndicatorScores, unknown>>): IndicatorScores {
  const out = {} as IndicatorScores;
  for (const key of INDICATOR_KEYS) out[key] = clampIndicator(raw?.[key]);
  return out;
}

export function computeIndexTotals(ind: IndicatorScores): IndexTotals {
  const biblicalAlignment =
    ind.baiScripturalConsistency + ind.baiDoctrinalIntegrity + ind.baiMoralFramework + ind.baiAnthropology + ind.baiTeleology;
  const propheticSignificance =
    ind.psiTextualLinkage + ind.psiEschatologicalFit + ind.psiHistoricalContinuity + ind.psiSpiritualImpact + ind.psiTheologicalRestraint;
  const sourceCredibility =
    ind.sciPrimarySourceAccess + ind.sciVerification + ind.sciTransparency + ind.sciTrackRecord + ind.sciEditorialStandards;
  const humanities =
    ind.hiiHumanDignity + ind.hiiCompassionEmpathy + ind.hiiSocietalImpact + ind.hiiJusticeResponsibility + ind.hiiChristModeledCare;
  return {
    biblicalAlignment,
    propheticSignificance,
    sourceCredibility,
    humanities,
    total: biblicalAlignment + propheticSignificance + sourceCredibility + humanities,
  };
}

// The instrument version this engine implements. Stamped onto every published
// story so historical scores are never silently reinterpreted under a new rubric
// (D1-4LS v2.1, Section 19).
export const INSTRUMENT_VERSION = "2.1";

// v2.1 presents the composite as a DESCRIPTIVE band, never an evaluative grade.
// The four-index profile is the primary result; this band is a secondary summary
// and must never be read as truth, probability, or overall quality.
export type CompositeBandKey = "very-high" | "high" | "intermediate" | "low";
export function compositeBand(total: number): { key: CompositeBandKey; label: string; short: string } {
  if (total >= 35) return { key: "very-high", label: "Very high composite profile", short: "Very high" };
  if (total >= 28) return { key: "high", label: "High composite profile", short: "High" };
  if (total >= 20) return { key: "intermediate", label: "Intermediate composite profile", short: "Intermediate" };
  return { key: "low", label: "Low composite profile", short: "Low" };
}

// Back-compat: returns the descriptive short band. Prefer compositeBand().
export function interpretTotal(total: number): string {
  return compositeBand(total).short;
}

// Source-credibility alert bands (v2.1, Section 7). SCI is the sourcing lens
// (0-10). These are provisional editorial thresholds, not validated cutoffs, and
// they never declare an article false.
export type SciNoticeLevel = "none" | "limitation" | "warning";
export function sciNotice(sciTotal: number): { level: SciNoticeLevel; text: string } {
  if (sciTotal <= 3) return { level: "warning", text: "Evidence warning: this story has material sourcing limitations. Weigh its factual claims accordingly." };
  if (sciTotal < 6) return { level: "limitation", text: "Sourcing limitation: read the Source Credibility notes before relying on this story's factual claims." };
  return { level: "none", text: "" };
}

// Profile-balance descriptor from the spread of the four index totals (v2.1,
// Section 12). Descriptive only; not a quality rating.
export function profileBalance(totals: IndexTotals): { diff: number; label: string } {
  const vals = [totals.biblicalAlignment, totals.propheticSignificance, totals.sourceCredibility, totals.humanities];
  const diff = Math.max(...vals) - Math.min(...vals);
  const label = diff <= 2 ? "Relatively balanced" : diff <= 5 ? "Moderately uneven" : "Highly uneven";
  return { diff, label };
}
