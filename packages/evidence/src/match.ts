import type { EvidenceSourceKind } from './sources.js';
import { EVIDENCE_SOURCES, sourceCovers } from './sources.js';

/**
 * Matching a register row against an external system, and saying how.
 *
 * The method is not metadata. A serial-number match and a description match are
 * different kinds of fact, and a finding that leans on one while presenting it
 * as the other is the finding that falls apart in front of an assessor. So every
 * match carries the method that produced it, the strength that method is worth,
 * and the text on both sides that a reviewer can read to check it.
 *
 * The methods are ordered, and the order is the whole matcher: the first method
 * that produces a match wins, and a weaker method never overrides a stronger one
 * on the same row. That means a register row with a serial number is matched on
 * its serial number even when three descriptions look closer, because a serial
 * number is an identifier and a description is a guess about one.
 *
 * Nothing here is fuzzy in the machine-learning sense. Every method is a rule a
 * person can restate: same tag, same serial, same model and cost, same words. A
 * probability nobody can explain is worse than no evidence, because it is
 * evidence the firm cannot defend and will not withdraw.
 */

export type MatchMethod = 'asset-tag' | 'serial' | 'model-and-cost' | 'description' | 'none';

/**
 * What each method is worth, before anything about the particular row is known.
 *
 * These are the strengths of the *identifiers*, not of the conclusion. A serial
 * number is unique by construction and a description is not, and that gap is
 * wider than any tuning would close. The description score deliberately tops out
 * below the confidence threshold at which a finding can stand alone: a
 * description match is a reason to look, never a reason to file.
 */
const METHOD_SCORE: Readonly<Record<MatchMethod, number>> = {
  'asset-tag': 0.97,
  serial: 0.95,
  'model-and-cost': 0.8,
  description: 0.55,
  none: 0,
};

/** One row as an external system holds it. */
export interface ExternalRecord {
  /** The source's own identifier for this record, for the audit trail. */
  recordId: string;
  assetTag: string | null;
  serial: string | null;
  model: string | null;
  description: string | null;
  /** Cost, where the source carries one. An SOV does; a CMMS usually does not. */
  amount: number | null;
  /**
   * The last date this record proves something happened — a work order closed,
   * a device checked in, a lease payment made. Null where the source is a list
   * rather than a log.
   */
  lastSeenOn: string | null;
}

/** The register side, reduced to what a match can be made on. */
export interface RegisterSubject {
  assetId: string;
  assetTag: string | null;
  serial: string | null;
  model: string | null;
  description: string | null;
  originalCost: number | null;
  categoryKey: string | null;
}

export interface EvidenceMatch {
  source: EvidenceSourceKind;
  method: MatchMethod;
  /** 0–1. The method's own strength, adjusted for what this row supplied. */
  score: number;
  recordId: string;
  /** What was compared, both sides, in the words each system uses. */
  on: string;
  lastSeenOn: string | null;
}

/**
 * A source that covers this asset and found nothing.
 *
 * This is the "no match found in CMMS" statement, and it is a first-class
 * result rather than the absence of one. It carries the source's own sentence
 * about what silence means and how much of the source was searched, because a
 * negative statement over a partial export is not a negative statement — it is
 * a gap, and calling it evidence would be the most damaging thing in this file.
 */
export interface NegativeStatement {
  source: EvidenceSourceKind;
  /** The source's `denies` sentence, which is why a source without one is silent. */
  statement: string;
  /** How many records were searched. A number a reviewer can sanity-check. */
  searched: number;
  score: number;
}

export interface EvidenceResult {
  assetId: string;
  matches: EvidenceMatch[];
  negatives: NegativeStatement[];
  /**
   * Sources that had nothing to say because the asset is outside their scope.
   * Reported so a screen can show "not covered" rather than leaving a reader to
   * infer that a silent source was searched and came back empty.
   */
  silent: EvidenceSourceKind[];
}

/**
 * How thin an export has to be before its silence stops meaning anything.
 *
 * A maintenance system with eleven records in it is not a maintenance system
 * that says a chiller is gone; it is a partial export. The threshold is a
 * judgement and a deliberately blunt one — the alternative was to say nothing
 * about export completeness at all, which is how a firm ends up asserting a
 * negative over a file somebody filtered before sending.
 */
const MIN_RECORDS_FOR_A_NEGATIVE = 25;

const norm = (text: string | null): string =>
  (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Serials and tags compare without punctuation or case; nothing else is stripped. */
const ident = (text: string | null): string => (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Two identifiers are the same identifier, and neither is a placeholder.
 *
 * The emptiness check is the load-bearing half. Registers are full of asset
 * tags recorded as "-", "N/A" and "--", all of which normalize to nothing, and
 * a bare string comparison would call every one of them equal to every other —
 * matching a forklift to a laptop on the strength of two dashes, at the
 * strongest score the matcher can award. Absent is not a value.
 */
function sameIdent(a: string | null, b: string | null): boolean {
  const left = ident(a);
  return left !== '' && left === ident(b);
}

function tokens(text: string | null): Set<string> {
  return new Set(
    norm(text)
      .split(' ')
      .filter((word) => word.length > 2),
  );
}

/**
 * Word overlap, weighted toward the register side.
 *
 * Jaccard would punish a CMMS record whose description carries a location and a
 * work-order type the register never had. What matters is whether the register's
 * words are *in* the external record, so the denominator is the register side.
 */
function overlap(subject: string | null, record: string | null): number {
  const left = tokens(subject);
  if (left.size === 0) return 0;
  const right = tokens(record);
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / left.size;
}

/** Within 2%: the same asset booked at cost and insured at cost, allowing rounding. */
function costAgrees(a: number | null, b: number | null): boolean {
  if (a === null || b === null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.02;
}

/**
 * The best match one source can offer for one asset, or nothing.
 *
 * Returns at most one match per source on purpose. Three work orders against the
 * same pump is one fact — the pump is maintained — and reporting it three times
 * would let a single source outvote every other source in the room.
 */
export function matchOne(
  subject: RegisterSubject,
  source: EvidenceSourceKind,
  records: readonly ExternalRecord[],
): EvidenceMatch | null {
  const attempt = (
    method: MatchMethod,
    hit: (record: ExternalRecord) => boolean,
    on: (record: ExternalRecord) => string,
    scoreFor: (record: ExternalRecord) => number = () => METHOD_SCORE[method],
  ): EvidenceMatch | null => {
    const found = records.find(hit);
    if (!found) return null;
    return {
      source,
      method,
      score: scoreFor(found),
      recordId: found.recordId,
      on: on(found),
      lastSeenOn: found.lastSeenOn,
    };
  };

  // Ordered strongest first, and the order is the matcher. See the module note.
  return (
    (subject.assetTag
      ? attempt(
          'asset-tag',
          (r) => sameIdent(subject.assetTag, r.assetTag),
          (r) => `asset tag ${subject.assetTag} = ${r.assetTag}`,
        )
      : null) ??
    (subject.serial
      ? attempt(
          'serial',
          (r) => sameIdent(subject.serial, r.serial),
          (r) => `serial ${subject.serial} = ${r.serial}`,
        )
      : null) ??
    (subject.model
      ? attempt(
          'model-and-cost',
          (r) =>
            norm(subject.model) !== '' &&
            norm(r.model) === norm(subject.model) &&
            costAgrees(subject.originalCost, r.amount),
          (r) => `model ${subject.model} at a cost the source agrees with (${r.amount})`,
        )
      : null) ??
    attempt(
      'description',
      (r) => overlap(subject.description, r.description) >= 0.6,
      (r) => `description "${subject.description}" against "${r.description}"`,
      // Scaled by how much of the register's wording the record actually
      // carries, so a bare pass sits well below a near-identical description
      // and neither reaches the strength of an identifier.
      (r) =>
        Math.round(METHOD_SCORE.description * overlap(subject.description, r.description) * 100) /
        100,
    )
  );
}

export interface SourceExport {
  kind: EvidenceSourceKind;
  records: readonly ExternalRecord[];
}

/**
 * Every source, for one asset: what matched, what searched and found nothing,
 * and what was never in scope.
 *
 * The three-way split is the product. A screen that shows only matches makes an
 * unmatched asset look unexamined; a screen that shows matches and non-matches
 * makes an out-of-scope asset look suspicious. Only the third bucket keeps both
 * honest.
 */
export function gatherEvidence(
  subject: RegisterSubject,
  exports: readonly SourceExport[],
): EvidenceResult {
  const matches: EvidenceMatch[] = [];
  const negatives: NegativeStatement[] = [];
  const silent: EvidenceSourceKind[] = [];

  for (const source of exports) {
    const profile = EVIDENCE_SOURCES[source.kind];
    if (!sourceCovers(source.kind, subject.categoryKey)) {
      silent.push(source.kind);
      continue;
    }
    const match = matchOne(subject, source.kind, source.records);
    if (match) {
      matches.push(match);
      continue;
    }
    // Covered, searched, and nothing found. Whether that is evidence depends on
    // the source and on whether the export was substantial enough to trust.
    if (profile.denies === null || source.records.length < MIN_RECORDS_FOR_A_NEGATIVE) {
      silent.push(source.kind);
      continue;
    }
    negatives.push({
      source: source.kind,
      statement: profile.denies,
      searched: source.records.length,
      // A negative is worth less than a positive of the same source, always. An
      // asset can be real and missing from a system; an asset cannot be in a
      // system and not exist.
      score: 0.6,
    });
  }

  return { assetId: subject.assetId, matches, negatives, silent };
}

/**
 * The same matcher, prepared once per source instead of rescanned per asset.
 *
 * `matchOne` is a linear scan, which is the right shape for reading and the
 * wrong shape for a season: a 4,000-row register against a 20,000-row
 * maintenance export is 80 million description comparisons, each one tokenizing
 * two strings. That is minutes of CPU inside a request that has a report
 * waiting on it.
 *
 * The index changes the cost and nothing else. Identifiers become hash lookups.
 * Descriptions get an inverted index on words, which is exact rather than
 * approximate here: the overlap threshold is above zero, so any record that can
 * clear it must share at least one word with the subject, and a record sharing
 * no words could never have matched. Candidates are walked in ascending record
 * order so the record that wins is the same record `matchOne` would have found
 * — the first in the file, not the best. That equivalence is asserted in the
 * tests rather than asserted here, because it is the kind of claim that decays.
 */
export interface SourceIndex {
  kind: EvidenceSourceKind;
  records: readonly ExternalRecord[];
  /** First position per identifier — first in the file wins, as in the scan. */
  byTag: Map<string, number>;
  bySerial: Map<string, number>;
  byModel: Map<string, number[]>;
  byWord: Map<string, number[]>;
}

export function buildSourceIndex(source: SourceExport): SourceIndex {
  const index: SourceIndex = {
    kind: source.kind,
    records: source.records,
    byTag: new Map(),
    bySerial: new Map(),
    byModel: new Map(),
    byWord: new Map(),
  };
  source.records.forEach((record, position) => {
    if (record.assetTag !== null) {
      const key = ident(record.assetTag);
      if (key !== '' && !index.byTag.has(key)) index.byTag.set(key, position);
    }
    if (record.serial !== null) {
      const key = ident(record.serial);
      if (key !== '' && !index.bySerial.has(key)) index.bySerial.set(key, position);
    }
    if (record.model !== null) {
      const key = norm(record.model);
      if (key !== '') push(index.byModel, key, position);
    }
    for (const word of tokens(record.description)) push(index.byWord, word, position);
  });
  return index;
}

function push(map: Map<string, number[]>, key: string, position: number): void {
  const found = map.get(key);
  if (found) found.push(position);
  else map.set(key, [position]);
}

/** The positions of every record sharing a word with the subject, in file order. */
function descriptionCandidates(index: SourceIndex, description: string | null): number[] {
  const seen = new Set<number>();
  for (const word of tokens(description)) {
    for (const position of index.byWord.get(word) ?? []) seen.add(position);
  }
  return [...seen].sort((a, b) => a - b);
}

export function matchIndexed(subject: RegisterSubject, index: SourceIndex): EvidenceMatch | null {
  const at = (position: number | undefined): ExternalRecord | null =>
    position === undefined ? null : (index.records[position] ?? null);

  const made = (
    method: MatchMethod,
    record: ExternalRecord,
    on: string,
    score: number,
  ): EvidenceMatch => ({
    source: index.kind,
    method,
    score,
    recordId: record.recordId,
    on,
    lastSeenOn: record.lastSeenOn,
  });

  if (subject.assetTag) {
    const found = at(index.byTag.get(ident(subject.assetTag)));
    if (found) {
      return made(
        'asset-tag',
        found,
        `asset tag ${subject.assetTag} = ${found.assetTag}`,
        METHOD_SCORE['asset-tag'],
      );
    }
  }

  if (subject.serial) {
    const found = at(index.bySerial.get(ident(subject.serial)));
    if (found) {
      return made(
        'serial',
        found,
        `serial ${subject.serial} = ${found.serial}`,
        METHOD_SCORE.serial,
      );
    }
  }

  if (subject.model) {
    for (const position of index.byModel.get(norm(subject.model)) ?? []) {
      const record = index.records[position]!;
      if (!costAgrees(subject.originalCost, record.amount)) continue;
      return made(
        'model-and-cost',
        record,
        `model ${subject.model} at a cost the source agrees with (${record.amount})`,
        METHOD_SCORE['model-and-cost'],
      );
    }
  }

  for (const position of descriptionCandidates(index, subject.description)) {
    const record = index.records[position]!;
    const share = overlap(subject.description, record.description);
    if (share < 0.6) continue;
    return made(
      'description',
      record,
      `description "${subject.description}" against "${record.description}"`,
      Math.round(METHOD_SCORE.description * share * 100) / 100,
    );
  }

  return null;
}

/**
 * Every asset against every source, with each source read once.
 *
 * The three-way split per asset is `gatherEvidence`'s, and the two must agree.
 * They agree by construction: this function reimplements the *loop*, not the
 * rules, and the scope test, the thin-export threshold and the negative's score
 * all still come from the one place that defines them.
 */
export function gatherAll(
  subjects: readonly RegisterSubject[],
  exports: readonly SourceExport[],
): EvidenceResult[] {
  const indexes = exports.map(buildSourceIndex);
  return subjects.map((subject) => {
    const matches: EvidenceMatch[] = [];
    const negatives: NegativeStatement[] = [];
    const silent: EvidenceSourceKind[] = [];

    for (const index of indexes) {
      const profile = EVIDENCE_SOURCES[index.kind];
      if (!sourceCovers(index.kind, subject.categoryKey)) {
        silent.push(index.kind);
        continue;
      }
      const match = matchIndexed(subject, index);
      if (match) {
        matches.push(match);
        continue;
      }
      if (profile.denies === null || index.records.length < MIN_RECORDS_FOR_A_NEGATIVE) {
        silent.push(index.kind);
        continue;
      }
      negatives.push({
        source: index.kind,
        statement: profile.denies,
        searched: index.records.length,
        score: 0.6,
      });
    }

    return { assetId: subject.assetId, matches, negatives, silent };
  });
}
