import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { backfillPolicy, lit, num, type Warehouse } from '@tangible/analytics';
import type { SourceFile } from '@tangible/types';
import type {
  CompanionFile,
  Connector,
  IngestContext,
  IngestLogger,
  IngestResult,
  IngestYearResult,
  UnitFile,
} from './connector.js';
import {
  downloadFirstAvailable,
  listFiles,
  materializeSource,
  normalizeSourceRef,
} from './download.js';
import { LayoutResolutionError, loadAccountFile } from './loader.js';
import { loadUnitFile } from './units.js';

export interface RunIngestOptions extends IngestContext {
  warehouse: Warehouse;
  connector: Connector;
  /**
   * Explicit sources per tax year, overriding the connector's discovery.
   * A year may need several — districts routinely split the account roll and
   * its companions across separate archives.
   */
  urlOverrides?: Record<number, string[]>;
}

/**
 * Download → extract → load → normalize, one tax year at a time.
 *
 * Years are processed sequentially rather than in parallel: the archives are
 * hundreds of megabytes, DuckDB takes a single writer, and county portals are
 * not infrastructure worth hammering.
 */
export async function runIngest(options: RunIngestOptions): Promise<IngestResult> {
  const { warehouse, connector, taxYears, logger } = options;
  const jurisdictionId = connector.jurisdiction.id;

  await upsertJurisdiction(warehouse, connector);

  const years: IngestYearResult[] = [];

  for (const taxYear of taxYears) {
    options.onProgress?.(`Ingesting ${jurisdictionId} ${taxYear}`);
    try {
      years.push(await ingestYear(options, taxYear));
    } catch (error) {
      if (error instanceof LayoutResolutionError) {
        logger.error(error.message);
        logger.error(`Columns found in the source file:\n${error.preview}`);
      } else {
        logger.error(`[${taxYear}] ${(error as Error).message}`);
      }
      years.push({
        taxYear,
        rowsLoaded: 0,
        sourceFile: '',
        skipped: true,
        reason: (error as Error).message,
      });
    }
  }

  await backfillPolicy(warehouse);

  return {
    jurisdictionId,
    connectorId: connector.id,
    years,
    totalRows: years.reduce((sum, y) => sum + y.rowsLoaded, 0),
  };
}

async function ingestYear(options: RunIngestOptions, taxYear: number): Promise<IngestYearResult> {
  const { warehouse, connector, dataDir, force, logger } = options;
  const jurisdictionId = connector.jurisdiction.id;

  const yearDir = join(dataDir, jurisdictionId, String(taxYear));
  const extractDir = join(yearDir, 'extracted');

  let extracted = await safeListFiles(extractDir);

  if (!force) {
    const existing = await countExistingRows(warehouse, jurisdictionId, taxYear);
    if (existing > 0) {
      logger.info(`[${taxYear}] ${existing.toLocaleString()} rows already loaded, skipping`);
      // The accounts being present does not mean the taxing units are. A
      // warehouse loaded before the unit table existed holds a full roll and no
      // units at all, and without this it would never acquire any — every
      // account in it would keep pricing at the county-wide rate through every
      // future run that was not forced. Loading from the archive already on
      // disk costs a minute and needs no download.
      const unitRowsLoaded = await backfillUnits(options, taxYear, extracted);
      return {
        taxYear,
        rowsLoaded: existing,
        unitRowsLoaded,
        sourceFile: '',
        skipped: true,
        reason: 'already loaded',
      };
    }
  }

  if (extracted.length === 0 || force) {
    const overrides = options.urlOverrides?.[taxYear] ?? [];

    if (overrides.length > 0) {
      // Every supplied source is unpacked into the same directory, so the
      // account file and its companions are found together regardless of which
      // archive each arrived in.
      const files: string[] = [];
      for (const [index, ref] of overrides.entries()) {
        const source: SourceFile = {
          jurisdictionId,
          taxYear,
          kind: index === 0 ? 'accounts' : 'companion',
          url: normalizeSourceRef(ref),
          fileName: `source_${taxYear}_${index}${extensionOf(ref)}`,
          sizeBytes: null,
          checksum: null,
        };
        const downloaded = await downloadFirstAvailable([source], yearDir, logger);
        if (!downloaded) {
          throw new Error(`Could not read the source you supplied for ${taxYear}:\n  ${ref}`);
        }
        files.push(...(await materializeSource(downloaded.result.path, extractDir, logger)));
      }
      extracted = [...new Set(files)];
    } else {
      const sources = await connector.discover(taxYear);

      // No candidates at all means the connector knows this jurisdiction never
      // published that year — Florida's DOR posts only the current roll, so
      // asking any Florida county for 2021 is a question with a legitimate
      // answer of "there is no such file". That is a skip, not a failure.
      //
      // Treating it as an error was worse than untidy: a `--all` run printed
      // five paragraphs of remediation instructions per Florida county, 335 in
      // total, each telling the operator to go and download a file that does
      // not exist. Real problems drowned in it.
      if (sources.length === 0) {
        logger.info(`[${taxYear}] not published by this jurisdiction, skipping`);
        return {
          taxYear,
          rowsLoaded: 0,
          sourceFile: '',
          skipped: true,
          reason: 'not published for this year',
        };
      }

      const downloaded = await downloadFirstAvailable(sources, yearDir, logger);
      // Candidates existed and every one of them failed. That is a real
      // problem, and the operator can do something about it.
      if (!downloaded) {
        throw new Error(
          `No source file could be downloaded for ${taxYear}. ` +
            `Download it from ${connector.jurisdiction.dataPortalUrl ?? 'the data portal'} ` +
            `and pass the file with --url ${taxYear}=<path-or-url>.`,
        );
      }
      extracted = await materializeSource(downloaded.result.path, extractDir, logger);
    }
  } else {
    logger.info(`[${taxYear}] reusing ${extracted.length} already-extracted file(s)`);
  }

  const accountFile = connector.pickAccountFile(extracted) ?? (await largestFile(extracted));
  if (!accountFile) {
    throw new Error(`No account file found in the ${taxYear} archive`);
  }

  const companions = resolveCompanions(connector, extracted, logger);

  const rowsLoaded = await loadAccountFile({
    warehouse,
    jurisdictionId,
    taxYear,
    filePath: accountFile,
    format: connector.format,
    logger,
    rawFilterSql: connector.rawTransformSql?.(accountFile, taxYear) ?? null,
    companions,
  });

  logger.info(`[${taxYear}] loaded ${rowsLoaded.toLocaleString()} accounts`);

  // After the accounts, not before: `account_unit` is only meaningful for
  // accounts the roll actually holds, and a unit load that succeeded over a
  // failed account load would leave the warehouse describing rates for
  // accounts it cannot name.
  const unitRowsLoaded = await loadUnits(options, taxYear, extracted);

  return { taxYear, rowsLoaded, unitRowsLoaded, sourceFile: accountFile, skipped: false };
}

async function countExistingRows(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<number> {
  const row = await warehouse.queryOne<{ n: unknown }>(
    `SELECT count(*) AS n FROM account_year
     WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};`,
  );
  return num(row?.n);
}

async function countExistingUnitRows(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<number> {
  const row = await warehouse.queryOne<{ n: unknown }>(
    `SELECT count(*) AS n FROM account_unit
     WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};`,
  );
  return num(row?.n);
}

export async function upsertJurisdiction(
  warehouse: Warehouse,
  connector: Connector,
): Promise<void> {
  const j = connector.jurisdiction;
  await warehouse.exec(/* sql */ `
    INSERT OR REPLACE INTO jurisdiction (
      jurisdiction_id, name, cad_code, state, county, fips,
      connector_id, blended_tax_rate, homepage_url, data_portal_url
    ) VALUES (
      ${lit(j.id)}, ${lit(j.name)}, ${lit(j.cadCode)}, ${lit(j.state)}, ${lit(j.county)},
      ${lit(j.fips)}, ${lit(j.connectorId)}, ${lit(j.blendedTaxRate)},
      ${lit(j.homepageUrl)}, ${lit(j.dataPortalUrl)}
    );
  `);
}

/**
 * Load the units for a year whose accounts are already in the warehouse.
 *
 * Only when there are none — this runs on every unforced re-run of an already
 * loaded year, and re-reading 1.5 million rows to arrive at the same answer is
 * a minute nobody asked for. And only from files already extracted: a year
 * skipped for having its accounts is a year the operator asked not to spend
 * bandwidth on, so a missing archive is reported rather than downloaded.
 */
async function backfillUnits(
  options: RunIngestOptions,
  taxYear: number,
  extracted: string[],
): Promise<number | undefined> {
  const { warehouse, connector, logger } = options;
  if (!connector.unitFile) return undefined;

  const existing = await countExistingUnitRows(warehouse, connector.jurisdiction.id, taxYear);
  if (existing > 0) return undefined;

  if (extracted.length === 0) {
    logger.warn(
      `  no taxing units loaded for ${taxYear} and the archive is no longer on disk — ` +
        `re-run with --force to price these accounts at their own rates`,
    );
    return undefined;
  }

  return loadUnits(options, taxYear, extracted);
}

/**
 * Load the per-account taxing units, where the connector publishes them.
 *
 * A failure here does not fail the year. The account roll is the product's
 * spine and the unit table is an improvement on one number in it — losing the
 * improvement means every account falls back to the county-wide rate, which is
 * exactly the state the product was in before this file existed. Losing the
 * roll means no report at all. So this is caught and said out loud rather than
 * thrown.
 */
async function loadUnits(
  options: RunIngestOptions,
  taxYear: number,
  extracted: string[],
): Promise<number | undefined> {
  const { warehouse, connector, logger } = options;
  const file: UnitFile | undefined = connector.unitFile;
  if (!file) return undefined;

  const path = file.patterns.map((pattern) => extracted.find((p) => pattern.test(p))).find(Boolean);
  if (!path) {
    const message = `'${file.label}' file not found — every account in ${taxYear} will price at the county-wide rate`;
    if (file.required) throw new Error(message);
    logger.warn(`  ${message}`);
    return undefined;
  }

  try {
    return await loadUnitFile({
      warehouse,
      jurisdictionId: connector.jurisdiction.id,
      taxYear,
      filePath: path,
      file,
      format: connector.format,
      logger,
    });
  } catch (error) {
    logger.warn(
      `  '${file.label}' failed to load (${(error as Error).message}) — ` +
        `${taxYear} will price at the county-wide rate`,
    );
    return undefined;
  }
}

/**
 * Locate each companion file the connector declares inside what was extracted.
 *
 * A missing companion is not fatal by default — the fields it supplies simply
 * stay unknown — but it is always said out loud, because a silently absent
 * exemption or agent file changes what every downstream count means.
 */
function resolveCompanions(
  connector: Connector,
  extracted: string[],
  logger: IngestLogger,
): { file: CompanionFile; path: string }[] {
  const resolved: { file: CompanionFile; path: string }[] = [];

  for (const companion of connector.companionFiles ?? []) {
    const match = companion.patterns
      .map((pattern) => extracted.find((p) => pattern.test(p)))
      .find(Boolean);

    if (match) {
      resolved.push({ file: companion, path: match });
      continue;
    }

    const message =
      `companion '${companion.label}' not found — ` +
      `${Object.keys(companion.fields).join(', ')} will be unknown`;
    if (companion.required) throw new Error(message);
    logger.warn(`  ${message}`);
  }

  return resolved;
}

/** File extension from a URL or path, defaulting to .zip. */
function extensionOf(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  const match = /(\.[a-z0-9]{1,5})$/i.exec(withoutQuery);
  return match?.[1] ?? '.zip';
}

async function safeListFiles(dir: string): Promise<string[]> {
  try {
    return await listFiles(dir);
  } catch {
    return [];
  }
}

async function largestFile(paths: string[]): Promise<string | null> {
  const candidates = paths.filter((p) => /\.(txt|csv|dat)$/i.test(p));
  if (candidates.length === 0) return null;

  const sized = await Promise.all(
    candidates.map(async (path) => ({ path, size: (await stat(path)).size })),
  );
  sized.sort((a, b) => b.size - a.size);
  return sized[0]?.path ?? null;
}
