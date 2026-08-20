import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FindingRow, FindingSetRow } from '@tangible/db';
import {
  byKey,
  fromRegisterComparison,
  fromSavingsReport,
  resolveDisposition,
  type DispositionRecord,
  type NormalizedSet,
} from '@tangible/findings';
import type {
  CommitFindingsRequest,
  FindingDecisionResult,
  FindingDispositionStatus,
  FindingEffect,
  FindingKind,
  FindingSet,
  FindingSetSummary,
  FindingSource,
  StoredFinding,
  UpdateFindingDispositionRequest,
} from '@tangible/types';
import {
  analysisFingerprint,
  buildComparisonAnalysis,
  buildSavingsAnalysis,
} from '@/lib/analysis';
import { HttpError, notFound } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Committing an analysis, and keeping what was decided about it.
 *
 * Two rules run through everything here. The first is that a commit runs the
 * analysis itself rather than accepting one from the browser: what gets stored
 * as "what we told the client" has to be what the engines produced, not what a
 * client posted. The second is that dispositions are never rewritten by a
 * commit — a new set replays the existing decisions and stops there. A commit
 * is a snapshot, and a snapshot that quietly edited the record of what someone
 * agreed to would be the one thing this table exists to prevent.
 */

export async function commitFindings(
  engagementId: string,
  body: CommitFindingsRequest,
  actor: string | null,
): Promise<FindingSet> {
  const { normalized, report, fingerprint, priorDocumentId, taxYear } = await runAnalysis(
    engagementId,
    body,
  );

  if (normalized.findings.length === 0)
    throw new HttpError(
      400,
      'This analysis found nothing to commit. Commit a set once there is something in it to decide about.',
    );

  const db = requireDb();
  const setId = await db.transaction(async (tx) => {
    const [set] = await tx
      .insert(schema.findingSets)
      .values({
        engagementId,
        source: normalized.source,
        priorDocumentId,
        taxYear,
        label: body.label ?? null,
        report,
        sourceFingerprint: fingerprint,
        findingCount: normalized.findingCount,
        savingCount: normalized.savingCount,
        exposureCount: normalized.exposureCount,
        totalCost: normalized.totalCost,
        totalValue: normalized.totalValue,
        headlineLabel: normalized.headline.label,
        headlineValue: normalized.headline.value,
        headlineCaveat: normalized.headline.caveat,
        committedBy: actor,
      })
      .returning({ id: schema.findingSets.id });
    if (!set) throw new HttpError(500, 'The finding set could not be written.');

    await tx.insert(schema.findings).values(
      normalized.findings.map((finding) => ({
        setId: set.id,
        engagementId,
        source: normalized.source,
        key: finding.key,
        ordinal: finding.ordinal,
        title: finding.title,
        kind: finding.kind,
        effect: finding.effect,
        cost: finding.cost,
        value: finding.value,
        assetCount: finding.assetCount,
        summary: finding.summary,
        basis: finding.basis,
        assumption: finding.assumption,
        evidence: finding.evidence,
        cells: finding.cells,
      })),
    );

    return set.id;
  });

  return fetchFindingSet(setId);
}

/**
 * Run the analysis the request names.
 *
 * The two differ in more than which engine they call: a comparison belongs to a
 * return and is valued on that return's year, a savings report belongs to the
 * engagement and is valued on the engagement's. Getting that wrong is the kind
 * of mistake that produces a plausible number for the wrong January.
 */
async function runAnalysis(
  engagementId: string,
  body: CommitFindingsRequest,
): Promise<{
  normalized: NormalizedSet;
  report: unknown;
  fingerprint: string;
  priorDocumentId: string | null;
  taxYear: number;
}> {
  if (body.source === 'savings') {
    if (body.priorDocumentId)
      throw new HttpError(400, 'A savings report is not run against a prior return.');
    const { report, fingerprint } = await buildSavingsAnalysis(engagementId);
    return {
      normalized: fromSavingsReport(report),
      report,
      fingerprint,
      priorDocumentId: null,
      taxYear: report.taxYear,
    };
  }

  if (!body.priorDocumentId)
    throw new HttpError(400, 'A register comparison needs the return it was run against.');

  const { comparison, document, fingerprint, taxYear } = await buildComparisonAnalysis(
    body.priorDocumentId,
  );
  if (document.engagementId !== engagementId)
    throw new HttpError(400, 'That return belongs to a different engagement.');

  return {
    normalized: fromRegisterComparison(comparison),
    report: comparison,
    fingerprint,
    priorDocumentId: document.id,
    taxYear,
  };
}

export async function fetchFindingSet(setId: string): Promise<FindingSet> {
  const db = requireDb();
  const [set] = await db.select().from(schema.findingSets).where(eq(schema.findingSets.id, setId));
  if (!set) notFound(`Unknown finding set: ${setId}`);

  const rows = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.setId, setId))
    .orderBy(schema.findings.ordinal);

  const findings = await withDispositions(set, rows);
  const summary = summaryDto(set, findings, await isStale(set));

  return { ...summary, findings, report: set.report };
}

export async function listFindingSets(engagementId: string): Promise<FindingSetSummary[]> {
  const db = requireDb();
  const sets = await db
    .select()
    .from(schema.findingSets)
    .where(eq(schema.findingSets.engagementId, engagementId))
    .orderBy(desc(schema.findingSets.committedAt));
  if (sets.length === 0) return [];

  const rows = await db
    .select()
    .from(schema.findings)
    .where(
      inArray(
        schema.findings.setId,
        sets.map((set) => set.id),
      ),
    )
    .orderBy(schema.findings.ordinal);

  const bySet = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const list = bySet.get(row.setId);
    if (list) list.push(row);
    else bySet.set(row.setId, [row]);
  }

  // One fingerprint per (source, document) rather than one per set: every
  // savings set on an engagement stands on the same register, and asking the
  // same four aggregates once per set would make a list of ten reports ten
  // times the work for an identical answer.
  const fingerprints = new Map<string, Promise<string | null>>();
  const currentFor = (set: FindingSetRow): Promise<string | null> => {
    const cacheKey = `${set.source}:${set.priorDocumentId ?? ''}`;
    const cached = fingerprints.get(cacheKey);
    if (cached) return cached;
    const pending = analysisFingerprint({
      engagementId: set.engagementId,
      source: set.source as FindingSource,
      priorDocumentId: set.priorDocumentId,
    }).catch(() => null);
    fingerprints.set(cacheKey, pending);
    return pending;
  };

  return Promise.all(
    sets.map(async (set) => {
      const findings = await withDispositions(set, bySet.get(set.id) ?? []);
      return summaryDto(set, findings, await isStale(set, currentFor(set)));
    }),
  );
}

/**
 * Record, change or clear a decision.
 *
 * Keyed on the finding's key rather than its row, so the decision outlives the
 * set it was made on. Clearing deletes the row: undecided is the absence of a
 * record, and a row saying "no longer decided" would be a decision of its own.
 */
export async function decideFinding(
  findingId: string,
  body: UpdateFindingDispositionRequest,
  actor: string | null,
): Promise<FindingDecisionResult> {
  const db = requireDb();
  const [finding] = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId));
  if (!finding) notFound(`Unknown finding: ${findingId}`);

  const where = and(
    eq(schema.findingDispositions.engagementId, finding.engagementId),
    eq(schema.findingDispositions.source, finding.source),
    eq(schema.findingDispositions.key, finding.key),
  );

  if (body.status === null) {
    await db.delete(schema.findingDispositions).where(where);
  } else {
    await db
      .insert(schema.findingDispositions)
      .values({
        engagementId: finding.engagementId,
        source: finding.source,
        key: finding.key,
        status: body.status,
        note: body.note ?? null,
        decidedBy: actor,
        // The figures the decision was made against, so a later set can say
        // whether it is carrying a decision onto the same claim or a different
        // one wearing its name.
        decidedCost: finding.cost,
        decidedValue: finding.value,
        decidedSetId: finding.setId,
      })
      .onConflictDoUpdate({
        target: [
          schema.findingDispositions.engagementId,
          schema.findingDispositions.source,
          schema.findingDispositions.key,
        ],
        set: {
          status: body.status,
          note: body.note ?? null,
          decidedBy: actor,
          decidedAt: new Date(),
          decidedCost: finding.cost,
          decidedValue: finding.value,
          decidedSetId: finding.setId,
        },
      });
  }

  const set = await fetchFindingSet(finding.setId);
  const decided = set.findings.find((row) => row.id === findingId);
  if (!decided) notFound(`Unknown finding: ${findingId}`);
  const { findings: _findings, report: _report, ...summary } = set;
  return { finding: decided, set: summary };
}

/** Attach each finding's decision, replayed from the engagement-level record. */
async function withDispositions(
  set: FindingSetRow,
  rows: FindingRow[],
): Promise<StoredFinding[]> {
  if (rows.length === 0) return [];
  const db = requireDb();
  const records = await db
    .select()
    .from(schema.findingDispositions)
    .where(
      and(
        eq(schema.findingDispositions.engagementId, set.engagementId),
        eq(schema.findingDispositions.source, set.source),
        inArray(
          schema.findingDispositions.key,
          rows.map((row) => row.key),
        ),
      ),
    );

  // `status` comes back as the text it is stored as; the enum it belongs to is
  // enforced on the way in, at the route's schema.
  const index = byKey(
    records.map((record) => ({
      ...record,
      status: record.status as FindingDispositionStatus,
    })),
  );
  return rows.map((row) => findingDto(row, index.get(row.key)));
}

function findingDto(row: FindingRow, record: DispositionRecord | undefined): StoredFinding {
  return {
    id: row.id,
    setId: row.setId,
    engagementId: row.engagementId,
    source: row.source as FindingSource,
    key: row.key,
    ordinal: row.ordinal,
    title: row.title,
    kind: row.kind as FindingKind,
    effect: row.effect as FindingEffect,
    cost: row.cost,
    value: row.value,
    assetCount: row.assetCount,
    summary: row.summary,
    basis: row.basis,
    assumption: row.assumption,
    evidence: row.evidence as StoredFinding['evidence'],
    cells: row.cells as unknown[],
    disposition: resolveDisposition(row, record),
  };
}

function summaryDto(
  set: FindingSetRow,
  findings: StoredFinding[],
  stale: boolean,
): FindingSetSummary {
  return {
    id: set.id,
    engagementId: set.engagementId,
    source: set.source as FindingSource,
    priorDocumentId: set.priorDocumentId,
    taxYear: set.taxYear,
    label: set.label,
    committedBy: set.committedBy,
    committedAt: set.committedAt.toISOString(),
    findingCount: set.findingCount,
    savingCount: set.savingCount,
    exposureCount: set.exposureCount,
    // Counted from the replayed decisions rather than stored on the set: a
    // decision made after the commit belongs to this set too, and a stored
    // count would be wrong the moment anyone used the thing.
    decidedCount: findings.filter((finding) => finding.disposition !== null).length,
    totalCost: set.totalCost,
    totalValue: set.totalValue,
    headline: {
      label: set.headlineLabel,
      value: set.headlineValue,
      caveat: set.headlineCaveat,
    },
    isStale: stale,
  };
}

/**
 * Whether the ground under a committed set has moved.
 *
 * A comparison whose return has since been deleted is stale in the strongest
 * sense — the document it was a statement about is gone — and the same is true
 * when the fingerprint cannot be computed at all. Failing to answer resolves to
 * "behind", not to "current": the cost of a set wrongly flagged is a second
 * look, and the cost of one wrongly cleared is a stale number in front of a
 * client.
 */
async function isStale(set: FindingSetRow, pending?: Promise<string | null>): Promise<boolean> {
  if (set.source === 'register-comparison' && !set.priorDocumentId) return true;
  const current = await (pending ??
    analysisFingerprint({
      engagementId: set.engagementId,
      source: set.source as FindingSource,
      priorDocumentId: set.priorDocumentId,
    }).catch(() => null));
  return current === null || current !== set.sourceFingerprint;
}
