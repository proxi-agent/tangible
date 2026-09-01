import { buildIndex, scoreIndex, type Retrievable } from './bm25.js';

/**
 * The firm's own prior work, searched.
 *
 * This is the second retriever the curated corpus always said it wanted. That
 * one holds what is true of Texas business personal property regardless of
 * whose engagement is open; this one holds what *this firm* once wrote — a
 * brief it filed against a notice, a 25.25 motion it brought, the sentence a
 * preparer left on a finding explaining why they took it off. Two corpora,
 * because they answer two different questions and confusing them would be a
 * serious error:
 *
 *   - the curated corpus is **authority**. An answer may state a rule from it.
 *   - this one is **history**. An answer may say the firm argued something and
 *     report how it went. It may never state a rule from it, because a brief
 *     that got the law wrong is still in here, and so is one the district
 *     refused.
 *
 * That second point is the reason the outcome travels with every document and
 * is never optional. A precedent without its ending is an anecdote.
 *
 * **Losses rank exactly like wins.** There is an obvious temptation to boost
 * the documents that worked, and it is wrong. The most valuable document in
 * this corpus is the argument a district has already refused twice — a
 * retriever that quietly demoted it would let the firm walk into the same
 * refusal a third time, and would do it while looking helpful. Ranking answers
 * "is this document about the question"; the outcome is reported, not scored.
 * For the same reason the outcome text is not an indexed field: a query
 * containing "denied" would otherwise pull losses preferentially, turning a
 * question about wording into a question about results.
 *
 * **Nothing decays.** No recency tilt, no half-life on a district's habits.
 * Not because age does not matter — a 2023 brief is weaker evidence about a
 * 2027 hearing — but because nothing in the record tells us how fast a
 * district's practice moves, and a decay constant chosen by feel would be a
 * number this retriever could not defend when a preparer asked where it came
 * from. Every hit prints its date and the reader does the discounting.
 *
 * The corpus is supplied by the caller rather than read here, for the same
 * reason `learnAcceptance` does not touch a database: this package holds no
 * connection, and a retriever that owned its own read could not be tested
 * against a corpus somebody wrote by hand.
 */

/** What kinds of prior work are worth retrieving. */
export const PRECEDENT_KINDS = [
  /** An argument made to a district against one notice. */
  'protest-brief',
  /** A motion under 25.25 to reopen a closed year. */
  'correction-motion',
  /** The reason a preparer gave for accepting or rejecting a finding. */
  'finding-note',
] as const;

export type PrecedentKind = (typeof PRECEDENT_KINDS)[number];

/**
 * How it ended, in the record's own terms.
 *
 * `favorable` is null far more often than it is false, and the difference
 * matters: a brief whose hearing has not happened tells you what the firm
 * argued and nothing about whether it works. A renderer that printed those two
 * the same way would manufacture a losing record out of a pending one.
 */
export interface PrecedentOutcome {
  /** One line a reader can act on: "Informal agreement — value cut to $310,000." */
  label: string;
  /** True where it went the firm's way, false where it did not, null while open. */
  favorable: boolean | null;
  /** ISO date the ending was recorded. Null while unresolved. */
  on: string | null;
}

export interface PrecedentDocument {
  /** Kind-prefixed and stable: "protest-brief:<uuid>". Cited by the assistant. */
  id: string;
  kind: PrecedentKind;
  /** What this document is, in one line, for a reader scanning hits. */
  title: string;
  /** The prose itself. Plain text — it goes into a prompt. */
  body: string;
  clientId: string;
  clientName: string;
  /** The appraisal district it was argued to, where the document names one. */
  district: string | null;
  /** The year at issue, which is not always the engagement's year. */
  taxYear: number | null;
  /** The finding it argued, where the document is about exactly one. */
  findingKey: string | null;
  outcome: PrecedentOutcome | null;
  /** ISO date the firm wrote it. */
  writtenOn: string;
  /** Where to read the whole thing. Null where no screen shows it. */
  href: string | null;
}

export interface PrecedentHit {
  document: PrecedentDocument;
  score: number;
  matched: readonly string[];
}

/**
 * Field weights. The body carries most of a brief's meaning, unlike a curated
 * article whose keyword field was written to be retrieved — so the spread here
 * is narrower than the corpus's. The finding key outranks the district because
 * "what have we argued about ghost assets" is the question this gets asked,
 * and "what have we argued in Harris" is a filter, not a query.
 */
const FIELD_WEIGHTS = { title: 4, findingKey: 3, district: 2, kind: 2, body: 1 } as const;

function retrievable(document: PrecedentDocument): Retrievable {
  return {
    id: document.id,
    fields: [
      { text: document.title, weight: FIELD_WEIGHTS.title },
      { text: document.findingKey ?? '', weight: FIELD_WEIGHTS.findingKey },
      { text: document.district ?? '', weight: FIELD_WEIGHTS.district },
      { text: document.kind.replace(/-/g, ' '), weight: FIELD_WEIGHTS.kind },
      { text: document.body, weight: FIELD_WEIGHTS.body },
    ],
  };
}

export interface PrecedentSearchOptions {
  limit?: number;
  minScore?: number;
  /** Narrow to these kinds. Empty or omitted searches everything supplied. */
  kinds?: readonly PrecedentKind[];
  /** Narrow to one district, matched on the label the documents carry. */
  district?: string | null;
  /** Narrow to one finding key. Exact — these are engine keys, not prose. */
  findingKey?: string | null;
  /** Narrow to one client. Omitted reads the whole practice. */
  clientId?: string | null;
}

const DEFAULT_LIMIT = 4;

/**
 * The index is rebuilt on every call, and that is correct.
 *
 * The curated corpus is a module constant and caches its index for the life of
 * the process. This corpus is a query result: a brief drafted five minutes ago
 * has to be findable, and a cache keyed on nothing would serve a stale
 * practice for as long as the container lived. Building over a few hundred
 * short documents is microseconds; the database read the caller already did is
 * the expensive half.
 */
export function searchPrecedent(
  documents: readonly PrecedentDocument[],
  query: string,
  options: PrecedentSearchOptions = {},
): PrecedentHit[] {
  if (documents.length === 0) return [];

  const byId = new Map(documents.map((document) => [document.id, document]));
  const kinds = options.kinds?.length ? new Set<string>(options.kinds) : null;
  const district = options.district?.trim().toLowerCase() || null;

  const hits = scoreIndex(buildIndex(documents.map(retrievable)), query, {
    limit: options.limit ?? DEFAULT_LIMIT,
    minScore: options.minScore,
    where: (id) => {
      const document = byId.get(id);
      if (!document) return false;
      if (kinds && !kinds.has(document.kind)) return false;
      if (district && (document.district ?? '').toLowerCase() !== district) return false;
      if (options.findingKey && document.findingKey !== options.findingKey) return false;
      if (options.clientId && document.clientId !== options.clientId) return false;
      return true;
    },
  });

  return hits.map((hit) => ({
    document: byId.get(hit.id)!,
    score: hit.score,
    matched: hit.matched,
  }));
}

export interface PrecedentTally {
  total: number;
  favorable: number;
  unfavorable: number;
  /** Written, not yet answered. Counted apart from a loss on purpose. */
  unresolved: number;
}

/**
 * The record behind a set of hits, counted.
 *
 * Worth having as its own function because it is the sentence a preparer
 * actually wants — "we have argued this four times and been allowed twice" —
 * and because counting it in the caller would put an arithmetic claim in a
 * place nothing tests.
 */
export function tallyPrecedent(hits: readonly PrecedentHit[]): PrecedentTally {
  let favorable = 0;
  let unfavorable = 0;
  let unresolved = 0;
  for (const hit of hits) {
    const outcome = hit.document.outcome;
    if (!outcome || outcome.favorable === null) unresolved += 1;
    else if (outcome.favorable) favorable += 1;
    else unfavorable += 1;
  }
  return { total: hits.length, favorable, unfavorable, unresolved };
}

const KIND_LABELS: Record<PrecedentKind, string> = {
  'protest-brief': 'Protest brief',
  'correction-motion': '25.25 motion',
  'finding-note': "Preparer's note on a finding",
};

export function precedentKindLabel(kind: PrecedentKind): string {
  return KIND_LABELS[kind];
}

/**
 * Hits rendered for a prompt.
 *
 * Every document opens with the same warning, and it is repeated per document
 * rather than stated once at the top on purpose: a model reading eight
 * thousand characters of confident-sounding legal prose will forget a preamble
 * long before it reaches the last one. The line it must not cross is stating a
 * rule from this corpus, and the cheapest way to hold it there is to say so
 * again beside every piece of prose that might tempt it.
 */
export function renderPrecedent(hits: readonly PrecedentHit[]): string {
  if (hits.length === 0) return '';
  return hits
    .map((hit) => {
      const { document } = hit;
      const where = [
        document.district,
        document.taxYear === null ? null : `tax year ${document.taxYear}`,
        document.clientName,
      ]
        .filter((part): part is string => Boolean(part))
        .join(', ');
      const outcome = document.outcome
        ? `Outcome: ${document.outcome.label}${document.outcome.on ? ` (${document.outcome.on})` : ''}`
        : 'Outcome: not recorded — this is what was written, not what came of it.';
      return [
        `[${document.id}] ${precedentKindLabel(document.kind)} — ${document.title}`,
        where
          ? `Where: ${where}. Written ${document.writtenOn}.`
          : `Written ${document.writtenOn}.`,
        outcome,
        'This is the firm’s own prior work, not authority. Do not state a rule from it.',
        '',
        document.body,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}
