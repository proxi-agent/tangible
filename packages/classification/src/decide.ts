import type { ClassificationSource, ClassificationStatus } from '@tangible/types';
import { classificationLabel, isExclusion, isKnownClassification } from './vocabulary.js';

/**
 * Turning an answer into a decision: what gets applied, and what gets a person.
 *
 * Every path through the engine ends here, so the rule about when a machine's
 * answer stands unreviewed lives in exactly one place, is testable without a
 * database or an API key, and reads the same way to the person who has to
 * defend a rendition.
 */

/**
 * Above this, a model answer stands on its own; below it, the asset is queued.
 *
 * The number is set by what an error costs on each side. A wrong class does not
 * produce a wrong-looking number — it produces a confident, plausible one, on a
 * form that is signed under penalty of perjury and that the district will not
 * re-derive. A needless review costs a reviewer four seconds. So the bar sits
 * high, and everything the model is not clearly sure about gets a person.
 */
export const AUTO_ACCEPT_CONFIDENCE = 0.85;

export interface Decision {
  categoryKey: string | null;
  lifeClassOverride: number | null;
  confidence: number;
  rationale: string;
  source: ClassificationSource;
  status: ClassificationStatus;
  fingerprint: string | null;
}

/** A prior human decision, as `classification_memory` stores it. */
export interface MemoryRecord {
  fingerprint: string;
  categoryKey: string;
  lifeClassOverride: number | null;
  confirmations: number;
  conflicted: boolean;
  conflictingCategoryKey: string | null;
  lastConfirmedAt: Date;
}

/** What the model returns for one distinct description. */
export interface AiAnswer {
  categoryKey: string | null;
  lifeClassOverride: number | null;
  confidence: number;
  rationale: string;
}

const label = classificationLabel;

const onDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * A memory hit is a person's decision about this exact text, replayed. It
 * carries full confidence for that reason — not because the machine is sure,
 * but because a human already was — and `source: 'memory'` is what tells a
 * reader which of those two things they are looking at.
 *
 * Unless the memory is conflicted. Two reviewers who settled the same text
 * differently is a signal, not noise: it usually means the description is
 * genuinely ambiguous out of context ("Rack", "Unit 3", "System"), which is
 * exactly the case where replaying somebody's answer would be worst. Those go
 * to a person, carrying both prior answers so the person can see the argument.
 */
export function decideFromMemory(memory: MemoryRecord): Decision {
  if (!isKnownClassification(memory.categoryKey)) {
    return {
      categoryKey: null,
      lifeClassOverride: null,
      confidence: 0,
      rationale: `A remembered decision named category "${memory.categoryKey}", which this jurisdiction no longer publishes.`,
      source: 'memory',
      status: 'needs-review',
      fingerprint: memory.fingerprint,
    };
  }

  if (memory.conflicted) {
    const other = memory.conflictingCategoryKey;
    return {
      categoryKey: memory.categoryKey,
      lifeClassOverride: memory.lifeClassOverride,
      confidence: 0.5,
      rationale:
        `Reviewers have settled this description two different ways — ${label(memory.categoryKey)}` +
        (other ? ` and ${label(other)}` : '') +
        `. The newer answer is shown; it will not apply itself until someone settles the disagreement.`,
      source: 'memory',
      status: 'needs-review',
      fingerprint: memory.fingerprint,
    };
  }

  const times = memory.confirmations === 1 ? 'once' : `${memory.confirmations} times`;
  return {
    categoryKey: memory.categoryKey,
    lifeClassOverride: memory.lifeClassOverride,
    confidence: 1,
    rationale: `A reviewer classified this exact description as ${label(memory.categoryKey)} — confirmed ${times}, most recently ${onDate(memory.lastConfirmedAt)}.`,
    source: 'memory',
    status: 'auto-accepted',
    fingerprint: memory.fingerprint,
  };
}

/**
 * A model answer, held to the bar. Note what is *not* here: no floor on
 * confidence, no rounding up, no second-guessing a low number into a high one.
 * If the model says it is unsure, the queue is the answer.
 */
export function decideFromAi(answer: AiAnswer, fingerprint: string | null): Decision {
  const confidence = Math.min(1, Math.max(0, answer.confidence));

  if (!isKnownClassification(answer.categoryKey)) {
    return {
      categoryKey: null,
      lifeClassOverride: null,
      confidence: 0,
      rationale:
        answer.rationale || 'The model declined to place this asset in any published category.',
      source: 'ai',
      status: 'needs-review',
      fingerprint,
    };
  }

  // An exclusion is not a classification, it is a position: this asset should
  // not be on the rendition at all. It is also the most valuable thing the
  // engine can say, which is exactly why no confidence score is enough on its
  // own. A person signs for taking cost off a sworn form.
  const status: ClassificationStatus = isExclusion(answer.categoryKey)
    ? 'needs-review'
    : confidence >= AUTO_ACCEPT_CONFIDENCE
      ? 'auto-accepted'
      : 'needs-review';

  return {
    categoryKey: answer.categoryKey,
    lifeClassOverride: answer.lifeClassOverride,
    confidence,
    rationale: answer.rationale,
    source: 'ai',
    status,
    fingerprint,
  };
}

/**
 * An asset with no description, no register category, and no GL account. There
 * is no honest answer, so it gets a null class and a sentence saying why —
 * which is a finding in itself: a register that cannot describe its own assets
 * is one the district has been valuing off nothing too.
 */
export function decideUnclassifiable(reason: string): Decision {
  return {
    categoryKey: null,
    lifeClassOverride: null,
    confidence: 0,
    rationale: reason,
    source: 'ai',
    status: 'needs-review',
    fingerprint: null,
  };
}

/** A reviewer's decision, which is final by definition. */
export function decideFromHuman(
  categoryKey: string,
  lifeClassOverride: number | null,
  fingerprint: string | null,
  rationale: string | null,
): Decision {
  return {
    categoryKey,
    lifeClassOverride,
    confidence: 1,
    rationale: rationale ?? `Classified as ${label(categoryKey)} by a reviewer.`,
    source: 'human',
    status: 'confirmed',
    fingerprint,
  };
}

/**
 * Whether a decision is solid enough to price against. Anything queued for a
 * person is excluded from the valuation totals rather than quietly counted at
 * whatever the machine guessed — a savings number built on unreviewed guesses
 * is the one number this product cannot afford to get wrong.
 */
export function isValuable(decision: {
  categoryKey: string | null;
  status: ClassificationStatus;
}): boolean {
  return decision.categoryKey !== null && decision.status !== 'needs-review';
}
