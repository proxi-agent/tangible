import type {
  EngineChange,
  EngineChangeWeight,
  EngineDigest,
  EngineFact,
  EngineFactKind,
} from '@tangible/types';

/**
 * What the engine learned since the last time anybody looked.
 *
 * Every learner in this system is *pull*. The acceptance rates, the signal
 * lifts, the bundle vocabulary, the classifier's agreement — each is computed
 * from scratch when somebody opens a board, and nothing anywhere tells a person
 * that a number moved. So the fifth closed position that carries a finding over
 * `MIN_OBSERVATIONS` changes what the report multiplies by, silently, in March,
 * and the firm discovers it in August by opening a screen for an unrelated
 * reason. The learning was real and nobody was told.
 *
 * This file is the telling. It takes two readings of the same engine — one now,
 * one as of a date — and says what is different in the vocabulary the learners
 * themselves use.
 *
 * ## Why this is the shape self-sufficiency is allowed to take here
 *
 * The obvious version of "an agent that improves itself" writes its own rules
 * to a table and applies them. This repo refuses that, in `rule-drafts.ts`, for
 * a reason that has not weakened: a schedule an agent can write means a client's
 * assessed value can move between two runs with no diff to read and nobody's
 * name against it. Every learner here emits pasteable source and stops.
 *
 * What was missing was not the authority to act. It was the *noticing*. A
 * system that computes a crossing and never mentions it is not being careful,
 * it is being quiet, and quiet is what this file removes. Nothing below applies
 * anything, proposes a code change, or writes a rule. It reads two states and
 * produces sentences.
 *
 * ## The window is the memory
 *
 * There is no snapshot table, and the absence is deliberate twice over.
 *
 * A stored snapshot drifts from the record. Voiding a claim retroactively
 * removes an outcome the model was trained on, and a snapshot would go on
 * asserting the number that outcome produced — so the digest would report a
 * change that the database no longer contains. Recomputing the earlier state
 * from the same rows, filtered by when the firm wrote each one down, can never
 * disagree with itself that way.
 *
 * And a digest run weekly over a seven-day window needs no de-duplication: a
 * crossing that happened on Tuesday appears in exactly one window, because the
 * next one begins after it. The clock does the work a `last_reported_at` column
 * would have done.
 *
 * The honest cost: a run that does not happen loses its window. A crossing in a
 * week the cron was down is never mailed. The screen answers the same question
 * for any window on demand, so the recovery is to widen it and look — which is
 * why the window is a parameter and not a constant.
 *
 * ## Why an `EngineFact` and not the learners' own types
 *
 * This module would otherwise have to depend on `@tangible/savings` and
 * `@tangible/classification` and know the shape of an `AcceptanceEvidence`, a
 * `SignalLift` and a `BundleTermProposal` — three vocabularies whose only
 * common structure is the one `EngineFact` writes down: a thing with an
 * identity, a bar it has or has not cleared, a number, and how much evidence
 * is behind it. The reduction happens at the edge, in `engine-digest.ts`,
 * where each learner's own words are still to hand. What crosses into this
 * file is a fact, and every sentence below is written about facts.
 *
 * ## What is deliberately not a fact here
 *
 * The gate. `runGate` reads committed goldens and today's date; it does not
 * read the database, so its answer is identical in both readings and a diff of
 * it would always be empty. A gate that breaks breaks the `test` job, which is
 * a louder channel than a weekly mail and a blocking one.
 */

/**
 * How far a number moves before the movement is worth a sentence.
 *
 * Five points on a 0–1 rate. Below that an acceptance rate wobbles on a single
 * partial allowance, and a digest that reported the wobble would teach the firm
 * to close it unread — which is the failure mode that matters, because the same
 * mail is the one carrying the crossing three weeks later.
 */
export const MOVE_THRESHOLD = 0.05;

/**
 * How much the evidence behind an unchanged fact must grow before it is said.
 *
 * Half again. A fact that gained one observation out of forty has not learned
 * anything a person needs to know; one that went from four to seven is three
 * outcomes from being used, and that is the sentence worth having.
 */
export const FIRM_FACTOR = 1.5;

const WEIGHT_ORDER: Record<EngineChangeWeight, number> = { act: 0, read: 1, note: 2 };

/**
 * What clearing a bar means, which is not the same in both halves of the engine.
 *
 * An acceptance rate that reaches `MIN_OBSERVATIONS` starts being multiplied
 * into a client's number by itself, with nobody's permission and no diff. A
 * bundle phrase that reaches its precision bar starts being *proposed*, and
 * applies only once somebody commits it to a file. Those are opposite facts
 * about the software and identical facts about the firm's attention: both are
 * worth an interruption, and neither can be said in the other's words.
 *
 * So the verb comes off the kind, and there is no default. A sixth kind added
 * to `EngineFactKind` without a line here fails the typecheck, which is the
 * only reliable way to make somebody decide what its crossing means.
 */
const VERBS: Record<EngineFactKind, { crossed: string; withdrawn: string }> = {
  acceptance: { crossed: 'is now in use', withdrawn: 'has stopped being used' },
  signal: { crossed: 'is now in use', withdrawn: 'has stopped being used' },
  precision: { crossed: 'can now be stated', withdrawn: 'can no longer be stated' },
  classifier: { crossed: 'can now be stated', withdrawn: 'can no longer be stated' },
  'bundle-term': {
    crossed: 'now clears the bar and is waiting for somebody to commit it',
    withdrawn: 'no longer clears the bar',
  },
  'bundle-challenge': {
    crossed: 'is now contradicted by the record',
    withdrawn: 'is no longer contradicted by the record',
  },
};

/**
 * Compare two readings of the engine.
 *
 * `before` may legitimately be empty — a firm in its first month has no earlier
 * state — and everything then reads as `appeared`. That is correct rather than
 * noisy: the first week a rate exists is the week to say it exists. What keeps
 * it from being a wall of text is the weighting, which sends only the in-force
 * ones to the mail.
 */
export function diffEngineFacts(
  before: readonly EngineFact[],
  after: readonly EngineFact[],
  window: { since: string; until: string },
): EngineDigest {
  const priorById = new Map(before.map((fact) => [fact.id, fact]));
  const changes: EngineChange[] = [];

  for (const fact of after) {
    const prior = priorById.get(fact.id);
    const change = compare(prior, fact);
    if (change) changes.push(change);
  }

  /**
   * A fact that existed and no longer does. Not the same as `withdrawn`: the
   * rate did not stop being publishable, the *subject* left the corpus. It
   * happens when the last observation behind a finding is voided, and it is
   * worth saying because the report silently returned to the built-in constant.
   */
  const currentIds = new Set(after.map((fact) => fact.id));
  for (const fact of before) {
    if (currentIds.has(fact.id)) continue;
    changes.push({
      kind: 'withdrawn',
      weight: fact.inForce ? 'act' : 'note',
      fact: { ...fact, inForce: false, value: null, observations: 0 },
      before: { inForce: fact.inForce, value: fact.value, observations: fact.observations },
      headline: fact.inForce
        ? `${fact.subject} has left the record entirely, so it ${VERBS[fact.kind]!.withdrawn}.`
        : `${fact.subject} has left the record.`,
    });
  }

  changes.sort(
    (a, b) =>
      WEIGHT_ORDER[a.weight]! - WEIGHT_ORDER[b.weight]! ||
      b.fact.observations - a.fact.observations ||
      a.fact.id.localeCompare(b.fact.id),
  );

  return {
    since: window.since,
    until: window.until,
    facts: after.length,
    inForce: after.filter((fact) => fact.inForce).length,
    changes,
    material: changes.some((change) => change.weight !== 'note'),
  };
}

function compare(prior: EngineFact | undefined, fact: EngineFact): EngineChange | null {
  if (!prior) {
    return {
      kind: 'appeared',
      weight: fact.inForce ? 'read' : 'note',
      fact,
      before: null,
      headline: fact.inForce
        ? `${fact.subject} is new and already ${VERBS[fact.kind]!.crossed} — ${describe(fact)}.`
        : `${fact.subject} is new: ${describe(fact)}.`,
    };
  }

  const was = { inForce: prior.inForce, value: prior.value, observations: prior.observations };

  if (!prior.inForce && fact.inForce) {
    return {
      kind: 'crossed',
      weight: 'act',
      fact,
      before: was,
      headline: `${fact.subject} ${VERBS[fact.kind]!.crossed} — ${describe(fact)}, up from ${prior.observations} observations.`,
    };
  }

  if (prior.inForce && !fact.inForce) {
    return {
      kind: 'withdrawn',
      weight: 'act',
      fact,
      before: was,
      headline: `${fact.subject} ${VERBS[fact.kind]!.withdrawn} — ${describe(fact)}, where it had ${prior.observations} observations.`,
    };
  }

  const moved =
    prior.value !== null &&
    fact.value !== null &&
    Math.abs(fact.value - prior.value) >= MOVE_THRESHOLD;
  if (moved) {
    return {
      kind: 'moved',
      weight: fact.inForce ? 'read' : 'note',
      fact,
      before: was,
      headline: `${fact.subject} moved from ${number(prior.value)} to ${number(fact.value)} on ${fact.observations} observations.`,
    };
  }

  if (prior.observations > 0 && fact.observations >= prior.observations * FIRM_FACTOR) {
    return {
      kind: 'firmed',
      weight: 'note',
      fact,
      before: was,
      headline: `${fact.subject} now rests on ${fact.observations} observations, up from ${prior.observations}. ${fact.inForce ? 'Same answer, better founded.' : 'Still short of the bar.'}`,
    };
  }

  return null;
}

function describe(fact: EngineFact): string {
  const value = fact.value === null ? 'no number yet' : number(fact.value);
  return `${value} on ${fact.observations} observation${fact.observations === 1 ? '' : 's'}`;
}

/** Two decimals, and never a percent sign: not every value here is a rate. */
function number(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(2);
}

/**
 * The digest as a plain-text mail.
 *
 * `note` changes are omitted rather than listed at the bottom. They are on the
 * screen, and the whole argument for sending anything is that what arrives is
 * what somebody would have wanted to be interrupted for.
 */
export function renderDigest(digest: EngineDigest, url: string): string {
  const worth = digest.changes.filter((change) => change.weight !== 'note');
  const lines: string[] = [
    `What the engine learned between ${day(digest.since)} and ${day(digest.until)}.`,
    '',
  ];

  const acted = worth.filter((change) => change.weight === 'act');
  const read = worth.filter((change) => change.weight === 'read');

  if (acted.length > 0) {
    lines.push('CHANGES WHAT THE SOFTWARE DOES', '');
    for (const change of acted)
      lines.push(`  · ${change.headline}`, `    ${change.fact.basis}`, '');
  }
  if (read.length > 0) {
    lines.push('WORTH KNOWING', '');
    for (const change of read) lines.push(`  · ${change.headline}`, '');
  }

  lines.push(
    `${digest.inForce} of ${digest.facts} learned facts are in use.`,
    '',
    `${url}/quality`,
    '',
    'Nothing in this mail was applied by anything other than the rules already',
    'in the code. Proposals need somebody to commit them.',
  );
  return lines.join('\n');
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
