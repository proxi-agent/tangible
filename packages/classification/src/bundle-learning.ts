import { BUNDLE_TERMS, INCLUDED_TERMS, mentions } from './bundles.js';
import { EXCLUSION_CATEGORIES, EXCLUSION_KEYS, type ExclusionKey } from './vocabulary.js';

/**
 * Grading the bundle vocabulary against the wordings the firm has actually
 * settled.
 *
 * `bundles.ts` is twenty-seven literals somebody typed. They are good literals
 * — every one of them is defensible from the exclusion rule it points at — but
 * nothing about them was ever measured, and they cannot grow. A preparer who
 * codes forty invoices reading "annual maintenance and support", settles every
 * one of them as an intangible cost, and never sees the advisor say a word
 * about the forty-first has taught this product nothing. That is the gap: the
 * detector reads words, the firm produces words all day, and the two have never
 * been introduced.
 *
 * The introduction is this file. It reads settled descriptions — a reviewer's
 * own answer about one wording, one row per wording — counts which phrases
 * predict which exclusion, and returns two lists:
 *
 *   - **Proposals**, phrases the record says belong in the vocabulary and are
 *     not in it.
 *   - **Challenges**, phrases that *are* in the vocabulary and that the record
 *     mostly disagrees with.
 *
 * The second list is the half that makes this learning rather than accretion. A
 * term list that only ever grows is a term list that gets noisier every season,
 * and the reason hand-written vocabularies go stale is that nobody can say
 * which entry stopped earning its place. Now the record can.
 *
 * ## Nothing here applies itself
 *
 * A proposal carries the source line to paste into `TERMS` and stops. This
 * follows `rule-drafts.ts` exactly, and for its reason: a vocabulary that a
 * process rewrites is a vocabulary with no diff to read and nobody's name on
 * it. The stakes are lower here than for a valuation schedule — a bundle signal
 * changes no classification and files nothing, it puts a sentence in front of a
 * person coding an invoice — but "lower stakes" is an argument for a low bar,
 * not for no signature. What it buys is that the bar can be honest: a phrase
 * that clears it is one worth a partner's ten seconds, and everything below it
 * is arithmetic nobody has to trust.
 *
 * ## What a challenge means, and what it does not
 *
 * A challenge is weaker evidence than a proposal, and the asymmetry is real.
 * The advisor's claim is "this description mentions leasing", which stays true
 * about a description that turned out to describe an owned forklift. So a
 * challenged term is not a *wrong* term; it is a term that is mostly noise on
 * this firm's registers, which is a judgement about cost and attention rather
 * than about law. Retiring one is a decision, and the counts are printed so it
 * is made on evidence rather than on a number.
 *
 * A term the record has never seen is not challenged at all. Silence is not
 * disagreement — "capitalized interest" earns its place the first week it
 * appears, and no quantity of registers that never said it is an argument
 * against keeping it.
 */

/**
 * One wording a person settled, and what they settled it as.
 *
 * The grain is deliberately one row per *distinct wording*, not one per asset
 * and not one per confirmation. Forty rows of "Dell Latitude 5420" are one
 * judgement about one description, and counting them forty times would report a
 * sample size the firm does not have — the same restriction
 * `classification_reviews` puts on its own labels, for the same reason.
 */
export interface SettledDescription {
  description: string;
  /** Any classification key: an exclusion, or a schedule category. */
  categoryKey: string;
}

/**
 * How many observations "this phrase means nothing" is worth.
 *
 * Much weaker than `PRIOR_STRENGTH` in the acceptance learner, and the
 * difference is what the prior *is*. There, the prior is judgement the firm
 * accumulated and a single outcome should not overturn it. Here the prior is a
 * null hypothesis — the phrase is uninformative — and a null hypothesis worth
 * twelve observations would keep every real signal below the bar forever. Four
 * means a phrase has to beat "it means nothing" clearly rather than narrowly.
 */
export const PRIOR_STRENGTH = 4;

/**
 * How many distinct settled wordings must contain a phrase before it is judged.
 *
 * Six, not five, and not for statistical reasons: five is where the acceptance
 * model starts publishing a rate that is *shrunk toward practice*, and a phrase
 * has no practice behind it. Six distinct wordings is the point at which a
 * coincidence in one client's register stops being the whole basis.
 */
export const MIN_MENTIONS = 6;

/** And that many must have gone the same way, or there is no pattern to see. */
export const MIN_SUPPORT = 4;

/**
 * The bar a proposal clears.
 *
 * High on purpose. A proposal is a request for somebody's attention and an
 * invitation to widen what the advisor says about every future invoice; the
 * cost of a bad one is not a wrong number, it is a person learning to skim the
 * panel. Seventy per cent after shrinkage, on a base rate that is usually under
 * ten, is a phrase that is doing real work.
 */
export const PROPOSE_PRECISION = 0.7;

/**
 * The bar under which a term is challenged.
 *
 * Deliberately far below the proposal bar rather than its mirror. The band
 * between them is where most terms will sit and where the right answer is to
 * say nothing: a term that fires on a mixed population is doing what an
 * advisory signal is supposed to do. Only a term that is wrong about the large
 * majority of what it fires on is worth a conversation.
 */
export const CHALLENGE_PRECISION = 0.3;

/** Enough to recognise what the phrase is doing; not a data dump. */
const SAMPLES = 3;

/**
 * Words that carry no argument about what a thing is.
 *
 * Short by design, like the retrieval stopword list, and for the same reason:
 * the words that look like noise in a register — "unit", "system", "service" —
 * are frequently the ones carrying the signal. What is dropped here is only
 * grammar and register furniture.
 */
const STOPWORDS = new Set([
  'and',
  'for',
  'from',
  'the',
  'with',
  'per',
  'each',
  'inc',
  'llc',
  'ltd',
  'co',
  'misc',
  'various',
  'ref',
  'qty',
  'ea',
  'new',
  'used',
]);

export interface BundleTermProposal {
  /** The wording, exactly as it would be written into `TERMS`. */
  phrase: string;
  exclusionKey: ExclusionKey;
  label: string;
  /** Distinct settled wordings containing the phrase. */
  mentions: number;
  /** Of those, how many a person settled as this exclusion. */
  support: number;
  /** Of those, how many a person settled as taxable property on a schedule. */
  contradicting: number;
  /** Shrunk toward the base rate — see `PRIOR_STRENGTH`. */
  precision: number;
  /** How often this exclusion is the answer at all, across the whole record. */
  baseRate: number;
  /** Settled wordings the phrase appears in, so the reader can see what it is. */
  samples: string[];
  /**
   * Other wordings that appear on exactly the same settled rows.
   *
   * Usually the rest of the sentence. Nine rows reading "annual maintenance and
   * support renewal" make "annual", "maintenance", "support" and "renewal" one
   * proposal wearing four faces — the record contains no evidence that
   * separates them, because they have never once appeared apart. Presenting
   * them as four findings would report one pattern four times; picking one and
   * hiding the others would claim a judgement the arithmetic did not make. So
   * they are named, and the person who knows which word carries the meaning
   * spends two seconds being the one who decides.
   */
  alternates: string[];
  /** The line to paste into `TERMS`. Nothing here writes it. */
  source: string;
  /** Why this exclusion is not taxable property, in the rule's own words. */
  basis: string;
}

export interface BundleTermChallenge {
  phrase: string;
  exclusionKey: ExclusionKey;
  label: string;
  mentions: number;
  support: number;
  contradicting: number;
  precision: number;
  /** What the record settled these wordings as instead, commonest first. */
  settledAs: { categoryKey: string; count: number }[];
  samples: string[];
  /** The finding in a sentence, for a screen with room for one line. */
  basis: string;
}

/**
 * A phrase that predicted an exclusion well and will not be proposed.
 *
 * Reported rather than dropped, because the reason is interesting: it is
 * usually a real signal wearing a dangerous word. "Installation" genuinely does
 * predict an intangible cost, because software rollouts are installations —
 * and adding it would tell a preparer to strip the installation cost of a
 * lathe, which understates a sworn return. The fix is a narrower phrase, and
 * the person who can write one is the person reading this list.
 */
export interface WithheldPhrase {
  phrase: string;
  exclusionKey: ExclusionKey;
  mentions: number;
  support: number;
  precision: number;
  /** The included-cost wording it overlaps. */
  collidesWith: string;
  reason: string;
}

export interface BundleVocabularyReview {
  /** Distinct settled wordings read. */
  observations: number;
  /** Of those, how many were settled as one of the three exclusions. */
  exclusionObservations: number;
  /** Distinct phrases that cleared `MIN_MENTIONS` and were therefore judged. */
  judgedPhrases: number;
  proposals: BundleTermProposal[];
  challenges: BundleTermChallenge[];
  withheld: WithheldPhrase[];
  /** Hand-written terms the record has never seen. Not evidence against them. */
  unobserved: string[];
  /** How often each exclusion is the answer at all. The prior every phrase beats. */
  baseRates: Record<ExclusionKey, number>;
}

const RULES = new Map(EXCLUSION_CATEGORIES.map((rule) => [rule.key, rule]));
const EXCLUSIONS = new Set<string>(EXCLUSION_KEYS);

interface Tally {
  mentions: number;
  byExclusion: Map<ExclusionKey, number>;
  /** Settled as something a schedule values: the case against the phrase. */
  schedule: number;
  samples: Map<ExclusionKey, string[]>;
  /**
   * Which rows the phrase matched, folded to a pair of numbers.
   *
   * Polynomial hashes over the row indices in corpus order, which is fixed, so
   * two phrases share a signature when they matched the same rows. That is the
   * test for "these are the same finding said twice" — counts alone would group
   * two unrelated phrases that happen to have fired six times each.
   *
   * Two hashes rather than one, with different seeds and multipliers, because
   * the consequence of a collision is silent: two unrelated proposals merge and
   * one of them is demoted to an `alternates` entry that says the record cannot
   * tell them apart, which would be false. A single 32-bit hash over ten
   * thousand phrases collides about one run in a hundred. Sixty-four bits over
   * the same corpus does not, and it costs one more multiply per row.
   */
  signature: [number, number];
}

/** The two hashes as one comparable key. */
function signatureKey(signature: readonly [number, number]): string {
  return `${signature[0]}:${signature[1]}`;
}

/**
 * Read the record and say what the vocabulary should be.
 *
 * One pass over the corpus per question, and the corpus is the firm's settled
 * wordings — a few thousand rows on a practice with real seasons behind it, so
 * the phrase table stays comfortably in memory. When that stops being true the
 * fix is to count phrases incrementally as decisions are settled, not to sample
 * the corpus: a vocabulary learned from a sample of the firm's own history
 * would be a strange thing to have built.
 */
export function reviewBundleVocabulary(
  settled: readonly SettledDescription[],
): BundleVocabularyReview {
  const rows = settled.filter((row) => row.description.trim().length > 0);
  const exclusionRows = rows.filter((row) => EXCLUSIONS.has(row.categoryKey));

  const baseRates = {} as Record<ExclusionKey, number>;
  for (const key of EXCLUSION_KEYS) {
    baseRates[key] =
      rows.length === 0 ? 0 : rows.filter((row) => row.categoryKey === key).length / rows.length;
  }

  const tallies = new Map<string, Tally>();
  for (const [index, row] of rows.entries()) {
    const key = EXCLUSIONS.has(row.categoryKey) ? (row.categoryKey as ExclusionKey) : null;
    for (const phrase of phrasesIn(row.description)) {
      let tally = tallies.get(phrase);
      if (!tally) {
        tally = {
          mentions: 0,
          byExclusion: new Map(),
          schedule: 0,
          samples: new Map(),
          signature: [17, 0x9e37],
        };
        tallies.set(phrase, tally);
      }
      tally.mentions += 1;
      tally.signature = [
        (Math.imul(tally.signature[0], 31) + index) | 0,
        (Math.imul(tally.signature[1], 0x85eb_ca6b) + index * 2_654_435_761) | 0,
      ];
      if (key === null) {
        tally.schedule += 1;
        continue;
      }
      tally.byExclusion.set(key, (tally.byExclusion.get(key) ?? 0) + 1);
      const samples = tally.samples.get(key) ?? [];
      if (samples.length < SAMPLES) {
        samples.push(row.description);
        tally.samples.set(key, samples);
      }
    }
  }

  const proposals: BundleTermProposal[] = [];
  const signatures = new Map<string, string>();
  const withheld: WithheldPhrase[] = [];
  let judgedPhrases = 0;

  for (const [phrase, tally] of tallies) {
    if (tally.mentions < MIN_MENTIONS) continue;
    judgedPhrases += 1;

    // One proposal per phrase: the exclusion it predicts best. A phrase that
    // split its support across two keys is a phrase that predicts neither, and
    // proposing it twice would present that as two arguments.
    let best: { key: ExclusionKey; support: number; precision: number } | null = null;
    for (const [key, support] of tally.byExclusion) {
      if (support < MIN_SUPPORT) continue;
      const precision = shrink(support, tally.mentions, baseRates[key]);
      if (best === null || precision > best.precision) best = { key, support, precision };
    }
    if (best === null || best.precision < PROPOSE_PRECISION) continue;
    const chosen = best;

    // Already said. The test is the detector's own, asked of the phrase rather
    // than of a description, so "software licence" is recognised as covered by
    // "software" without a second opinion about what covering means.
    if (
      BUNDLE_TERMS.some((term) => term.exclusionKey === chosen.key && mentions(phrase, term.match))
    )
      continue;

    const collision = INCLUDED_TERMS.find(
      (included) => mentions(phrase, included) || mentions(included, phrase),
    );
    if (collision !== undefined) {
      withheld.push({
        phrase,
        exclusionKey: chosen.key,
        mentions: tally.mentions,
        support: chosen.support,
        precision: chosen.precision,
        collidesWith: collision,
        reason:
          `"${collision}" is a cost that stays in the reported figure. Adding this phrase would ` +
          `tell a preparer to strip it, which understates a sworn return — the error this ` +
          `advisor exists to prevent. A narrower wording would carry the same signal safely.`,
      });
      continue;
    }

    const rule = RULES.get(chosen.key);
    if (!rule) continue;
    proposals.push({
      phrase,
      exclusionKey: chosen.key,
      label: rule.label,
      mentions: tally.mentions,
      support: chosen.support,
      contradicting: tally.schedule,
      precision: chosen.precision,
      baseRate: baseRates[chosen.key],
      samples: tally.samples.get(chosen.key) ?? [],
      alternates: [],
      source: sourceLine(phrase, chosen.key),
      basis: rule.description,
    });
    signatures.set(`${chosen.key}:${phrase}`, signatureKey(tally.signature));
  }

  const collapsed = collapse(proposals, signatures);
  collapsed.sort((a, b) => b.support - a.support || b.precision - a.precision);
  withheld.sort((a, b) => b.support - a.support);

  const { challenges, unobserved } = gradeExistingTerms(rows, baseRates);

  return {
    observations: rows.length,
    exclusionObservations: exclusionRows.length,
    judgedPhrases,
    proposals: collapsed,
    challenges,
    withheld,
    unobserved,
    baseRates,
  };
}

/**
 * Fold proposals that fired on exactly the same rows into one.
 *
 * The representative is the shortest wording, ties broken alphabetically so the
 * same record always produces the same list. Shortest because a shorter phrase
 * is the more general matcher — "maintenance" also finds "maintenance
 * agreement", where "annual maintenance" finds neither — and because there is
 * no evidence-based way to choose, which is precisely what `alternates` is
 * there to admit. It is a tie-break, not a verdict.
 */
function collapse(
  proposals: readonly BundleTermProposal[],
  signatures: ReadonlyMap<string, string>,
): BundleTermProposal[] {
  const groups = new Map<string, BundleTermProposal[]>();
  for (const proposal of proposals) {
    const signature = signatures.get(`${proposal.exclusionKey}:${proposal.phrase}`);
    const key = `${proposal.exclusionKey}:${signature}`;
    const group = groups.get(key);
    if (group) group.push(proposal);
    else groups.set(key, [proposal]);
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(
      (a, b) => a.phrase.length - b.phrase.length || a.phrase.localeCompare(b.phrase),
    );
    const chosen = ordered[0]!;
    return {
      ...chosen,
      alternates: ordered.slice(1).map((row) => row.phrase),
      source: sourceLine(chosen.phrase, chosen.exclusionKey),
    };
  });
}

function sourceLine(phrase: string, exclusionKey: ExclusionKey): string {
  return `{ match: '${phrase.replace(/'/g, "\\'")}', exclusionKey: '${exclusionKey}' },`;
}

/**
 * Hold every hand-written term up against the record.
 *
 * A second pass rather than a lookup in the phrase table above, because the
 * table only holds phrases of one and two words and only counts exclusions —
 * and a challenge has to say what the wordings were settled as *instead*, which
 * means the full category, not the three exclusions. Twenty-seven terms over a
 * few thousand rows is cheap; keeping a full category histogram against every
 * phrase in the corpus would not be.
 */
function gradeExistingTerms(
  rows: readonly SettledDescription[],
  baseRates: Record<ExclusionKey, number>,
): { challenges: BundleTermChallenge[]; unobserved: string[] } {
  const challenges: BundleTermChallenge[] = [];
  const unobserved: string[] = [];

  for (const term of BUNDLE_TERMS) {
    let seen = 0;
    let support = 0;
    let schedule = 0;
    const others = new Map<string, number>();
    const samples: string[] = [];

    for (const row of rows) {
      if (!mentions(row.description, term.match)) continue;
      seen += 1;
      if (row.categoryKey === term.exclusionKey) {
        support += 1;
        continue;
      }
      // Samples are drawn only from the rows that went the other way. A
      // challenge is an argument that this term is mostly noise here, and the
      // wordings worth reading are the ones it was noise on.
      if (!EXCLUSIONS.has(row.categoryKey)) schedule += 1;
      others.set(row.categoryKey, (others.get(row.categoryKey) ?? 0) + 1);
      if (samples.length < SAMPLES) samples.push(row.description);
    }

    if (seen === 0) {
      unobserved.push(term.match);
      continue;
    }
    if (seen < MIN_MENTIONS) continue;

    const precision = shrink(support, seen, baseRates[term.exclusionKey]);
    if (precision > CHALLENGE_PRECISION) continue;

    const settledAs = [...others]
      .map(([categoryKey, count]) => ({ categoryKey, count }))
      .sort((a, b) => b.count - a.count);
    const rule = RULES.get(term.exclusionKey);
    challenges.push({
      phrase: term.match,
      exclusionKey: term.exclusionKey,
      label: rule?.label ?? term.exclusionKey,
      mentions: seen,
      support,
      contradicting: schedule,
      precision,
      settledAs,
      samples,
      basis:
        `Of the ${seen} settled wordings containing "${term.match}", ${support} were settled as ` +
        `${rule?.label ?? term.exclusionKey}. The signal is still true — the wording is there — ` +
        `but on this firm's registers it is mostly asking about property that turned out to be ` +
        `taxable.`,
    });
  }

  challenges.sort((a, b) => a.precision - b.precision || b.mentions - a.mentions);
  return { challenges, unobserved };
}

/** Toward "this phrase means nothing", which is how often the answer is that anyway. */
function shrink(support: number, mentions_: number, baseRate: number): number {
  return (support + PRIOR_STRENGTH * baseRate) / (mentions_ + PRIOR_STRENGTH);
}

/**
 * The one- and two-word phrases a description offers.
 *
 * Folded the way `fingerprint` folds, and for the same reasons: case and
 * punctuation never distinguish two kinds of property, bare numbers are
 * quantities, and serial-shaped tokens are unique by construction and would
 * fill the table with phrases that can never recur.
 *
 * One and two words only; three-word phrases need a corpus nobody has yet.
 * Bigrams come from tokens that were adjacent *in the original text*, and a
 * bigram whose either half is a stopword is dropped rather than bridged. That
 * costs a few real phrases — "data of migration" never becomes "data
 * migration" — and buys the property that matters: every phrase this returns is
 * a phrase `mentions()` can find again. A proposal the detector could not match
 * would be worse than no proposal, because it would look like it worked.
 */
function phrasesIn(description: string): Set<string> {
  const tokens = description
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !isSerialShaped(token));

  const phrases = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!STOPWORDS.has(token)) phrases.add(token);
    const next = tokens[index + 1];
    if (next === undefined) continue;
    if (STOPWORDS.has(token) || STOPWORDS.has(next)) continue;
    phrases.add(`${token} ${next}`);
  }
  return phrases;
}

/** Long, and mixing letters with digits: an identifier rather than a word. */
function isSerialShaped(token: string): boolean {
  return token.length >= 6 && /\d/.test(token) && /[a-z]/.test(token);
}
