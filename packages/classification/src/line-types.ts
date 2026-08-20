import type { ClassificationStatus, LineMappingSource, RenditionScheduleKey } from '@tangible/types';
import { MIXED_LINE_KEY } from '@tangible/types';
import { fingerprint } from './fingerprint.js';
import {
  CLASSIFICATION_KEYS,
  classificationLabel,
  isExclusion,
  isKnownClassification,
} from './vocabulary.js';

/**
 * Reading the filer's own words back into our vocabulary.
 *
 * A rendition arrives written in whatever the client's controller calls things
 * — "Mach & Equip", "Telephone / Network Equipment", "F F & E". Extraction
 * stores that verbatim and deliberately decides nothing, because the decision is
 * worth money and has to be arguable. This module is the decision.
 *
 * It is the same shape as classifying an asset and shares the same memory table,
 * with three differences that are the whole reason it is its own module:
 *
 *   1. **The schedule letter decides most of it, for free.** Schedule D is
 *      licensed vehicles because Form 50-144 says Schedule D is licensed
 *      vehicles. Four of the six schedules never reach a model and never reach a
 *      reviewer, and treating that as a judgement call would be theatre.
 *   2. **A line is a bucket, not a thing.** "Furniture, Fixtures & Equipment" is
 *      three of our categories in one printed number, and nothing can split it.
 *      That answer has a name — {@link MIXED_LINE_KEY} — instead of being forced
 *      into whichever category the wording leans toward.
 *   3. **The stakes are different in kind.** A wrong asset class reaches a form
 *      signed under penalty of perjury. A wrong line mapping reaches a *finding*
 *      — it puts a dollar number in front of a client and says their filing was
 *      wrong. Less final, equally expensive to get wrong, and wrong in a way
 *      that is much harder to notice, because the mapping is upstream of every
 *      number it produces.
 */

// ---------------------------------------------------------------------------
// What the form itself settles
// ---------------------------------------------------------------------------

interface ScheduleRule {
  categoryKey: string;
  /** Why the letter alone is enough, phrased for the person who asks. */
  because: string;
}

/**
 * Schedules whose meaning is fixed by the form, not by the words on the line.
 *
 * Schedule E is absent on purpose: it is furniture, fixtures, machinery,
 * equipment and computers all at once, which is four of our categories and the
 * only place the wording actually has to be read. Schedule A is absent for the
 * opposite reason — it is a single lump for accounts under $20,000, with no
 * breakdown required, so what it means depends entirely on what the filer
 * chose to write in the box.
 */
const SCHEDULE_RULES: Partial<Record<RenditionScheduleKey, ScheduleRule>> = {
  B: {
    categoryKey: 'inventory',
    because:
      'Schedule B is inventory by the form’s own definition, and inventory is rendered at full cost with no depreciation.',
  },
  C: {
    categoryKey: 'inventory',
    because:
      'Schedule C is supplies on hand, which the district values the same way as inventory — full cost, no schedule, no index.',
  },
  D: {
    categoryKey: 'vehicles',
    because:
      'Schedule D is licensed vehicles by the form’s own definition. Harris carries them on a separate account and values them from Info Nation where a match exists.',
  },
  F: {
    categoryKey: 'excluded-leased-in',
    because:
      'Schedule F is property leased or consigned *from* others. The lessor renders it; it is disclosed here rather than valued, so it is not part of what this client owes and not comparable against an owned-asset register.',
  },
};

/** Schedules where the words on the line are the only thing that can decide. */
export const WORDING_SCHEDULES: readonly RenditionScheduleKey[] = ['A', 'E'];

export function scheduleDecides(schedule: RenditionScheduleKey): boolean {
  return schedule in SCHEDULE_RULES;
}

// ---------------------------------------------------------------------------
// The answer set
// ---------------------------------------------------------------------------

/**
 * Every key a line mapping may carry, as a literal tuple for structured output.
 *
 * The asset vocabulary plus `mixed`. Exclusions are in here because a filer
 * genuinely does render software licences and leased copiers on Schedule E —
 * that is one of the most valuable things this mapping can find, and a
 * vocabulary that could not say it would bury the finding.
 */
export const LINE_MAPPING_KEYS = [...CLASSIFICATION_KEYS, MIXED_LINE_KEY] as const;

export type LineMappingKey = (typeof LINE_MAPPING_KEYS)[number];

export function isMixed(key: string | null | undefined): boolean {
  return key === MIXED_LINE_KEY;
}

export function isKnownLineMapping(key: string | null | undefined): key is string {
  return isMixed(key) || isKnownClassification(key);
}

export function lineMappingLabel(key: string): string {
  return isMixed(key) ? 'Blended — cannot be split' : classificationLabel(key);
}

// ---------------------------------------------------------------------------
// The memory key
// ---------------------------------------------------------------------------

/**
 * Fold a line's wording into a memory key, namespaced by schedule.
 *
 * The schedule belongs in the key because it changes the meaning of identical
 * words: "Equipment" on Schedule D is a licensed vehicle and on Schedule E is a
 * machine. Replaying one as the other is exactly the silent, money-carrying
 * error the asset fingerprint is written to avoid.
 *
 * The namespace also keeps these rows out of the asset classifier's reach, and
 * provably so rather than by convention: `fingerprint` maps everything outside
 * `[a-z0-9]` to a space, so no asset description can ever fold to a key
 * containing a colon. The two vocabularies share a table and cannot collide.
 */
export function lineTypeFingerprint(
  schedule: RenditionScheduleKey,
  type: string | null | undefined,
): string | null {
  const folded = fingerprint(type);
  return folded ? `rendition:${schedule}:${folded}` : null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface LineMapping {
  categoryKey: string | null;
  confidence: number;
  rationale: string;
  source: LineMappingSource;
  status: ClassificationStatus;
  fingerprint: string | null;
}

/** What the model returns for one distinct piece of wording. */
export interface LineAnswer {
  categoryKey: string | null;
  confidence: number;
  rationale: string;
}

/** A prior human decision about this wording, as `classification_memory` holds it. */
export interface LineMemoryRecord {
  fingerprint: string;
  categoryKey: string;
  confirmations: number;
  conflicted: boolean;
  conflictingCategoryKey: string | null;
  lastConfirmedAt: Date;
}

/**
 * The bar a model answer has to clear.
 *
 * The same 0.85 as asset classification, for a different reason. There, the cost
 * of being wrong is a wrong figure on a sworn form. Here it is a wrong figure in
 * a finding — we tell a client they misfiled, with a dollar amount, on the
 * strength of a guess about what their own words meant. That is the claim this
 * product is selling, so it does not get a lower bar than the form does.
 */
export const AUTO_ACCEPT_CONFIDENCE = 0.85;

const onDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The form's own answer. Full confidence and no review, because there is nothing
 * for a reviewer to weigh: the letter at the top of the schedule is the
 * taxpayer's statement about what kind of property is below it.
 */
export function mapFromSchedule(
  schedule: RenditionScheduleKey,
  fingerprintKey: string | null,
): LineMapping | null {
  const rule = SCHEDULE_RULES[schedule];
  if (!rule) return null;
  return {
    categoryKey: rule.categoryKey,
    confidence: 1,
    rationale: rule.because,
    source: 'schedule',
    status: 'auto-accepted',
    fingerprint: fingerprintKey,
  };
}

/**
 * A reviewer's earlier decision about these exact words, replayed — including
 * from a different client, which is where most of the value is. Controllers in
 * one industry write their schedules the same way, and the tenth machine shop
 * should cost nothing to map.
 *
 * A conflicted memory goes to a person carrying both answers, on the same
 * reasoning as the asset path: two reviewers disagreeing about wording usually
 * means the wording is genuinely ambiguous, and "Equipment" is the case this
 * catches.
 */
export function mapFromMemory(memory: LineMemoryRecord): LineMapping {
  if (!isKnownLineMapping(memory.categoryKey)) {
    return {
      categoryKey: null,
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
      confidence: 0.5,
      rationale:
        `Reviewers have read this wording two different ways — ${lineMappingLabel(memory.categoryKey)}` +
        (other ? ` and ${lineMappingLabel(other)}` : '') +
        `. The newer reading is shown; it will not apply itself until someone settles the disagreement.`,
      source: 'memory',
      status: 'needs-review',
      fingerprint: memory.fingerprint,
    };
  }

  const times = memory.confirmations === 1 ? 'once' : `${memory.confirmations} times`;
  return {
    categoryKey: memory.categoryKey,
    confidence: 1,
    rationale: `A reviewer read this wording as ${lineMappingLabel(memory.categoryKey)} — confirmed ${times}, most recently ${onDate(memory.lastConfirmedAt)}.`,
    source: 'memory',
    status: 'auto-accepted',
    fingerprint: memory.fingerprint,
  };
}

/**
 * A model answer, held to the bar.
 *
 * Two answers never stand on their own however confident the model is:
 *
 *   - **An exclusion.** "They rendered leased-in equipment" and "they rendered a
 *     software licence" are claims that cost comes off the return, and they are
 *     the most valuable thing this can say. A person signs for that, exactly as
 *     they do on the asset side.
 *
 * And one answer stands *despite* being a refusal:
 *
 *   - **{@link MIXED_LINE_KEY}.** There is nothing a reviewer can do with a
 *     blended line that the form printed as a single number — the split does not
 *     exist to be found. Queueing it would be asking a person to invent
 *     precision. It is auto-accepted and then carried through every rollup as
 *     unplaceable cost, which is the honest reporting of it.
 */
export function mapFromAi(answer: LineAnswer, fingerprintKey: string | null): LineMapping {
  const confidence = Math.min(1, Math.max(0, answer.confidence));

  if (!isKnownLineMapping(answer.categoryKey)) {
    return {
      categoryKey: null,
      confidence: 0,
      rationale:
        answer.rationale || 'The model could not say what this wording refers to.',
      source: 'ai',
      status: 'needs-review',
      fingerprint: fingerprintKey,
    };
  }

  const status: ClassificationStatus = isExclusion(answer.categoryKey)
    ? 'needs-review'
    : confidence >= AUTO_ACCEPT_CONFIDENCE
      ? 'auto-accepted'
      : 'needs-review';

  return {
    categoryKey: answer.categoryKey,
    confidence,
    rationale: answer.rationale,
    source: 'ai',
    status,
    fingerprint: fingerprintKey,
  };
}

/** No wording to read at all — a blank type on a line that still carries money. */
export function mapUnmappable(reason: string, fingerprintKey: string | null = null): LineMapping {
  return {
    categoryKey: null,
    confidence: 0,
    rationale: reason,
    source: 'ai',
    status: 'needs-review',
    fingerprint: fingerprintKey,
  };
}

/** A reviewer's reading, which is final. */
export function mapFromHuman(
  categoryKey: string,
  fingerprintKey: string | null,
  rationale: string | null,
): LineMapping {
  return {
    categoryKey,
    confidence: 1,
    rationale: rationale ?? `Read as ${lineMappingLabel(categoryKey)} by a reviewer.`,
    source: 'human',
    status: 'confirmed',
    fingerprint: fingerprintKey,
  };
}

/**
 * Whether a mapping is solid enough to compare against.
 *
 * Anything queued is out, and so is `mixed` — not because it is unreliable but
 * because it names a category that does not exist on our side. Both are counted
 * as unplaceable rather than dropped, so the reported total a comparison starts
 * from always reconciles back to the total the form printed.
 */
export function isComparable(mapping: {
  categoryKey: string | null;
  status: ClassificationStatus;
}): boolean {
  return (
    mapping.categoryKey !== null &&
    !isMixed(mapping.categoryKey) &&
    mapping.status !== 'needs-review'
  );
}
