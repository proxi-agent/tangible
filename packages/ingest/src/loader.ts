import { lit, num, stateClassGroupSql, type Warehouse } from '@tangible/analytics';
import type { ColumnLayout } from '@tangible/types';
import {
  HEADER_ALIASES,
  missingRequired,
  normalizeHeader,
  resolveColumns,
  type CanonicalField,
} from './columns.js';
import type { CodeRule, CompanionFile, FileFormat, IngestLogger } from './connector.js';

const ALL_ALIASES = new Set(Object.values(HEADER_ALIASES).flat());

/**
 * Decide whether the first row is a header by checking it against the known
 * aliases. Counties are inconsistent about this between years of the same
 * dataset, so it is worth detecting rather than configuring.
 */
async function sniffHasHeader(
  warehouse: Warehouse,
  path: string,
  format: FileFormat,
): Promise<boolean> {
  const probe = readCsvExpr(path, { ...format, hasHeader: false });
  const row = await warehouse.queryOne<Record<string, unknown>>(
    `SELECT * FROM ${probe} LIMIT 1;`,
  );
  if (!row) return false;
  return Object.values(row).some(
    (cell) => cell != null && ALL_ALIASES.has(normalizeHeader(String(cell))),
  );
}

/** Reads any of the delimited text dumps counties publish, without failing on ragged rows. */
function readCsvExpr(path: string, format: FileFormat): string {
  const options = [
    `delim = ${lit(format.delimiter)}`,
    `header = ${format.hasHeader === true ? 'true' : 'false'}`,
    `all_varchar = true`,
    `ignore_errors = true`,
    `null_padding = true`,
    `sample_size = -1`,
    `encoding = ${lit(format.encoding)}`,
    `quote = ${lit(format.quote ?? '')}`,
    `escape = ${lit(format.escape ?? '')}`,
  ];
  return `read_csv(${lit(path)}, ${options.join(', ')})`;
}

/** Strip currency formatting, then cast. Anything unparseable becomes NULL, not 0. */
function numericExpr(column: string | undefined): string {
  if (!column) return 'NULL';
  return `try_cast(nullif(regexp_replace(CAST(${quoteCol(column)} AS VARCHAR), '[^0-9.\\-]', '', 'g'), '') AS DOUBLE)`;
}

/**
 * Three-valued boolean. Sources encode filing status as Y/N, T/F, 1/0, or as a
 * filing date. An unrecognized value stays NULL rather than defaulting to FALSE,
 * because a false "did not file" is the one error that would invent the entire
 * signal this product rests on.
 */
function booleanExpr(column: string | undefined): string {
  if (!column) return 'NULL';
  const col = `upper(trim(CAST(${quoteCol(column)} AS VARCHAR)))`;
  return `CASE
    WHEN ${col} IS NULL OR ${col} = '' THEN NULL
    WHEN ${col} IN ('Y', 'YES', 'T', 'TRUE', '1') THEN TRUE
    WHEN ${col} IN ('N', 'NO', 'F', 'FALSE', '0') THEN FALSE
    WHEN try_cast(${quoteCol(column)} AS DATE) IS NOT NULL THEN TRUE
    ELSE NULL
  END`;
}

/**
 * Interpret a coded column using the connector's rules.
 *
 * Districts encode filing status in their own vocabulary — HCAD writes
 * `Y-Rendered`, `L-Late Rendition`, or a blank — which no generic Y/N parser
 * can read. Anything not matched by a rule stays NULL rather than defaulting to
 * "did not file", because that error would manufacture the signal outright.
 */
function codedExpr(column: string | undefined, rules: CodeRule[] | undefined): string {
  if (!column) return 'NULL';
  if (!rules?.length) return booleanExpr(column);

  const col = quoteCol(column);
  const trimmed = `trim(CAST(${col} AS VARCHAR))`;
  const branches = rules.map((rule) =>
    rule.match === ''
      ? `WHEN ${col} IS NULL OR ${trimmed} = '' THEN ${sqlBool(rule.value)}`
      : `WHEN ${trimmed} ILIKE ${lit(rule.match)} THEN ${sqlBool(rule.value)}`,
  );

  return `CASE ${branches.join('\n         ')} ELSE NULL END`;
}

function sqlBool(value: boolean | null): string {
  if (value === null) return 'NULL';
  return value ? 'TRUE' : 'FALSE';
}

/** Exemption columns are sometimes a flag, sometimes an exempt-value amount. */
function exemptExprFor(column: string | undefined): string {
  if (!column) return 'NULL';
  const flag = booleanExpr(column);
  const amount = numericExpr(column);
  return `coalesce(${flag}, ${amount} > 0)`;
}

function textExpr(column: string | undefined): string {
  if (!column) return 'NULL';
  return `nullif(trim(CAST(${quoteCol(column)} AS VARCHAR)), '')`;
}

function quoteCol(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Normalized owner key: lowercase, punctuation stripped, entity suffixes removed.
 * Groups "ACME MACHINE WORKS, INC." and "Acme Machine Works LLC" onto one entity
 * so multi-account owners roll up correctly.
 */
export const OWNER_KEY_SQL = (column: string) => `
  nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(CAST(${column} AS VARCHAR)), '[^a-z0-9 ]', ' ', 'g'),
      '\\b(llc|l l c|inc|incorporated|corp|corporation|lp|llp|pllc|ltd|co|company|dba|the)\\b',
      ' ', 'g'),
    '\\s+', ' ', 'g')), '')`;

export interface LoadOptions {
  warehouse: Warehouse;
  jurisdictionId: string;
  taxYear: number;
  filePath: string;
  format: FileFormat;
  logger: IngestLogger;
  /** Extra SQL predicate applied to the staged rows before insert. */
  rawFilterSql?: string | null;
  /** Companion tables resolved from the archive, in declaration order. */
  companions?: { file: CompanionFile; path: string }[];
}

export class LayoutResolutionError extends Error {
  constructor(
    message: string,
    readonly preview: string,
  ) {
    super(message);
    this.name = 'LayoutResolutionError';
  }
}

/**
 * Load one year's account file into `account_year`.
 *
 * The file is staged as all-VARCHAR inside DuckDB and normalized with SQL, so a
 * multi-hundred-megabyte county dump never passes through JavaScript.
 */
export async function loadAccountFile(options: LoadOptions): Promise<number> {
  const { warehouse, jurisdictionId, taxYear, filePath, format: rawFormat, logger } = options;
  const stagingTable = `raw_${jurisdictionId.replace(/[^a-z0-9]/gi, '_')}_${taxYear}`;

  const hasHeader =
    rawFormat.hasHeader === 'auto'
      ? await sniffHasHeader(warehouse, filePath, rawFormat)
      : rawFormat.hasHeader;
  const format: FileFormat = { ...rawFormat, hasHeader };
  logger.info(`  ${filePath} (header=${hasHeader})`);

  const reader = readCsvExpr(filePath, format);

  return warehouse.withWriteLock(async () => {
    await warehouse.exec(`DROP TABLE IF EXISTS ${stagingTable};`);
    await warehouse.exec(`CREATE TEMP TABLE ${stagingTable} AS SELECT * FROM ${reader};`);

    const described = await warehouse.query<{ column_name: string }>(
      `DESCRIBE SELECT * FROM ${stagingTable};`,
    );
    const columns = described.map((d) => String(d.column_name));

    const layout: ColumnLayout | undefined =
      format.layoutByYear?.[String(taxYear)] ?? format.defaultLayout;
    const resolved = resolveColumns(columns, layout);
    const missing = missingRequired(resolved);

    if (missing.length > 0) {
      const preview = await previewRows(warehouse, stagingTable, columns);
      await warehouse.exec(`DROP TABLE IF EXISTS ${stagingTable};`);
      throw new LayoutResolutionError(
        `Could not resolve ${missing.join(', ')} for ${jurisdictionId} ${taxYear}. ` +
          `Pin the column positions in the connector's layoutByYear and re-run.`,
        preview,
      );
    }

    logger.info(
      `  resolved columns: ${Object.entries(resolved)
        .map(([field, col]) => `${field}=${col}`)
        .join(', ')}`,
    );

    // A connector-supplied expression wins over the column mapping — it exists
    // precisely for fields the mapping cannot express.
    const expr = (field: CanonicalField, fallback: string): string => {
      const custom = format.expressions?.[field];
      return custom ? `(${custom(taxYear)})` : fallback;
    };

    const c = (field: CanonicalField) => resolved[field];
    const accountExpr = `trim(CAST(${quoteCol(c('accountId')!)} AS VARCHAR))`;

    // Stage each companion file as a table keyed by account, then left-join it.
    // A companion's value wins over the main file, which is the whole point:
    // it exists because the main file does not carry that field well or at all.
    const companionTables: string[] = [];
    const companionJoins: string[] = [];
    const companionFields = new Map<string, string>();

    for (const [index, companion] of (options.companions ?? []).entries()) {
      const alias = `cmp${index}`;
      const table = `${stagingTable}_${alias}`;
      companionTables.push(table);

      const projections = Object.entries(companion.file.fields).map(
        ([field, sql]) => `${sql} AS ${quoteCol(`f_${field}`)}`,
      );

      await warehouse.exec(`DROP TABLE IF EXISTS ${table};`);
      await warehouse.exec(/* sql */ `
        CREATE TEMP TABLE ${table} AS
        SELECT DISTINCT ON (account_id) * FROM (
          SELECT
            trim(CAST(${quoteCol(companion.file.accountColumn)} AS VARCHAR)) AS account_id
            ${projections.length ? `, ${projections.join(', ')}` : ''}
          FROM ${readCsvExpr(companion.path, { ...format, hasHeader: true })}
          ${companion.file.where ? `WHERE ${companion.file.where}` : ''}
        );
      `);

      const rows = await warehouse.queryOne<{ n: unknown }>(
        `SELECT count(*) AS n FROM ${table};`,
      );
      logger.info(`  companion '${companion.file.label}': ${num(rows?.n).toLocaleString()} account(s)`);

      companionJoins.push(`LEFT JOIN ${table} ${alias} ON ${alias}.account_id = ${accountExpr}`);
      for (const field of Object.keys(companion.file.fields)) {
        companionFields.set(field, `${alias}.${quoteCol(`f_${field}`)}`);
      }
    }

    /** Companion value first, then the connector expression or column mapping. */
    const withCompanion = (field: CanonicalField, fallback: string): string => {
      const companion = companionFields.get(field);
      return companion ? `coalesce(${companion}, ${fallback})` : fallback;
    };

    const exemptExpr = withCompanion('isExempt', expr('isExempt', exemptExprFor(c('isExempt'))));
    const stateClassExpr = withCompanion('stateClass', expr('stateClass', textExpr(c('stateClass'))));
    const ownerExpr = withCompanion('ownerName', expr('ownerName', textExpr(c('ownerName'))));
    const agentExpr = withCompanion('agentName', expr('agentName', textExpr(c('agentName'))));
    const field = (name: CanonicalField) => withCompanion(name, expr(name, textExpr(c(name))));

    const insertSql = /* sql */ `
      INSERT OR REPLACE INTO account_year (
        jurisdiction_id, tax_year, account_id,
        owner_name, owner_key,
        site_address, site_city, site_zip,
        mail_address, mail_city, mail_state, mail_zip,
        state_class, state_class_group, business_code,
        market_value, appraised_value, assessed_value,
        rendition_filed, rendition_late, rendition_penalty,
        has_agent, agent_name, is_exempt,
        source_file
      )
      SELECT
        ${lit(jurisdictionId)},
        ${lit(taxYear)},
        ${accountExpr},
        ${ownerExpr},
        ${OWNER_KEY_SQL(ownerExpr)},
        ${field('siteAddress')},
        upper(${field('siteCity')}),
        ${field('siteZip')},
        ${field('mailAddress')},
        upper(${field('mailCity')}),
        upper(${field('mailState')}),
        ${field('mailZip')},
        upper(${stateClassExpr}),
        ${stateClassGroupSql(stateClassExpr)},
        ${field('businessCode')},
        ${numericExpr(c('marketValue'))},
        ${numericExpr(c('appraisedValue'))},
        -- Fall back through the value columns so a source that publishes only
        -- one of them still produces a usable assessed value.
        coalesce(
          ${withCompanion('assessedValue', expr('assessedValue', numericExpr(c('assessedValue'))))},
          ${numericExpr(c('appraisedValue'))},
          ${numericExpr(c('marketValue'))}
        ),
        ${withCompanion('renditionFiled', expr('renditionFiled', codedExpr(c('renditionFiled'), format.booleanRules?.renditionFiled)))},
        ${withCompanion('renditionLate', expr('renditionLate', codedExpr(c('renditionLate'), format.booleanRules?.renditionLate)))},
        ${numericExpr(c('renditionPenalty'))},
        (${agentExpr} IS NOT NULL),
        ${agentExpr},
        ${exemptExpr},
        ${lit(filePath)}
      FROM ${stagingTable}
      ${companionJoins.join('\n      ')}
      WHERE ${accountExpr} <> ''
        ${options.rawFilterSql ? `AND (${options.rawFilterSql})` : ''};
    `;

    const stagedRow = await warehouse.queryOne<{ n: unknown }>(
      `SELECT count(*) AS n FROM ${stagingTable};`,
    );

    await warehouse.exec(insertSql);

    const countRow = await warehouse.queryOne<{ n: unknown }>(
      `SELECT count(*) AS n FROM account_year
       WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};`,
    );

    // Rows can legitimately be dropped (blank account numbers, a connector's
    // own filter), but a large gap means a parsing problem — say so rather than
    // reporting a clean-looking load of a fraction of the file.
    const staged = num(stagedRow?.n);
    const loaded = num(countRow?.n);
    if (staged > 0 && loaded < staged * 0.9) {
      logger.warn(
        `  ${(staged - loaded).toLocaleString()} of ${staged.toLocaleString()} source rows did not land ` +
          `(${((1 - loaded / staged) * 100).toFixed(1)}%) — check the connector's filter and column mapping`,
      );
    }

    await warehouse.exec(`DROP TABLE IF EXISTS ${stagingTable};`);
    for (const table of companionTables) {
      await warehouse.exec(`DROP TABLE IF EXISTS ${table};`);
    }
    return loaded;
  });
}

/** Sample rows with column indexes, so a failed layout is fixable in one pass. */
async function previewRows(
  warehouse: Warehouse,
  table: string,
  columns: readonly string[],
): Promise<string> {
  const rows = await warehouse.query<Record<string, unknown>>(`SELECT * FROM ${table} LIMIT 3;`);
  const lines = columns.map((col, i) => {
    const samples = rows
      .map((r) => String(r[col] ?? '').slice(0, 30))
      .filter((s) => s.length > 0)
      .join(' | ');
    return `  [${String(i).padStart(3)}] ${col.padEnd(24)} ${samples}`;
  });
  return lines.join('\n');
}
