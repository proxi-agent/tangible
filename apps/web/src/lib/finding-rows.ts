import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { facetsFor, matchesFilters, totalRows } from '@tangible/findings';
import type { QueueDecision } from '@tangible/savings';
import type {
  DecideFindingRowsRequest,
  FindingRow,
  FindingRowDecision,
  FindingRowFilters,
  FindingRowPage,
  ReviewableRow,
  SavingsFinding,
  SavingsReport,
} from '@tangible/types';
import { HttpError } from '@/lib/http';
import { publishedReport } from '@/lib/runs';
import { currentViewer } from '@/lib/viewer';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Reviewing a finding one asset at a time.
 *
 * Everything here runs on the server, and that is the design rather than an
 * optimisation. The engine now emits a row per asset with no cap on it, because
 * a cap would be a silent limit on which of their own property a client is
 * allowed to look at — and the consequence is that a large register's finding
 * is a population you filter, not a list you scroll. Filtering it in the
 * browser would mean shipping the whole population to do it, which is slow on a
 * laptop and wrong on a phone.
 *
 * So the client sends a filter and gets back three things: the page of rows, the
 * totals **for the whole filtered set**, and the facets for the whole
 * population. The middle one is what makes the screen honest — the number above
 * the table always describes what the filter selected, not what happens to fit
 * on it.
 */

/** A page of rows. Large enough that most findings arrive whole. */
const PAGE_SIZE = 200;
const MAX_PAGE = 500;

/**
 * The row state, appended.
 *
 * `finding_row_decisions` is never updated, so "what is decided now" is the
 * newest record per asset — and a cleared decision is a record too, with the
 * sentinel status below, so that undoing an accept leaves a trace instead of a
 * hole. Nothing outside this file sees `cleared`: it reads back as the absence
 * of a decision, which is what it means.
 */
const CLEARED = 'cleared';

export async function currentRowDecisions(
  engagementId: string,
  source: string,
  findingKey: string,
): Promise<Map<string, FindingRowDecision & { assetId: string }>> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.findingRowDecisions)
    .where(
      and(
        eq(schema.findingRowDecisions.engagementId, engagementId),
        eq(schema.findingRowDecisions.source, source),
        eq(schema.findingRowDecisions.findingKey, findingKey),
      ),
    )
    .orderBy(desc(schema.findingRowDecisions.decidedAt));

  const current = new Map<string, FindingRowDecision & { assetId: string }>();
  const revisions = new Map<string, number>();
  const settled = new Set<string>();
  for (const row of rows) {
    revisions.set(row.assetId, (revisions.get(row.assetId) ?? 0) + 1);
    // Newest first, so the first record seen for an asset is the live one.
    // Older ones still count towards `revisions` — how many times a row has
    // been turned over is worth seeing, because a row accepted, rejected and
    // accepted again is one somebody is unsure about.
    if (settled.has(row.assetId)) continue;
    settled.add(row.assetId);
    if (row.status === CLEARED) continue;
    current.set(row.assetId, {
      assetId: row.assetId,
      status: row.status as FindingRowDecision['status'],
      note: row.note,
      decidedBy: row.decidedBy,
      decidedByAudience: row.decidedByAudience,
      decidedAt: row.decidedAt.toISOString(),
      decidedValue: row.decidedValue,
      decidedTaxAtRisk: row.decidedTaxAtRisk,
      revisions: 1,
      hasMovedSinceDecision: false,
    });
  }
  for (const [assetId, decision] of current) decision.revisions = revisions.get(assetId) ?? 1;
  return current;
}

/**
 * The published run's copy of one finding, with its rows.
 *
 * Deliberately the published run and not the live analysis, for the same reason
 * the report page is: a client who accepts twenty rows on Tuesday and finds a
 * different twenty on Thursday has been given nothing they can act on. The
 * decisions they make are keyed on asset ids, which are durable, so they carry
 * onto the next published run rather than being tied to this one.
 */
export async function loadFindingRows(
  engagementId: string,
  findingKey: string,
  filters: FindingRowFilters,
  page: { offset?: number; limit?: number; all?: boolean } = {},
): Promise<FindingRowPage> {
  const published = await publishedReport(engagementId);
  const report = published.report as SavingsReport | null;
  const finding = report?.findings.find((item) => item.key === findingKey) ?? null;
  if (!report || !finding) {
    throw new HttpError(404, 'That finding is not on the published report.');
  }

  const decisions = await currentRowDecisions(engagementId, 'savings', findingKey);
  const all: ReviewableRow[] = rowsOf(finding).map((row) => {
    const decision = decisions.get(row.assetId) ?? null;
    return {
      row,
      decision:
        decision === null
          ? null
          : {
              ...decision,
              // The decision stands either way — it was theirs to make — but a
              // row worth $12,000 when it was accepted and $40,000 now is one
              // somebody should look at again rather than assume.
              hasMovedSinceDecision:
                decision.decidedValue !== null &&
                row.valueRemoved !== null &&
                Math.abs(decision.decidedValue - row.valueRemoved) > 1,
            },
    };
  });

  const selected = all.filter(({ row, decision }) => matchesFilters(row, decision, filters));
  // `all` is for the workbook, which is the one consumer that must not paginate
  // — an export that silently stopped at five hundred rows would be a working
  // paper that quietly disagrees with the screen it was taken from.
  const offset = page.all ? 0 : Math.max(0, page.offset ?? 0);
  const limit = page.all
    ? selected.length
    : Math.min(MAX_PAGE, Math.max(1, page.limit ?? PAGE_SIZE));

  return {
    engagementId,
    findingKey,
    title: finding.title,
    kind: finding.kind,
    summary: finding.summary,
    basis: finding.basis,
    assumption: finding.assumption,
    question: finding.question,
    runId: published.runId,
    publishedAt: published.publishedAt,
    blendedTaxRate: report.blendedTaxRate,
    rateSource: report.rateSource,
    jurisdictionName: report.jurisdictionName,
    detection: finding.detection,
    confidenceMix: finding.confidenceMix,
    facets: facetsFor(all),
    appliedFilters: filters,
    population: totalRows(all),
    filtered: totalRows(selected),
    rows: selected.slice(offset, offset + limit),
    offset,
    limit,
  };
}

/**
 * A report published before per-asset rows existed has findings with evidence
 * and nothing else. Rather than 404 a client out of their own report, the
 * sample is shown as the population, and the page is honest about it by way of
 * the counts — which come from the rows, so a twenty-five-row page of a
 * forty-row finding says twenty-five.
 *
 * Republishing fixes it, and the next run does that anyway.
 */
function rowsOf(finding: SavingsFinding): FindingRow[] {
  return finding.rows ?? [];
}

/**
 * Record decisions, in bulk, without ever overwriting one.
 *
 * Bulk because that is how the work is done — filter to high-confidence
 * disposals over $10,000, accept the twenty in front of you — and because
 * twenty round trips would make this slower than the spreadsheet it replaces
 * and could leave the batch half applied.
 */
export async function decideFindingRows(
  engagementId: string,
  request: DecideFindingRowsRequest,
  filters: FindingRowFilters = EMPTY_FILTERS,
): Promise<FindingRowPage> {
  const viewer = await currentViewer();
  const published = await publishedReport(engagementId);
  const report = published.report as SavingsReport | null;
  const finding = report?.findings.find((item) => item.key === request.findingKey) ?? null;
  if (!finding) throw new HttpError(404, 'That finding is not on the published report.');

  const byAsset = new Map(rowsOf(finding).map((row) => [row.assetId, row]));
  const unknown = request.assetIds.filter((id) => !byAsset.has(id));
  if (unknown.length > 0) {
    // Not a 404: the ids are real assets, they are just not under this finding.
    // Saying so plainly is better than recording a decision about a row the
    // client was never shown.
    throw new HttpError(
      400,
      `${unknown.length} of those assets are not on this finding. Reload the page and try again.`,
    );
  }

  const db = requireDb();
  await db.insert(schema.findingRowDecisions).values(
    request.assetIds.map((assetId) => {
      const row = byAsset.get(assetId)!;
      return {
        engagementId,
        source: request.source,
        findingKey: request.findingKey,
        assetId,
        status: request.status ?? CLEARED,
        note: request.note ?? null,
        decidedBy: viewer?.email ?? null,
        decidedByAudience: viewer?.audience ?? null,
        decidedValue: row.valueRemoved,
        decidedTaxAtRisk: row.taxAtRisk,
        // Stamped from the row as it was on screen. A label recorded against
        // weights nobody can reconstruct teaches nothing later.
        confidenceTier: row.confidence.tier,
        confidenceScore: row.confidence.score,
        signals: row.confidence.signals,
        decidedRunId: published.runId,
      };
    }),
  );

  // The whole page back rather than the rows that changed: accepting twenty
  // rows moves every total on the screen, and re-fetching to learn that is a
  // round trip for something the write already knew.
  return loadFindingRows(engagementId, request.findingKey, filters);
}

const EMPTY_FILTERS: FindingRowFilters = {
  confidence: [],
  locations: [],
  costCenters: [],
  categories: [],
  acquiredFrom: null,
  acquiredTo: null,
  costMin: null,
  costMax: null,
  evidence: 'any',
  dispositions: [],
  reviewers: [],
  query: '',
};

/**
 * The filter, read off a query string.
 *
 * Both routes parse it the same way, because a decision has to come back
 * describing the same view the client was looking at when they made it — a
 * bulk accept that returned the unfiltered population would redraw the screen
 * around them at the moment they acted.
 *
 * Anything unparseable is dropped rather than rejected. A filter is a view, and
 * a stale link with a site id that no longer exists should show the report,
 * not an error.
 */
export function parseFilters(url: URL): FindingRowFilters {
  const list = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw
      ? raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
  };
  const num = (name: string) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw.trim() === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const tiers = list('confidence').filter(
    (v): v is 'high' | 'medium' | 'low' => v === 'high' || v === 'medium' || v === 'low',
  );
  const evidence = url.searchParams.get('evidence');
  const dispositions = list('dispositions').filter(
    (v): v is FindingRowFilters['dispositions'][number] =>
      v === 'accepted' || v === 'rejected' || v === 'pending-client' || v === 'undecided',
  );
  return {
    confidence: tiers,
    locations: list('locations'),
    costCenters: list('costCenters'),
    categories: list('categories'),
    acquiredFrom: num('acquiredFrom'),
    acquiredTo: num('acquiredTo'),
    costMin: num('costMin'),
    costMax: num('costMax'),
    evidence: evidence === 'present' || evidence === 'absent' ? evidence : 'any',
    dispositions,
    reviewers: list('reviewers'),
    query: url.searchParams.get('query') ?? '',
  };
}

/**
 * Every live decision on this engagement, across every finding.
 *
 * The per-finding query above cannot serve the queue: the queue is one ordering
 * over all twelve types, so "what is already settled" has to be asked once
 * rather than twelve times. Same append-only reading — newest record per
 * (finding, asset), with `cleared` read back as no decision at all.
 */
export async function allRowDecisions(
  engagementId: string,
  source = 'savings',
): Promise<QueueDecision[]> {
  const db = requireDb();
  const rows = await db
    .select({
      findingKey: schema.findingRowDecisions.findingKey,
      assetId: schema.findingRowDecisions.assetId,
      status: schema.findingRowDecisions.status,
    })
    .from(schema.findingRowDecisions)
    .where(
      and(
        eq(schema.findingRowDecisions.engagementId, engagementId),
        eq(schema.findingRowDecisions.source, source),
      ),
    )
    .orderBy(desc(schema.findingRowDecisions.decidedAt));

  const seen = new Set<string>();
  const out: QueueDecision[] = [];
  for (const row of rows) {
    const key = `${row.findingKey}:${row.assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.status === CLEARED) continue;
    out.push({
      findingKey: row.findingKey,
      assetId: row.assetId,
      status: row.status as FindingRowDecision['status'],
    });
  }
  return out;
}
