import { lit, num, type Warehouse } from '@tangible/analytics';
import type { FileFormat, IngestLogger, UnitFile } from './connector.js';
import { readCsvExpr } from './loader.js';

export interface LoadUnitsOptions {
  warehouse: Warehouse;
  jurisdictionId: string;
  taxYear: number;
  filePath: string;
  file: UnitFile;
  /** The account file's format — delimiter and encoding are the archive's, not the file's. */
  format: FileFormat;
  logger: IngestLogger;
}

function quoteCol(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Load one year's per-account taxing units into `account_unit`.
 *
 * The whole computation is one SQL statement over a staged table, for the same
 * reason the account loader is: this file is 1.5 million rows a year for Harris
 * alone and must never pass through JavaScript.
 *
 * Three decisions are worth stating, because each one is a choice against an
 * obvious alternative.
 *
 * **The share is the largest value on the account, not the sum.** Units
 * overlap — a shop is inside its county, its ISD, its city, its college
 * district and its flood-control district all at once, and every one of them
 * appraises the whole of it. Summing those would divide the account by nine and
 * produce a rate a ninth of the truth. The largest is the county-level unit,
 * which covers the account by construction; the values below it are the genuine
 * boundary splits, 0.8% of Harris accounts.
 *
 * **An account whose every unit values it at zero gets a share of 1**, not a
 * division by zero and not a dropped row. A zero-valued account carries no
 * split information, and "no information" for overlapping units means each of
 * them covers all of it — which is what 1 says. The alternative, dropping the
 * account, would silently return it to the county-wide average rate.
 *
 * **Duplicate rows are reduced with `max`, not summed.** A district that lists
 * the same unit twice on an account is describing one levy, not two.
 */
export async function loadUnitFile(options: LoadUnitsOptions): Promise<number> {
  const { warehouse, jurisdictionId, taxYear, filePath, file, format, logger } = options;
  const staging = `units_${jurisdictionId.replace(/[^a-z0-9]/gi, '_')}_${taxYear}`;

  // These files carry a header of their own; the archive's delimiter and
  // encoding still apply, which is why the account file's format comes in.
  const reader = readCsvExpr(filePath, { ...format, hasHeader: true });

  return warehouse.withWriteLock(async () => {
    await warehouse.exec(`DROP TABLE IF EXISTS ${staging};`);
    await warehouse.exec(/* sql */ `
      CREATE TEMP TABLE ${staging} AS
      SELECT
        trim(CAST(${quoteCol(file.accountColumn)} AS VARCHAR)) AS account_id,
        trim(CAST(${quoteCol(file.unitColumn)} AS VARCHAR))    AS unit_code,
        max(try_cast(nullif(regexp_replace(
          CAST(${quoteCol(file.valueColumn)} AS VARCHAR), '[^0-9.\\-]', '', 'g'), '') AS DOUBLE))
          AS appraised_value
      FROM ${reader}
      ${file.where ? `WHERE ${file.where}` : ''}
      GROUP BY 1, 2
      HAVING account_id <> '' AND unit_code <> '';
    `);

    await warehouse.exec(/* sql */ `
      DELETE FROM account_unit
      WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};
    `);

    await warehouse.exec(/* sql */ `
      INSERT INTO account_unit (
        jurisdiction_id, tax_year, account_id, unit_code,
        appraised_value, share, source_file
      )
      SELECT
        ${lit(jurisdictionId)},
        ${lit(taxYear)},
        account_id,
        unit_code,
        appraised_value,
        CASE
          WHEN account_total > 0 THEN least(1.0, coalesce(appraised_value, 0) / account_total)
          ELSE 1.0
        END,
        ${lit(filePath)}
      FROM (
        SELECT
          account_id,
          unit_code,
          appraised_value,
          max(coalesce(appraised_value, 0)) OVER (PARTITION BY account_id) AS account_total
        FROM ${staging}
      );
    `);

    const loaded = num(
      (
        await warehouse.queryOne<{ n: unknown }>(
          `SELECT count(*) AS n FROM account_unit
           WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};`,
        )
      )?.n,
    );

    // Two numbers worth printing rather than one. The account count is what the
    // rate can now be computed for; the split count is the reason this file is
    // worth 1.5 million rows, because a boundary-straddling account is the only
    // kind whose rate a per-unit table gets meaningfully right.
    const stats = await warehouse.queryOne<{ accounts: unknown; split: unknown }>(/* sql */ `
      SELECT
        count(DISTINCT account_id) AS accounts,
        count(DISTINCT CASE WHEN share < 1 THEN account_id END) AS split
      FROM account_unit
      WHERE jurisdiction_id = ${lit(jurisdictionId)} AND tax_year = ${lit(taxYear)};
    `);
    logger.info(
      `  '${file.label}': ${loaded.toLocaleString()} unit rows over ` +
        `${num(stats?.accounts).toLocaleString()} accounts, ` +
        `${num(stats?.split).toLocaleString()} of them split across a boundary`,
    );

    await warehouse.exec(`DROP TABLE IF EXISTS ${staging};`);
    return loaded;
  });
}
