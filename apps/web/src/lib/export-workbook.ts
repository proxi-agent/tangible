import 'server-only';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import { appraisalDistrictName } from '@tangible/filing';
import type {
  ClassificationStatus,
  FindingRowFilters,
  FindingRowPage,
  Rendition,
} from '@tangible/types';
import {
  appraise,
  scheduleFor,
  type DepreciationSchedule,
  type LifeClass,
} from '@tangible/valuation';
import { lookupRate } from '@/lib/analysis';
import { loadFindingRows } from '@/lib/finding-rows';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { buildEngagementRendition } from '@/lib/rendition';
import { engagementReturns } from '@/lib/sites';
import { today } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export interface EngagementWorkbook {
  bytes: Buffer;
  filename: string;
}

/** Excel refuses sheet names over 31 chars or containing []:*?/\ — quietly fix both. */
function sheetName(raw: string): string {
  return (
    raw
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet'
  );
}

/**
 * A worksheet from rows of raw values, with dollar columns formatted as such.
 *
 * Values stay numbers — the whole point of handing over a spreadsheet is that
 * the client can sum it — and the format lives on the cell, so what they see
 * matches what the form prints without the cell becoming text.
 */
function sheet(
  rows: (string | number | null)[][],
  opts: { widths?: number[]; moneyCols?: number[] } = {},
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (opts.widths) ws['!cols'] = opts.widths.map((wch) => ({ wch }));
  for (const col of opts.moneyCols ?? []) {
    for (let r = 1; r < rows.length; r += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })] as XLSX.CellObject | undefined;
      if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
    }
  }
  return ws;
}

/** The blank spacer row between blocks on one sheet. */
const GAP: (string | number | null)[] = [];

/**
 * The engagement as a workbook: the schedules the form files, the per-asset
 * arithmetic behind them, and the findings that changed them.
 *
 * Everything is derived on read through the same builders the screens use —
 * `buildEngagementRendition` for the schedules, the valuation refusal order for
 * the assets — so the spreadsheet handed to a client can never disagree with
 * the workspace it came from. Blockers are printed on the summary rather than
 * suppressed: a workbook that hides "this form is not fileable yet" is how an
 * unfileable form gets filed.
 */
export async function buildEngagementWorkbook(engagementId: string): Promise<EngagementWorkbook> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const owed = await engagementReturns(engagementId);

  // One rendition per return the engagement owes; an unplaced register still
  // exports as the whole-register draft so the workbook is never empty.
  const targets: (string | null)[] =
    owed.returns.length > 0 ? owed.returns.map((r) => r.locationId) : [null];
  const renditions = await Promise.all(
    targets.map((locationId) =>
      buildEngagementRendition(engagementId, { basis: 'cost', filedByAgent: true, locationId }),
    ),
  );
  const siteLabel = (i: number) => owed.returns[i]?.label ?? 'All property';

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    summarySheet(engagement.taxYear, client.name, renditions, targets, siteLabel),
    'Summary',
  );

  renditions.forEach((rendition, i) => {
    const name =
      renditions.length > 1 ? sheetName(`Schedules — ${siteLabel(i)}`) : 'Form 50-144 schedules';
    XLSX.utils.book_append_sheet(wb, scheduleSheet(rendition), name);
  });

  XLSX.utils.book_append_sheet(wb, await assetSheet(engagementId), 'Assets');
  XLSX.utils.book_append_sheet(wb, findingsSheet(renditions, siteLabel), 'Findings');

  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const slug = client.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { bytes, filename: `${slug}-${engagement.taxYear}-rendition-workpapers.xlsx` };
}

function summarySheet(
  taxYear: number,
  clientName: string,
  renditions: Rendition[],
  targets: (string | null)[],
  siteLabel: (i: number) => string,
): XLSX.WorkSheet {
  const first = renditions[0]!;
  const rows: (string | number | null)[][] = [
    ['Rendition workpapers'],
    ['Client', clientName],
    ['Tax year', taxYear],
    ['Generated', today()],
    ['Basis', 'Original cost (Tax Code 22.01)'],
    GAP,
    ['Return', 'District', 'Account', 'Historical cost', 'Schedule value', 'Blockers'],
    ...renditions.map((r, i) => [
      targets[i] === null ? 'All property (no site placed yet)' : siteLabel(i),
      r.jurisdictionName ?? r.jurisdictionId ?? '—',
      r.accountId ?? '—',
      r.totalHistoricalCost,
      r.scheduleValue,
      r.blockers.filter((b) => b.severity === 'blocking').length,
    ]),
    GAP,
    ['Deadlines'],
    ...first.deadlines.map((d) => [d.label, d.date, d.basis]),
  ];

  const blockers = renditions.flatMap((r, i) =>
    r.blockers.map((b) => [
      renditions.length > 1 ? siteLabel(i) : null,
      b.severity,
      b.message,
      b.resolution,
    ]),
  );
  if (blockers.length > 0) {
    rows.push(GAP, ['Open blockers — settle these before any of this is filed']);
    rows.push(...(blockers as (string | number | null)[][]));
  }

  return sheet(rows, { widths: [34, 40, 18, 16, 16, 90], moneyCols: [3, 4] });
}

function scheduleSheet(rendition: Rendition): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    [
      `Form 50-144 — ${rendition.clientName}, tax year ${rendition.taxYear}`,
      null,
      null,
      null,
      null,
    ],
    [
      rendition.jurisdictionName ?? 'No appraisal district set',
      rendition.accountId ? `Account ${rendition.accountId}` : null,
      rendition.sicCode ? `SIC ${rendition.sicCode}` : null,
      null,
      null,
    ],
    GAP,
    ['Schedule', 'Property type', 'Year acquired', 'Historical cost', 'Assets'],
  ];

  for (const s of rendition.schedules) {
    if (s.lines.length === 0) continue;
    // The title is already "Schedule E — furniture, fixtures, ..." — no prefix.
    rows.push([s.title, null, null, null, null]);
    for (const line of s.lines) {
      rows.push([null, line.type, line.yearAcquired, line.historicalCost, line.assetCount]);
    }
    rows.push([null, 'Total', null, s.totalCost, null]);
  }

  rows.push(GAP, ['Total historical cost', null, null, rendition.totalHistoricalCost, null]);
  rows.push([
    'Schedule value (what the district’s tables produce — not filed as an estimate)',
    null,
    null,
    rendition.scheduleValue,
    null,
  ]);

  if (rendition.exclusions.length > 0) {
    rows.push(GAP, ['Left off the form on purpose']);
    rows.push(['Category', 'Reason', null, 'Original cost', 'Assets']);
    for (const x of rendition.exclusions) {
      rows.push([x.label, x.reason, null, x.originalCost, x.assetCount]);
    }
  }

  return sheet(rows, { widths: [44, 60, 13, 16, 8], moneyCols: [3] });
}

/**
 * Every asset on the current register, through the same refusal order the
 * valuation tab applies — one row each, valued or with the reason it is not.
 */
async function assetSheet(engagementId: string): Promise<XLSX.WorkSheet> {
  const { engagement } = await fetchEngagement(engagementId);
  const db = requireDb();
  const rows = await db
    .select({
      version: schema.assetVersions,
      locationId: schema.assets.locationId,
      classification: schema.assetClassifications,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId))
    .orderBy(schema.assetVersions.sourceRow);

  const locations = new Map(
    (
      await db
        .select()
        .from(schema.clientLocations)
        .where(eq(schema.clientLocations.clientId, engagement.clientId))
    ).map((l) => [l.id, l]),
  );

  const schedules = new Map<string, DepreciationSchedule | null>();
  const rates = new Map<string, number>();
  const scheduleAt = (jurisdictionId: string): DepreciationSchedule | null => {
    if (!schedules.has(jurisdictionId)) {
      schedules.set(jurisdictionId, scheduleFor(jurisdictionId, engagement.taxYear) ?? null);
    }
    return schedules.get(jurisdictionId)!;
  };
  const rateAt = async (jurisdictionId: string): Promise<number> => {
    if (!rates.has(jurisdictionId)) rates.set(jurisdictionId, await lookupRate(jurisdictionId));
    return rates.get(jurisdictionId)!;
  };

  const out: (string | number | null)[][] = [
    [
      'Row',
      'Tag',
      'Description',
      'Site',
      'Category',
      'Acquired',
      'Original cost',
      'Status',
      'Life (yrs)',
      'Index factor',
      'Percent good',
      'Market value',
      'Est. tax',
    ],
  ];

  for (const { version: v, locationId, classification: c } of rows) {
    const location = locationId ? locations.get(locationId) : undefined;
    const jurisdictionId = location?.jurisdictionId ?? engagement.jurisdictionId;
    const base: (string | number | null)[] = [
      v.sourceRow + 1,
      v.assetTag,
      v.description,
      location?.label ?? null,
      c?.categoryKey ? classificationLabel(c.categoryKey) : null,
      v.acquisitionYear,
      v.originalCost,
    ];
    const refuse = (status: string) => out.push([...base, status, null, null, null, null, null]);

    if (v.isDisposed) {
      refuse('Disposed — off the return');
      continue;
    }
    if (!c) {
      refuse('Unclassified');
      continue;
    }
    if (!isValuable({ categoryKey: c.categoryKey, status: c.status as ClassificationStatus })) {
      refuse('Awaiting review');
      continue;
    }
    const categoryKey = c.categoryKey!;
    if (isExclusion(categoryKey)) {
      refuse(`Excluded — ${classificationLabel(categoryKey)}`);
      continue;
    }
    const schedule = jurisdictionId ? scheduleAt(jurisdictionId) : null;
    if (!schedule) {
      refuse('No published schedule');
      continue;
    }
    const appraisal = appraise(
      {
        originalCost: v.originalCost ?? Number.NaN,
        acquisitionYear: v.acquisitionYear ?? Number.NaN,
        categoryKey,
        lifeClassOverride: (c.lifeClassOverride ?? undefined) as LifeClass | undefined,
        businessSic: engagement.sicCode,
      },
      schedule,
    );
    if (!appraisal.ok) {
      refuse(appraisal.gap.detail);
      continue;
    }
    const rate = await rateAt(jurisdictionId!);
    out.push([
      ...base,
      appraisal.value.atFloor ? 'Valued (at floor)' : 'Valued',
      typeof appraisal.value.schedule === 'number' ? appraisal.value.schedule : null,
      appraisal.value.indexFactor,
      appraisal.value.percentGood / 100,
      appraisal.value.marketValue,
      appraisal.value.marketValue * rate,
    ]);
  }

  const ws = sheet(out, {
    widths: [6, 12, 44, 22, 26, 9, 14, 30, 9, 11, 12, 14, 12],
    moneyCols: [6, 11, 12],
  });
  // Percent good arrives as a whole number from the tables; exported as a
  // fraction with a percent format so Excel arithmetic on the column is sane.
  for (let r = 1; r < out.length; r += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 10 })] as XLSX.CellObject | undefined;
    if (cell && typeof cell.v === 'number') cell.z = '0%';
  }
  return ws;
}

function findingsSheet(renditions: Rendition[], siteLabel: (i: number) => string): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    [
      'Committed findings and what each did to the form. "No change" is an answer, not an omission — most accepted findings describe property the register already keeps off the return.',
    ],
    GAP,
    [
      ...(renditions.length > 1 ? ['Return'] : []),
      'Finding',
      'Source',
      'Decision',
      'Decided by',
      'Claimed cost',
      'Removed cost',
      'Assets removed',
      'Effect on the form',
    ],
  ];
  const money = renditions.length > 1 ? [5, 6] : [4, 5];

  // The committed findings are engagement-level; each rendition replays them
  // against its own slice of the register. When every return reports the same
  // numbers and effect for a finding, one row says so — printing it per return
  // would double the "Claimed cost" column the moment someone sums it.
  const byFinding = new Map<string, { rows: (string | number | null)[][]; sites: string[] }>();
  const order: string[] = [];
  renditions.forEach((rendition, i) => {
    for (const d of rendition.decisions) {
      const body: (string | number | null)[] = [
        d.title,
        d.source,
        d.status ?? 'undecided',
        d.decidedBy ?? '—',
        d.cost,
        d.removedCost,
        d.removedAssetCount,
        d.effectOnForm,
      ];
      const key = `${d.source}|${d.key}`;
      if (!byFinding.has(key)) {
        byFinding.set(key, { rows: [], sites: [] });
        order.push(key);
      }
      const entry = byFinding.get(key)!;
      entry.rows.push(body);
      entry.sites.push(siteLabel(i));
    }
  });

  let any = false;
  for (const key of order) {
    const { rows: bodies, sites } = byFinding.get(key)!;
    const identical = bodies.every((b) => JSON.stringify(b) === JSON.stringify(bodies[0]));
    if (identical) {
      any = true;
      rows.push([...(renditions.length > 1 ? ['All returns'] : []), ...bodies[0]!]);
    } else {
      for (let i = 0; i < bodies.length; i += 1) {
        any = true;
        rows.push([...(renditions.length > 1 ? [sites[i]!] : []), ...bodies[i]!]);
      }
    }
  }
  if (!any) {
    rows.push(['No findings have been committed for this engagement yet.']);
  }

  return sheet(rows, {
    widths:
      renditions.length > 1 ? [22, 40, 14, 12, 18, 13, 13, 8, 80] : [40, 14, 12, 18, 13, 13, 8, 80],
    moneyCols: money,
  });
}

// ---------------------------------------------------------------------------
// One finding, as the client filtered it
// ---------------------------------------------------------------------------

/**
 * The rows a controller is looking at right now, as a working paper.
 *
 * The engagement workbook above is the whole file. This is narrower and, for
 * the person doing the reviewing, more useful: the population they filtered to,
 * the decisions they have made on it, and — printed at the top rather than
 * assumed — *which filter produced this list*. A workpaper that shows sixty
 * rows without saying they are the high-confidence ones over $10,000 at the
 * Houston site is a workpaper nobody can tie back to anything.
 *
 * It runs from `loadFindingRows` unpaged, so the spreadsheet and the screen are
 * the same selection read twice rather than two implementations of one filter.
 */
export async function buildFindingRowsWorkbook(
  engagementId: string,
  findingKey: string,
  filters: FindingRowFilters,
): Promise<EngagementWorkbook> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const page = await loadFindingRows(engagementId, findingKey, filters, { all: true });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, reviewSheet(page, client.name, engagement.taxYear), 'Review');
  XLSX.utils.book_append_sheet(wb, detectionSheet(page), 'How it was found');

  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const slug = `${client.name} ${findingKey}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { bytes, filename: `${slug}-${engagement.taxYear}-review.xlsx` };
}

const KIND_TEXT: Record<FindingRowPage['kind'], string> = {
  measured: 'Measured from the register',
  modeled: 'Rests on an assumption',
  screening: 'Needs an answer from the client',
};

const DISPOSITION_TEXT: Record<string, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  'pending-client': 'Need more information',
};

/**
 * What the filter was, in a sentence a reader can check.
 *
 * Deliberately written from the labels the screen showed rather than the ids it
 * sent: `Houston plant` and not a uuid, because the point is that somebody can
 * read this next April and know what they were looking at.
 */
function filterLines(page: FindingRowPage, filters: FindingRowFilters): string[] {
  const lines: string[] = [];
  const label = (id: string) =>
    id === 'unplaced'
      ? 'no site recorded'
      : (page.facets.locations.find((l) => l.id === id)?.label ?? id);

  if (filters.confidence.length > 0) lines.push(`Confidence: ${filters.confidence.join(', ')}`);
  if (filters.locations.length > 0)
    lines.push(`Location: ${filters.locations.map(label).join(', ')}`);
  if (filters.costCenters.length > 0) lines.push(`Cost centre: ${filters.costCenters.join(', ')}`);
  if (filters.categories.length > 0)
    lines.push(
      `Asset class: ${filters.categories
        .map((key) => page.facets.categories.find((c) => c.key === key)?.label ?? key)
        .join(', ')}`,
    );
  if (filters.acquiredFrom !== null || filters.acquiredTo !== null)
    lines.push(`Acquired: ${filters.acquiredFrom ?? 'any'} to ${filters.acquiredTo ?? 'any'}`);
  if (filters.costMin !== null || filters.costMax !== null)
    lines.push(
      `Original cost: ${filters.costMin === null ? 'any' : `$${filters.costMin.toLocaleString()}`} to ${
        filters.costMax === null ? 'any' : `$${filters.costMax.toLocaleString()}`
      }`,
    );
  if (filters.evidence !== 'any')
    lines.push(
      filters.evidence === 'present'
        ? 'Only rows with something to check against a document'
        : 'Only rows with nothing to check against a document',
    );
  if (filters.dispositions.length > 0) lines.push(`Decision: ${filters.dispositions.join(', ')}`);
  if (filters.reviewers.length > 0) lines.push(`Decided by: ${filters.reviewers.join(', ')}`);
  if (filters.query.trim() !== '') lines.push(`Search: “${filters.query.trim()}”`);

  return lines.length > 0 ? lines : ['No filter — every row on this finding.'];
}

function reviewSheet(page: FindingRowPage, clientName: string, taxYear: number): XLSX.WorkSheet {
  const filters = page.appliedFilters;
  const rows: (string | number | null)[][] = [
    [page.title],
    [`${clientName} · ${taxYear} · ${KIND_TEXT[page.kind]}`],
    [page.summary],
    GAP,
    ['What this list is'],
    ...filterLines(page, filters).map((line) => [line]),
    GAP,
    ['', 'Rows', 'Original cost', 'Value off the return', 'Tax a year'],
    [
      'This list',
      page.filtered.rows,
      page.filtered.originalCost,
      page.filtered.valueRemoved,
      page.filtered.taxAtRisk,
    ],
    [
      'The whole finding',
      page.population.rows,
      page.population.originalCost,
      page.population.valueRemoved,
      page.population.taxAtRisk,
    ],
  ];
  if (page.filtered.unpricedRows > 0) {
    rows.push([
      `${page.filtered.unpricedRows} of these rows cannot be priced yet — they are counted above but contribute nothing to the dollars.`,
    ]);
  }
  rows.push(GAP);
  rows.push([
    page.publishedAt
      ? `From the report published ${page.publishedAt.slice(0, 10)}. Tax at ${(page.blendedTaxRate * 100).toFixed(2)}%${
          page.jurisdictionName ? `, the blended rate for ${page.jurisdictionName}` : ''
        }.`
      : 'From the current report.',
  ]);
  rows.push(GAP);

  const header = [
    'Asset',
    'Description',
    'Asset class',
    'Location',
    'Cost centre',
    'Acquired',
    'Original cost',
    'Assessed as filed',
    'Corrected value',
    'Value off the return',
    'Tax a year',
    'Expected recovery',
    'Confidence',
    'Score',
    'Evidence',
    'Why it was flagged',
    'Decision',
    'Note',
    'Decided by',
    'Decided',
  ];
  const headerAt = rows.length;
  rows.push(header);

  for (const { row, decision } of page.rows) {
    rows.push([
      row.assetTag ?? '',
      row.description ?? '',
      row.categoryLabel ?? '',
      row.siteLabel ?? '',
      row.costCenter ?? '',
      row.acquisitionYear,
      row.originalCost,
      row.assessedAsFiled,
      row.correctedValue,
      row.valueRemoved,
      row.taxAtRisk,
      // Phase 3 prices this. Blank rather than zero: nobody should sum a
      // column of noughts and conclude the recovery is nothing.
      row.expectedRecovery ?? 'Pending',
      row.confidence.tier,
      row.confidence.score,
      row.evidencePresent ? 'Yes' : 'No',
      row.confidence.why,
      decision ? (DISPOSITION_TEXT[decision.status] ?? decision.status) : 'Not decided',
      decision?.note ?? '',
      decision?.decidedBy ?? '',
      decision?.decidedAt?.slice(0, 10) ?? '',
    ]);
  }
  if (page.rows.length === 0) {
    rows.push(['Nothing on this finding matches that filter.']);
  }

  const ws = sheet(rows, {
    widths: [16, 44, 22, 20, 16, 10, 14, 16, 15, 18, 13, 16, 12, 8, 10, 70, 16, 40, 22, 12],
  });
  // Money formatting starts at the table header, not at row 1 — the summary
  // block above it has dollars in different columns, so it gets its own pass.
  for (const [r, cols] of [
    [headerAt - 4, [2, 3, 4]],
    [headerAt - 3, [2, 3, 4]],
  ] as [number, number[]][]) {
    for (const c of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
    }
  }
  for (let r = headerAt + 1; r < rows.length; r += 1) {
    for (const c of [6, 7, 8, 9, 10, 11]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
    }
  }
  return ws;
}

/**
 * The detection basis: which signals fired, over how many assets.
 *
 * On its own sheet because it answers a different question from the table — not
 * "which of my assets" but "how did you decide these were the ones" — and
 * because it is the part a client's auditor asks about.
 */
function detectionSheet(page: FindingRowPage): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [['How these assets were found'], [page.basis]];
  if (page.assumption) rows.push([page.assumption]);
  rows.push(GAP);
  rows.push(['Signal', 'Assets', 'Original cost']);
  for (const signal of page.detection) {
    rows.push([signal.label, signal.assetCount, signal.originalCost]);
  }
  if (page.detection.length === 0) {
    rows.push(['This report predates per-signal recording. Re-run the analysis to populate it.']);
  }
  rows.push(GAP);
  rows.push(['Confidence across the whole finding']);
  rows.push(['High', page.confidenceMix.high]);
  rows.push(['Medium', page.confidenceMix.medium]);
  rows.push(['Low', page.confidenceMix.low]);

  return sheet(rows, { widths: [60, 12, 16], moneyCols: [2] });
}
