import 'server-only';
import { cache } from 'react';
import { desc, eq, isNotNull } from 'drizzle-orm';
import type { PrecedentDocument, PrecedentKind, PrecedentOutcome } from '@tangible/knowledge';
import type {
  CorrectionMotionDraft,
  MotionDraftFacts,
  ProtestBrief,
  ProtestBriefFacts,
} from '@tangible/types';
import { motionKey } from '@/lib/motions';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The firm's own prior work, assembled into a corpus.
 *
 * `@tangible/knowledge` searches this; it does not read it. What is here is the
 * translation from four tables into the one shape a retriever can rank, and
 * the joining of each document to what became of it — which is the half that
 * makes a precedent worth having. A brief without its resolution is a piece of
 * writing; a brief with one is evidence about what a district accepts.
 *
 * It reads across the whole practice, like the acceptance learner. The reason
 * is the same: the value of a precedent corpus is that the ninetieth
 * engagement inherits the eighty-nine before it, and no single client has
 * enough filed briefs to be worth searching. Unlike the acceptance learner,
 * what comes out here is *prose*, and prose names people — so the boundary
 * this depends on is that the assistant is a firm surface. `/api/assistant` is
 * deliberately absent from `CLIENT_ROUTES` in `proxy.ts`, and a client viewer
 * cannot reach it. **Anything that exposes this corpus to the portal has to
 * scope it to the one client first**, and that is not a filter this file
 * applies for you.
 *
 * Rows are read newest-first and capped. The cap is reported rather than
 * hidden — a retriever that silently searched a third of the file would answer
 * "we have never argued that" when the truth is "not lately", which is the one
 * wrong answer this corpus can give that sounds like a right one.
 */

/**
 * How many documents of each kind to read.
 *
 * Generous relative to what a practice produces in a season, and small enough
 * that four queries and an in-memory index stay under a few hundred
 * milliseconds. When a firm outgrows it the fix is a Postgres full-text index
 * on these tables, not a bigger number here.
 */
const PER_KIND = 300;

export interface PrecedentCorpus {
  documents: PrecedentDocument[];
  /** Kinds whose read hit the cap, so the caller can say the search was partial. */
  truncated: PrecedentKind[];
}

/**
 * Built per request. `cache()` dedupes the four queries across the tools a
 * single turn calls, and nothing outlives the request — a brief drafted during
 * this season has to be findable in the next question about it.
 */
export const precedentCorpus = cache(async (): Promise<PrecedentCorpus> => {
  const [briefs, motions, notes] = await Promise.all([
    briefDocuments(),
    motionDocuments(),
    noteDocuments(),
  ]);
  return {
    documents: [...briefs.documents, ...motions.documents, ...notes.documents],
    truncated: [...briefs.truncated, ...motions.truncated, ...notes.truncated],
  };
});

interface KindResult {
  documents: PrecedentDocument[];
  truncated: PrecedentKind[];
}

/* -------------------------------------------------------------------------- */
/*  Protest briefs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How a protest ended, read from the resolution the firm recorded.
 *
 * Withdrawn and dismissed come back `favorable: null`, not false, and the
 * reason is the one `realize()` gives for keeping withdrawals out of the
 * acceptance model: a withdrawal looks like a loss and is not one. Nothing was
 * determined, the noticed value stands, and the firm may have pulled the
 * protest because it got what it wanted elsewhere. Scoring that as a defeat
 * would teach a reader — and the model composing from these — that an argument
 * fails when the record says only that it was never tested.
 */
function briefOutcome(row: typeof schema.protestResolutions.$inferSelect): PrecedentOutcome {
  const on = row.resolvedOn;
  if (row.stage === 'withdrawn' || row.stage === 'dismissed') {
    return {
      label: `Protest ${row.stage} — nothing was determined and the noticed value stands.`,
      favorable: null,
      on,
    };
  }
  const forum = row.stage === 'arb' ? 'ARB order' : 'Informal agreement';
  const noticed = row.noticedValue;
  const final = row.finalValue;
  if (noticed === null || final === null) {
    return { label: `${forum} — the record does not carry both values.`, favorable: null, on };
  }
  const moved = noticed - final;
  if (moved <= 0) {
    return { label: `${forum} — the noticed value was upheld in full.`, favorable: false, on };
  }
  const share = noticed === 0 ? 0 : Math.round((moved / noticed) * 100);
  return {
    label: `${forum} — value reduced ${share}%, from ${money(noticed)} to ${money(final)}.`,
    favorable: true,
    on,
  };
}

async function briefDocuments(): Promise<KindResult> {
  const rows = await requireDb()
    .select({
      brief: schema.protestBriefs,
      clientId: schema.engagements.clientId,
      clientName: schema.clients.name,
    })
    .from(schema.protestBriefs)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.protestBriefs.engagementId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .orderBy(desc(schema.protestBriefs.createdAt))
    .limit(PER_KIND);

  if (rows.length === 0) return { documents: [], truncated: [] };

  const resolutions = new Map(
    (
      await requireDb()
        .select()
        .from(schema.protestResolutions)
        .where(eq(schema.protestResolutions.status, 'recorded'))
    ).map((row) => [row.noticeId, row]),
  );

  const documents: PrecedentDocument[] = [];
  // Rows are append-only and a redraft inserts a new one, so the newest row
  // for a notice is the brief that was actually used. Older drafts are the
  // firm arguing with itself, and indexing them would let a superseded
  // paragraph outrank the one that went out.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.brief.noticeId)) continue;
    seen.add(row.brief.noticeId);

    const facts = row.brief.facts as ProtestBriefFacts;
    const brief = row.brief.brief as ProtestBrief;
    const headings = brief.grounds.map((ground) => ground.heading).filter(Boolean);
    const resolution = resolutions.get(row.brief.noticeId);

    documents.push({
      id: `protest-brief:${row.brief.id}`,
      kind: 'protest-brief',
      title: headings.length ? headings.join('; ') : `Protest of ${facts.locationLabel}`,
      body: [
        brief.summary,
        ...brief.grounds.map((ground) =>
          [`${ground.heading}.`, ground.argument, `Support: ${ground.support}`].join(' '),
        ),
        brief.penaltyRequest ?? '',
        // The positions are what the engagement had committed when the brief
        // was drafted; they are the vocabulary a preparer searches in.
        facts.positions.map((position) => position.title).join('; '),
      ]
        .filter(Boolean)
        .join('\n\n'),
      clientId: row.clientId,
      clientName: row.clientName,
      district: facts.districtName,
      taxYear: facts.taxYear,
      findingKey: null,
      outcome: resolution ? briefOutcome(resolution) : null,
      writtenOn: row.brief.createdAt.toISOString().slice(0, 10),
      href: null,
    });
  }

  return { documents, truncated: rows.length >= PER_KIND ? ['protest-brief'] : [] };
}

/* -------------------------------------------------------------------------- */
/*  Correction motions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How a 25.25 motion ended.
 *
 * Four endings and only one of them is a win on the merits. `forfeited`
 * determines nothing about value and still closes (c-1) for that property and
 * year, which makes it the worst ending available — so it is recorded as
 * unfavourable even though nobody ruled against the argument. Withdrawal keeps
 * the null the protest side gives it, for the same reason.
 */
function motionOutcome(row: typeof schema.correctionMotions.$inferSelect): PrecedentOutcome | null {
  if (!row.outcome) {
    return {
      label: `Filed ${row.filedOn} under 25.25(${row.route}); no ending recorded yet.`,
      favorable: null,
      on: null,
    };
  }
  const on = row.outcomeOn;
  switch (row.outcome) {
    case 'agreed':
    case 'determined': {
      const corrected = row.correctedValue;
      const rolled = row.rolledValue;
      const moved = corrected !== null && rolled !== null && corrected < rolled;
      return {
        label: moved
          ? `Motion ${row.outcome} — roll corrected from ${money(rolled)} to ${money(corrected)}.`
          : `Motion ${row.outcome} — the roll was not reduced.`,
        favorable: moved,
        on,
      };
    }
    case 'forfeited':
      return {
        label: 'Forfeited — nothing was determined, and 25.25(c-1) is closed for this year.',
        favorable: false,
        on,
      };
    default:
      return {
        label: `Motion ${row.outcome} — nothing was determined.`,
        favorable: null,
        on,
      };
  }
}

async function motionDocuments(): Promise<KindResult> {
  const rows = await requireDb()
    .select({
      draft: schema.motionDrafts,
      clientId: schema.engagements.clientId,
      clientName: schema.clients.name,
    })
    .from(schema.motionDrafts)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.motionDrafts.engagementId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .orderBy(desc(schema.motionDrafts.createdAt))
    .limit(PER_KIND);

  if (rows.length === 0) return { documents: [], truncated: [] };

  // Keyed the way the open-years board keys a year, which is the same key the
  // draft was written against — an account and a subject year, or the site
  // where the account is unknown.
  const filed = new Map<string, typeof schema.correctionMotions.$inferSelect>();
  for (const motion of await requireDb()
    .select()
    .from(schema.correctionMotions)
    .where(eq(schema.correctionMotions.status, 'recorded'))) {
    filed.set(
      `${motion.engagementId}:${motionKey(motion.accountId, motion.subjectTaxYear, motion.locationId)}`,
      motion,
    );
  }

  const documents: PrecedentDocument[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.draft.engagementId}:${row.draft.yearKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const facts = row.draft.facts as MotionDraftFacts;
    const draft = row.draft.draft as CorrectionMotionDraft;
    const motion = filed.get(key);

    documents.push({
      id: `correction-motion:${row.draft.id}`,
      kind: 'correction-motion',
      title: draft.title,
      body: [draft.body, `Ground asserted: ${facts.ground}`].filter(Boolean).join('\n\n'),
      clientId: row.clientId,
      clientName: row.clientName,
      district: facts.districtName,
      taxYear: facts.taxYear,
      findingKey: null,
      outcome: motion ? motionOutcome(motion) : null,
      writtenOn: row.draft.createdAt.toISOString().slice(0, 10),
      href: null,
    });
  }

  return { documents, truncated: rows.length >= PER_KIND ? ['correction-motion'] : [] };
}

/* -------------------------------------------------------------------------- */
/*  Preparer notes on findings                                                */
/* -------------------------------------------------------------------------- */

/**
 * The sentence somebody wrote when they decided a finding.
 *
 * `finding_dispositions` and not `finding_row_decisions`, though both carry a
 * note. The dispositions table holds one current answer per finding and is
 * written in place, so it is the firm's settled position; the row decisions
 * table is append-only, mostly noteless, and the same note repeated across
 * eighty assets would flood the index with one opinion wearing eighty hats.
 *
 * The note is the whole document. There is no drafted prose here and no model
 * involved — this is the one kind in the corpus that is entirely a person's
 * own words, which is also why it is the most useful of the three: it is where
 * a firm's actual reasons live.
 */
async function noteDocuments(): Promise<KindResult> {
  const rows = await requireDb()
    .select({
      disposition: schema.findingDispositions,
      clientId: schema.engagements.clientId,
      clientName: schema.clients.name,
      jurisdictionId: schema.engagements.jurisdictionId,
      taxYear: schema.engagements.taxYear,
    })
    .from(schema.findingDispositions)
    .innerJoin(
      schema.engagements,
      eq(schema.engagements.id, schema.findingDispositions.engagementId),
    )
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .where(isNotNull(schema.findingDispositions.note))
    .orderBy(desc(schema.findingDispositions.decidedAt))
    .limit(PER_KIND);

  const documents: PrecedentDocument[] = [];
  for (const row of rows) {
    const note = row.disposition.note?.trim();
    if (!note) continue;
    documents.push({
      id: `finding-note:${row.disposition.id}`,
      kind: 'finding-note',
      title: `${statusWord(row.disposition.status)}: ${humanize(row.disposition.key)}`,
      body: note,
      clientId: row.clientId,
      clientName: row.clientName,
      district: row.jurisdictionId,
      taxYear: row.taxYear,
      findingKey: row.disposition.key,
      // `favorable` is null on every note, including the accepted ones, and
      // that is deliberate. It records whether an *argument prevailed*, and a
      // disposition is not an argument to anybody — the firm decided, nobody
      // answered. Marking an accepted finding favourable would let a tally
      // report a winning record built entirely out of the firm agreeing with
      // itself. What was decided is in the label, where it belongs.
      outcome: {
        label: `${statusWord(row.disposition.status)} by the firm — no district has answered this.`,
        favorable: null,
        on: row.disposition.decidedAt.toISOString().slice(0, 10),
      },
      writtenOn: row.disposition.decidedAt.toISOString().slice(0, 10),
      href: null,
    });
  }

  return { documents, truncated: rows.length >= PER_KIND ? ['finding-note'] : [] };
}

/* -------------------------------------------------------------------------- */
/*  Wording                                                                   */
/* -------------------------------------------------------------------------- */

function statusWord(status: string): string {
  if (status === 'accepted') return 'Taken';
  if (status === 'rejected') return 'Left on the return';
  return 'Sent to the client';
}

/** `ghost-assets` -> `ghost assets`. Engine keys read as prose in a title. */
function humanize(key: string): string {
  return key.replace(/[-_]/g, ' ');
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
