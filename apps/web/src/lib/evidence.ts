import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { dateValue, numberValue, parseWorkbook, summarizeWorkbook, textValue } from '@tangible/far';
import { CATEGORY_BY_KEY } from '@tangible/valuation';
import {
  EVIDENCE_SOURCES,
  EMPTY_COLUMN_MAP,
  gatherAll,
  mappingIsUsable,
  proposeColumns,
  sourcesFor,
  type EvidenceColumnMap,
  type EvidenceResult,
  type EvidenceSourceKind,
  type ExternalRecord,
  type RegisterSubject,
  type SourceExport,
} from '@tangible/evidence';
import {
  EvidenceColumnMapSchema,
  type AssetEvidence,
  type EvidenceBoard,
  type EvidenceCoverage,
  type EvidenceExport,
  type SheetSummary,
} from '@tangible/types';
import { HttpError } from '@/lib/route';
import { downloadFarFile, removeFarFiles, uploadFarFile } from '@/lib/far-storage';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * External evidence, from a file somebody exported to a signal on a finding.
 *
 * The pipeline is deliberately the register's pipeline with the AI taken out:
 * store the original first, parse it, propose a mapping, let a person confirm
 * it, then read the rows under the confirmed mapping and nothing else. Same
 * ordering, same failure posture — a file that will not parse is still kept and
 * still visible with the reason — and the same rule that no import happens on a
 * mapping a human did not look at.
 *
 * What is *not* the same is where the caution sits. A register mapped wrong
 * produces obviously wrong numbers. An evidence export mapped wrong produces
 * something far worse: a source that appears to have been searched and to have
 * found nothing, which is a manufactured negative statement about a client's
 * property. That is why `mappingIsUsable` refuses a mapping with no identifier
 * and no description at the door, and why an export is not consulted at all
 * until its status is `imported`.
 */

const EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xlsm', '.xls'];
const MAX_BYTES = 60 * 1024 * 1024;
/** Records held per export. A file larger than this is a database, not an export. */
const MAX_RECORDS = 250_000;

export interface EvidenceUpload {
  filename: string;
  bytes: Uint8Array;
  contentType: string | null;
}

function exportDto(row: typeof schema.evidenceExports.$inferSelect): EvidenceExport {
  return {
    id: row.id,
    engagementId: row.engagementId,
    kind: row.kind as EvidenceSourceKind,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    contentType: row.contentType,
    sheetSummaries: (row.sheetSummaries as SheetSummary[] | null) ?? null,
    sheetName: row.sheetName,
    headerRow: row.headerRow,
    proposedColumns: (row.proposedColumns as EvidenceColumnMap | null) ?? null,
    confirmedColumns: (row.confirmedColumns as EvidenceColumnMap | null) ?? null,
    status: row.status as EvidenceExport['status'],
    error: row.error,
    recordCount: row.recordCount,
    skippedCount: row.skippedCount,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function isEvidenceKind(value: string): value is EvidenceSourceKind {
  return value in EVIDENCE_SOURCES;
}

/**
 * An export enters: stored, parsed, and mapped as far as the header allows.
 *
 * The proposal runs against the largest sheet, which is the right guess for a
 * system export and is only ever a guess — the confirm step takes a sheet name
 * of its own, and a workbook whose second tab is the data is a normal thing for
 * a broker to send.
 */
export async function ingestEvidence(
  engagementId: string,
  kind: EvidenceSourceKind,
  upload: EvidenceUpload,
  uploadedBy: string | null,
): Promise<EvidenceExport> {
  if (upload.bytes.byteLength === 0) throw new HttpError(400, 'The uploaded file is empty.');
  if (upload.bytes.byteLength > MAX_BYTES) {
    throw new HttpError(
      400,
      `File is ${(upload.bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }
  const dot = upload.filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : upload.filename.slice(dot).toLowerCase();
  if (!EXTENSIONS.includes(extension)) {
    throw new HttpError(
      400,
      `Unsupported file type "${extension || upload.filename}" — accepted: ${EXTENSIONS.join(', ')}.`,
    );
  }

  const id = randomUUID();
  const safeName = upload.filename.replace(/[^\w.-]+/g, '_');
  const storagePath = `${engagementId}/evidence/${id}/${safeName}`;
  await uploadFarFile(storagePath, upload.bytes, upload.contentType);

  let sheetSummaries: SheetSummary[] | null = null;
  let sheetName: string | null = null;
  let headerRow: number | null = null;
  let proposedColumns: EvidenceColumnMap | null = null;
  let status = 'parsed';
  let error: string | null = null;

  try {
    const workbook = parseWorkbook(upload.bytes);
    sheetSummaries = summarizeWorkbook(workbook);
    if (sheetSummaries.length === 0) throw new Error('The file contains no sheets.');
    const biggest = [...sheetSummaries].sort((a, b) => b.rowCount - a.rowCount)[0]!;
    sheetName = biggest.name;
    headerRow = biggest.detectedHeaderRow;
    if (headerRow !== null) {
      const sheet = workbook.sheets.find((s) => s.name === biggest.name)!;
      proposedColumns = proposeColumns(sheet.matrix[headerRow] ?? []);
    }
  } catch (cause) {
    status = 'failed';
    error = cause instanceof Error ? cause.message : String(cause);
    sheetSummaries = null;
  }

  const db = requireDb();
  const [row] = await db
    .insert(schema.evidenceExports)
    .values({
      id,
      engagementId,
      kind,
      originalFilename: upload.filename,
      storagePath,
      byteSize: upload.bytes.byteLength,
      checksum: createHash('sha256').update(upload.bytes).digest('hex'),
      contentType: upload.contentType,
      sheetSummaries,
      sheetName,
      headerRow,
      proposedColumns,
      status,
      error,
      uploadedBy,
    })
    .returning();

  return exportDto(row!);
}

export interface EvidenceConfirmation {
  sheetName: string;
  headerRow: number;
  columns: EvidenceColumnMap;
}

/**
 * Read the file under the mapping a person confirmed, and keep the rows.
 *
 * Re-importing replaces every record rather than adding to them. An export is a
 * snapshot of another system on a day; two snapshots merged would double the
 * `searched` count that every negative statement rests on, and would let a
 * record deleted from the source system keep clearing an asset forever.
 */
export async function confirmEvidence(
  exportId: string,
  confirmation: EvidenceConfirmation,
): Promise<EvidenceExport> {
  const db = requireDb();
  const [found] = await db
    .select()
    .from(schema.evidenceExports)
    .where(eq(schema.evidenceExports.id, exportId));
  if (!found) throw new HttpError(404, 'No such evidence export.');

  const columns = EvidenceColumnMapSchema.parse(confirmation.columns);
  if (!mappingIsUsable(columns)) {
    throw new HttpError(
      400,
      'Map at least one of asset tag, serial, model or description. Without one of those there is ' +
        'nothing a register row could be compared against, and importing the file would make every ' +
        'covered asset look searched-for and not found.',
    );
  }

  const bytes = await downloadFarFile(found.storagePath);
  const workbook = parseWorkbook(bytes);
  const sheet = workbook.sheets.find((s) => s.name === confirmation.sheetName);
  if (!sheet) throw new HttpError(400, `The file has no sheet named "${confirmation.sheetName}".`);

  const cell = (row: unknown[], column: number | null): unknown =>
    column === null ? null : (row[column] ?? null);

  const records: Array<typeof schema.evidenceRecords.$inferInsert> = [];
  let skipped = 0;
  for (let i = confirmation.headerRow + 1; i < sheet.matrix.length; i++) {
    const row = sheet.matrix[i] ?? [];
    const record = {
      exportId,
      sourceRow: i,
      assetTag: textValue(cell(row, columns.assetTag)),
      serial: textValue(cell(row, columns.serial)),
      model: textValue(cell(row, columns.model)),
      description: textValue(cell(row, columns.description)),
      amount: numberValue(cell(row, columns.amount)),
      // A last-seen date is evidence of *when*, so a cell that does not parse
      // as a date is dropped rather than kept as text. "Yes" is not a date.
      lastSeenOn: dateValue(cell(row, columns.lastSeenOn)).date,
    };
    // Nothing to match on: a blank row, a total line, a page break.
    if (!record.assetTag && !record.serial && !record.model && !record.description) {
      skipped += 1;
      continue;
    }
    records.push(record);
    if (records.length > MAX_RECORDS) {
      throw new HttpError(
        400,
        `This sheet carries more than ${MAX_RECORDS.toLocaleString()} matchable rows. Export a filtered extract — active assets, or the last few years of work orders.`,
      );
    }
  }

  await db.delete(schema.evidenceRecords).where(eq(schema.evidenceRecords.exportId, exportId));
  // Chunked: a single insert of a hundred thousand rows exceeds the parameter
  // limit the driver will bind, and fails on the whole file rather than on the
  // row that caused it.
  for (let i = 0; i < records.length; i += 1_000) {
    await db.insert(schema.evidenceRecords).values(records.slice(i, i + 1_000));
  }

  const [updated] = await db
    .update(schema.evidenceExports)
    .set({
      sheetName: confirmation.sheetName,
      headerRow: confirmation.headerRow,
      confirmedColumns: columns,
      status: records.length > 0 ? 'imported' : 'failed',
      error:
        records.length > 0
          ? null
          : 'No row under this mapping carried an identifier or a description.',
      recordCount: records.length,
      skippedCount: skipped,
      updatedAt: new Date(),
    })
    .where(eq(schema.evidenceExports.id, exportId))
    .returning();

  return exportDto(updated!);
}

export async function removeEvidence(exportId: string): Promise<{ id: string }> {
  const db = requireDb();
  const [found] = await db
    .select()
    .from(schema.evidenceExports)
    .where(eq(schema.evidenceExports.id, exportId));
  if (!found) throw new HttpError(404, 'No such evidence export.');
  await db.delete(schema.evidenceExports).where(eq(schema.evidenceExports.id, exportId));
  await removeFarFiles([found.storagePath]);
  return { id: exportId };
}

/**
 * Every imported export on an engagement, as the matcher wants them.
 *
 * Returns only `imported` exports. A parsed-but-unconfirmed upload is a file
 * somebody has not finished mapping, and treating it as a searched source would
 * be the manufactured negative this module exists to prevent.
 */
export async function loadSourceExports(engagementId: string): Promise<SourceExport[]> {
  const db = requireDb();
  const exports = await db
    .select()
    .from(schema.evidenceExports)
    .where(eq(schema.evidenceExports.engagementId, engagementId));
  const imported = exports.filter((row) => row.status === 'imported');
  if (imported.length === 0) return [];

  const records = await db
    .select()
    .from(schema.evidenceRecords)
    .where(
      inArray(
        schema.evidenceRecords.exportId,
        imported.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.evidenceRecords.exportId), asc(schema.evidenceRecords.sourceRow));

  const byExport = new Map<string, ExternalRecord[]>();
  for (const record of records) {
    const list = byExport.get(record.exportId) ?? [];
    list.push({
      recordId: record.id,
      assetTag: record.assetTag,
      serial: record.serial,
      model: record.model,
      description: record.description,
      amount: record.amount,
      lastSeenOn: record.lastSeenOn,
    });
    byExport.set(record.exportId, list);
  }

  /**
   * Two exports of the same kind become one source, and that is the only
   * correct reading. A firm that uploads last quarter's work orders and this
   * quarter's has one maintenance system, not two; leaving them separate would
   * let a single system produce two matches for one asset and outvote every
   * other source, and would make `searched` — the number under every negative
   * statement — read as the smaller of the two files rather than the whole.
   */
  const bySource = new Map<EvidenceSourceKind, ExternalRecord[]>();
  for (const row of imported) {
    const kind = row.kind as EvidenceSourceKind;
    bySource.set(kind, [...(bySource.get(kind) ?? []), ...(byExport.get(row.id) ?? [])]);
  }
  return [...bySource].map(([kind, records]) => ({ kind, records }));
}

/** The register side of a match, from the assets the analysis already loaded. */
export function subjectsFrom(
  assets: ReadonlyArray<{
    id: string;
    assetTag?: string | null;
    serialNumber?: string | null;
    description: string | null;
    originalCost: number | null;
    categoryKey: string | null;
  }>,
): RegisterSubject[] {
  return assets.map((asset) => ({
    assetId: asset.id,
    assetTag: asset.assetTag ?? null,
    serial: asset.serialNumber ?? null,
    /**
     * No register this product has seen carries a model column, so the
     * model-and-cost method is unreachable from here today. It stays in the
     * matcher because the *sources* carry models and a register mapping may
     * yet gain one; what it must not do is quietly become the description.
     */
    model: null,
    description: asset.description,
    originalCost: asset.originalCost,
    categoryKey: asset.categoryKey,
  }));
}

export async function evidenceFor(
  engagementId: string,
  assets: Parameters<typeof subjectsFrom>[0],
): Promise<EvidenceResult[]> {
  const exports = await loadSourceExports(engagementId);
  if (exports.length === 0) return [];
  return gatherAll(subjectsFrom(assets), exports);
}

/**
 * What the exports on this engagement cover, measured against the register.
 *
 * Coverage is by category, because scope is by category: an export's reach is
 * decided by what kind of property it is a system for, not by how many rows it
 * has. The blind spots are the actionable half — they name the categories where
 * no uploaded source can ever speak, which is the list of files still worth
 * asking the client for.
 */
export function coverageOf(
  results: readonly EvidenceResult[],
  assets: ReadonlyArray<{ id: string; categoryKey: string | null }>,
): EvidenceCoverage {
  const byAsset = new Map(results.map((result) => [result.assetId, result]));
  const blind = new Map<string, number>();
  let covered = 0;
  let matched = 0;
  let denied = 0;

  for (const asset of assets) {
    const result = byAsset.get(asset.id);
    const hasSource =
      result !== undefined && (result.matches.length > 0 || result.negatives.length > 0);
    if (hasSource) {
      covered += 1;
      if (result.matches.length > 0) matched += 1;
      else denied += 1;
      continue;
    }
    const key = asset.categoryKey;
    if (key !== null) blind.set(key, (blind.get(key) ?? 0) + 1);
  }

  return {
    assetCount: assets.length,
    coveredCount: covered,
    matchedCount: matched,
    deniedCount: denied,
    blindSpots: [...blind]
      .map(([categoryKey, assetCount]) => ({
        categoryKey,
        label: CATEGORY_BY_KEY[categoryKey]?.label ?? categoryKey,
        assetCount,
      }))
      .sort((a, b) => b.assetCount - a.assetCount),
  };
}

export async function evidenceBoard(engagementId: string): Promise<EvidenceBoard> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.evidenceExports)
    .where(eq(schema.evidenceExports.engagementId, engagementId))
    .orderBy(asc(schema.evidenceExports.createdAt));

  const assets = await loadCoverageAssets(engagementId);
  if (assets.length === 0) {
    return {
      engagementId,
      exports: rows.map(exportDto),
      coverage: null,
      note: 'Coverage is measured against settled, taxable assets, and this engagement has none yet.',
    };
  }

  const results = await evidenceFor(engagementId, assets);
  return {
    engagementId,
    exports: rows.map(exportDto),
    coverage: coverageOf(results, assets),
    note: null,
  };
}

/**
 * The assets coverage is measured against: settled and still on the books.
 *
 * The same population the report values. Measuring against every row in the
 * register would count assets already in the review queue and assets already
 * disposed of, and would make coverage look worse the more work a firm had
 * done — which is the wrong direction for a number meant to say what is left to
 * collect.
 */
async function loadCoverageAssets(
  engagementId: string,
): Promise<
  Array<{
    id: string;
    assetTag: string | null;
    serialNumber: string | null;
    description: string | null;
    originalCost: number | null;
    categoryKey: string | null;
  }>
> {
  const db = requireDb();
  const rows = await db
    .select({
      assetId: schema.assetVersions.assetId,
      assetTag: schema.assetVersions.assetTag,
      serialNumber: schema.assetVersions.serialNumber,
      description: schema.assetVersions.description,
      originalCost: schema.assetVersions.originalCost,
      isDisposed: schema.assetVersions.isDisposed,
      categoryKey: schema.assetClassifications.categoryKey,
      status: schema.assetClassifications.status,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

  return rows
    .filter((row) => !row.isDisposed && row.status === 'confirmed' && row.categoryKey !== null)
    .map((row) => ({
      id: row.assetId,
      assetTag: row.assetTag,
      serialNumber: row.serialNumber,
      description: row.description,
      originalCost: row.originalCost,
      categoryKey: row.categoryKey,
    }));
}

/**
 * One asset's evidence, in the words each source uses about itself.
 *
 * The screen version carries `silent` in full, which the matcher's output only
 * carries as source kinds. An operator looking at a desk needs to be told that
 * the maintenance system was never going to answer for it — otherwise the empty
 * row reads as a system that was asked and had nothing.
 */
export async function assetEvidence(engagementId: string, assetId: string): Promise<AssetEvidence> {
  const db = requireDb();
  const [row] = await db
    .select({
      assetId: schema.assetVersions.assetId,
      assetTag: schema.assetVersions.assetTag,
      serialNumber: schema.assetVersions.serialNumber,
      description: schema.assetVersions.description,
      originalCost: schema.assetVersions.originalCost,
      categoryKey: schema.assetClassifications.categoryKey,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(and(engagementAssetsWhere(engagementId), eq(schema.assetVersions.assetId, assetId)));

  const empty: AssetEvidence = { assetId, matches: [], negatives: [], silent: [] };
  if (!row) return empty;

  const exports = await loadSourceExports(engagementId);
  if (exports.length === 0) return empty;

  const [result] = gatherAll(subjectsFrom([{ ...row, id: row.assetId }]), exports);
  if (!result) return empty;

  // Which uploaded file a record came from, so a match can be traced to it.
  const files = new Map(
    (
      await db
        .select({
          id: schema.evidenceExports.id,
          name: schema.evidenceExports.originalFilename,
          kind: schema.evidenceExports.kind,
        })
        .from(schema.evidenceExports)
        .where(eq(schema.evidenceExports.engagementId, engagementId))
    ).map((file) => [file.kind, file] as const),
  );

  return {
    assetId,
    matches: result.matches.map((match) => {
      const file = files.get(match.source);
      return {
        source: match.source,
        sourceLabel: EVIDENCE_SOURCES[match.source].label,
        method: match.method,
        score: match.score,
        on: match.on,
        lastSeenOn: match.lastSeenOn,
        affirms: EVIDENCE_SOURCES[match.source].affirms,
        exportId: file?.id ?? null,
        filename: file?.name ?? null,
      };
    }),
    negatives: result.negatives.map((negative) => ({
      source: negative.source,
      sourceLabel: EVIDENCE_SOURCES[negative.source].label,
      statement: negative.statement,
      searched: negative.searched,
    })),
    silent: result.silent.map((source) => ({
      source,
      note: `${EVIDENCE_SOURCES[source].label} does not cover this kind of asset, so it was not searched and its silence means nothing.`,
    })),
  };
}

/**
 * The sources that could speak to a category but have not been uploaded.
 *
 * The ask list, in other words. Shown next to the blind spots so the answer to
 * "why is this category uncovered" is a file name somebody can go and request.
 */
export function missingSourcesFor(
  categoryKey: string,
  present: readonly EvidenceSourceKind[],
): Array<{ kind: EvidenceSourceKind; label: string; examples: string }> {
  return sourcesFor(categoryKey)
    .filter((profile) => !present.includes(profile.kind))
    .map((profile) => ({ kind: profile.kind, label: profile.label, examples: profile.examples }));
}

export { EMPTY_COLUMN_MAP };
