/**
 * EDITORIAL THESIS — the core identity that governs what Discernt selects,
 * how it frames stories, and what it refuses. This is the single source of
 * truth for the app's angle and voice, referenced by the writer prompt, the
 * story-selection gate, and the media matchers so that articles, reels, and
 * photojournalism all express one coherent editorial character.
 *
 * The thesis, in one line: Discernt exists to help Christians engage the
 * news with discernment and hope — measured reporting seen through a biblical
 * lens — NOT to chase outrage, fear, or sensation.
 */

export const EDITORIAL_THESIS = {
  mission:
    'Discernt brings followers of Jesus true stories of God at work in the world — ' +
    'faith and hope, redemption in Christ, answered prayer, miracles reported with ' +
    'care, and the gospel advancing among every people and language. We report what ' +
    'is true, weigh it with discernment, and refuse hype and the outrage economy. ' +
    'Our credibility rests on measured, verifiable reporting that treats every ' +
    'person with dignity and gives glory to Christ, not to platforms.',

  voice:
    'Measured, calm, intellectually honest, and pastorally warm. Never sensational, ' +
    'never fearmongering, never partisan. We work to remove bias as far as we can — ' +
    'reporting what is verifiable, drawing on several outlets, representing every ' +
    'person charitably, and separating reporting from narrative. We inform for ' +
    'stewardship and prayer, not for anxiety or tribal reaction.',

  // The governing paradigm — see "The Turning Toward" methodology. All media
  // is a turning of the reader's attention. Diversion turns attention AWAY
  // (toward the inflammatory, the tribal, the empty-urgent); we practice
  // CONVERSION — a turning TOWARD what is true, dignifying, and revelatory.
  paradigm:
    'Every story turns the reader’s attention somewhere. We refuse diversion ' +
    '(turning attention away, toward outrage and fear) and practice conversion ' +
    '(turning attention toward what is true, dignifying, and revelatory). We do ' +
    'not chase the eye; we turn it toward the light.',

  // Stories that ADVANCE the thesis (favor these).
  favored:
    'the gospel advancing and the church growing, revival and awakening, redemption ' +
    'and lives transformed in Christ, answered prayer, miracles and healings told ' +
    'with sober verification, the courage and endurance of the persecuted church, ' +
    'works of mercy and justice done in Jesus name, and faith among every people ' +
    'and language.',

  // Framing DISCOURAGED — these are the "jarring headlines" to avoid amplifying.
  discouraged:
    'lurid crime detail, celebrity scandal, partisan point-scoring, fear-driven ' +
    'speculation, outrage bait, and sensational tragedy framed for shock rather ' +
    'than understanding.',
};

/**
 * THE FIVE TURNINGS — the operational disciplines of the Turning Toward
 * methodology. Each is a way a piece of media turns the reader TOWARD rather
 * than away. These are threaded into the writer prompt so the app's voice is
 * not just "measured" in the abstract but disciplined in five concrete ways.
 */
export const FIVE_TURNINGS = [
  'From Reaction to Reflection: slow the reader down. Do not ask how this ' +
    'makes them feel in three seconds; help them see what it means and what ' +
    'it asks of them.',
  'From Spectacle to Dignity: every person in the story bears the image of ' +
    'God, including the one the reader is invited to despise. Render the ' +
    'strongest honest version of each side, because contempt is a blindness.',
  'From Fragment to Frame: restore the context that makes a fact intelligible. ' +
    'A fact without a frame is not information but ammunition — give the ' +
    'why-now and name what remains unknown.',
  'From Noise to Signal: not everything true is worth attention today. Favor ' +
    'the consequential, dignifying, and formative; refuse the sensational-but-' +
    'empty even when it would perform.',
  'From Information to Revelation: do not stop at what happened. Through the ' +
    'closing reflection, invite the reader past information toward what the ' +
    'story discloses about the world, the neighbor, and God — ending with a ' +
    'question to carry, never a verdict imposed.',
];

/** Compact rendering of the Five Turnings for prompt injection. */
export function turningsForPrompt(): string {
  return FIVE_TURNINGS.map((t, i) => `${i + 1}. ${t}`).join('\n');
}

/**
 * Sensational-headline signal words. When a source headline leans on these,
 * the story is either DE-SENSATIONALIZED in the rewrite or (if it has no
 * substance beyond the shock) skipped. This is not censorship of hard news —
 * a serious story about violence or tragedy can still run; what we drop is
 * framing engineered purely for a jolt.
 */
export const SENSATIONAL_SIGNALS = [
  'slams', 'slammed', 'blasts', 'destroys', 'obliterates', 'shocking', 'shock',
  'horror', 'terrifying', 'chaos', 'meltdown', 'explosive', 'bombshell', 'savage',
  'brutal', 'nightmare', 'outrage', 'fury', 'furious', 'rips', 'eviscerates',
  'you won’t believe', 'jaw-dropping', 'stunning', 'sends shockwaves',
];

export function headlineSensationScore(title: string): number {
  const t = (title || '').toLowerCase();
  let hits = 0;
  for (const w of SENSATIONAL_SIGNALS) if (t.includes(w)) hits++;
  return hits;
}

/** Extremely sensational headlines (2+ signal words) with little else are
 *  skipped at selection time to protect the thesis. */
export function isTooSensational(title: string): boolean {
  return headlineSensationScore(title) >= 2;
}

/* ------------------------------------------------------------------ *
 * Editorial scope filter — Discernt
 *
 * Discernt's beat is the kingdom of God at work in the world: faith and
 * hope, redemption in Christ, answered prayer, revival and the church
 * growing, miracles reported with care, works of mercy and justice done
 * in Jesus' name, and the courage of the persecuted church — among every
 * people and language. A story must carry a faith/kingdom signal (in its
 * headline, summary, tags, or feed category) to be in scope. General
 * politics, crime, business, tech, sports, and lifestyle items are out
 * unless they are genuinely a story of God at work.
 *
 * This runs at candidate-selection time on the headline (and any feed
 * tags/summary passed in). It is intentionally generous about what counts
 * as a faith signal and strict about everything else.
 * ------------------------------------------------------------------ */

// Core faith vocabulary — Christianity, the church, Scripture, and the people
// and practices of the faith.
const FAITH_TERMS = [
  'church', 'christian', 'christianity', 'faith', 'jesus', 'christ', 'gospel',
  'bible', 'biblical', 'scripture', 'pastor', 'ministry', 'congregation',
  'religious', 'religion', 'catholic', 'protestant', 'evangelical', 'baptist',
  'pentecostal', 'orthodox', 'anglican', 'methodist', 'presbyterian',
  'denomination', 'worship', 'prayer', 'prayed', 'clergy', 'missionary',
  'missions', 'mission', 'theology', 'diocese', 'parish', 'sermon', 'chaplain',
  'disciple', 'discipleship', 'believer', 'believers', 'faithful', 'christlike',
  'kingdom of god', 'kingdom of heaven', 'holy spirit', 'cross', 'resurrection',
];

// Kingdom signals — the specific kinds of story Discernt exists to tell:
// God visibly at work, lives changed, prayer answered, the church enduring.
const KINGDOM_TERMS = [
  'redemption', 'redeemed', 'redemptive', 'salvation', 'saved', 'born again',
  'testimony', 'testimonies', 'conversion', 'converted', 'came to faith',
  'baptism', 'baptized', 'baptised', 'revival', 'revivals', 'awakening',
  'answered prayer', 'answer to prayer', 'miracle', 'miracles', 'miraculous',
  'healing', 'healed', 'deliverance', 'transformed', 'transformation',
  'restoration', 'restored', 'forgiveness', 'reconciliation', 'reconciled',
  'persecution', 'persecuted', 'martyr', 'martyrdom', 'underground church',
  'house church', 'the church grows', 'church growth', 'planted a church',
  'church planting', 'evangelism', 'evangelist', 'outreach', 'hope in christ',
  'movement of god', 'move of god', 'faith community', 'answered prayers',
];

function anyTermIn(haystack: string, terms: string[]): boolean {
  for (const t of terms) if (haystack.includes(t)) return true;
  return false;
}

/**
 * Returns true if a story fits Discernt's beat: a story of faith or of God's
 * kingdom at work. `category` is the feed's own category, used as a soft
 * signal (a faith-category feed leans in-scope even when the headline is terse).
 */
export function isInScope(
  title: string,
  opts: { category?: string; summary?: string; tags?: string[] } = {},
): boolean {
  const hay = [title, opts.summary || '', ...(opts.tags || [])].join(' ').toLowerCase();

  // A faith-category feed is in scope by default.
  if (opts.category === 'faith') return true;

  // Core faith vocabulary.
  if (anyTermIn(hay, FAITH_TERMS)) return true;

  // Kingdom signals — the stories Discernt most wants to tell.
  if (anyTermIn(hay, KINGDOM_TERMS)) return true;

  // Everything else (general politics, crime, business, tech, sports,
  // lifestyle with no faith hook) is out of scope.
  return false;
}
