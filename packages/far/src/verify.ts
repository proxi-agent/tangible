import type { FarMapping, MappingCheck } from '@tangible/types';
import { applyMapping, isTotalLabel, type NormalizeOutput } from './normalize.js';
import { formatCell, type ParsedWorkbook } from './parse.js';
import { numberValue } from './values.js';

/**
 * Measure what a proposed mapping actually produces, before anyone trusts it.
 *
 * The mapping model proposes blind: it reads a preview and never sees the rows
 * its proposal makes. Everything here is the closing of that loop, and all of
 * it is plain code on purpose — the same `applyMapping` a confirm would run,
 * executed in memory, with the result measured instead of stored. A check that
 * fails is evidence, not a verdict; the revision loop shows it to the model
 * and the review screen shows it to the person, and both see the same words.
 *
 * The thresholds are deliberately loose. Their job is to catch a mapping that
 * is *structurally* wrong — a header row pointing at data, a cost column that
 * is not the cost, a sheet read as assets that is a rollforward — not to fret
 * over a register that is genuinely a little dirty. A tight threshold here
 * would send every real-world file into the revision loop and teach the model
 * to contort mappings around ordinary mess.
 */

export interface VerifyResult {
  ok: boolean;
  checks: MappingCheck[];
  /** The dry run the checks were measured on, for callers that want the counts. */
  output: NormalizeOutput;
  /** Raw rows behind the loudest problems — what the revision prompt shows. */
  evidence: string[];
}

/** Skips tolerated before the mapping itself is suspect. Bands, blank spacer rows and subtotals all skip legitimately. */
const SKIP_RATE_LIMIT = 0.4;
/** Assets allowed to lack a cost before the cost column is suspect. */
const COSTLESS_LIMIT = 0.25;
/** Warnings tolerated — a warning is a cell that read badly, and a broken column breaks most of them. */
const WARNING_RATE_LIMIT = 0.4;
/** How closely the mapped costs must foot against a printed total. */
const FOOT_TOLERANCE = 0.005;
const EVIDENCE_ROWS = 6;

export function verifyMapping(workbook: ParsedWorkbook, mapping: FarMapping): VerifyResult {
  const output = applyMapping(workbook, mapping);
  const checks: MappingCheck[] = [];
  const evidence: string[] = [];
  const included = mapping.sheets.filter((sheet) => sheet.include);

  // A mapping that includes sheets and produces nothing is wrong somewhere —
  // usually a headerRow past the data or a filter that ate every row.
  const total = output.assets.length + output.skipped.length;
  checks.push(
    included.length === 0
      ? { check: 'produced-assets', ok: false, detail: 'No sheet is included — the mapping produces no assets at all.' }
      : output.assets.length === 0
        ? { check: 'produced-assets', ok: false, detail: `${included.length} included sheet(s) produced 0 assets across ${total} rows.` }
        : { check: 'produced-assets', ok: true, detail: `${output.assets.length} assets from ${included.length} included sheet(s).` },
  );

  const skipRate = total === 0 ? 0 : output.skipped.length / total;
  if (skipRate > SKIP_RATE_LIMIT) {
    const reasons = countBy(output.skipped.map((row) => row.reason));
    checks.push({
      check: 'skip-rate',
      ok: false,
      detail: `${output.skipped.length} of ${total} rows were skipped (${Math.round(skipRate * 100)}%). Top reasons: ${reasons}.`,
    });
    for (const skip of output.skipped.slice(0, EVIDENCE_ROWS)) {
      evidence.push(`skipped ${skip.sheet} row ${skip.row}: ${skip.reason} — ${rawRow(workbook, skip.sheet, skip.row)}`);
    }
  } else {
    checks.push({ check: 'skip-rate', ok: true, detail: `${output.skipped.length} of ${total} rows skipped.` });
  }

  const costMapped = included.some((sheet) => sheet.columns.some((c) => c.field === 'originalCost'));
  const costless = output.assets.filter((asset) => asset.originalCost === null).length;
  const costlessRate = output.assets.length === 0 ? 0 : costless / output.assets.length;
  checks.push(
    !costMapped && included.length > 0
      ? {
          check: 'cost-mapped',
          ok: false,
          detail:
            'No included sheet maps an originalCost column. If only net book value exists that is correct — say so. Otherwise the cost column was missed.',
        }
      : costlessRate > COSTLESS_LIMIT
        ? { check: 'cost-mapped', ok: false, detail: `${costless} of ${output.assets.length} assets have no original cost — the cost column may be mapped to the wrong place.` }
        : { check: 'cost-mapped', ok: true, detail: costMapped ? `${output.assets.length - costless} of ${output.assets.length} assets carry a cost.` : 'No cost column exists to map.' },
  );

  // The strongest check available: does the mapped cost column foot against a
  // total printed on the sheet itself? Registers usually print one, and a
  // wrong cost column almost never foots against it by accident.
  for (const sheet of included) {
    const costCol = sheet.columns.find((c) => c.field === 'originalCost')?.index;
    if (costCol === undefined) continue;
    const parsed = workbook.sheets.find((s) => s.name === sheet.sheetName);
    if (!parsed) continue;
    const summedCost = output.assets
      .filter((asset) => asset.sourceSheet === sheet.sheetName)
      .reduce((sum, asset) => sum + (asset.originalCost ?? 0), 0);
    const printed = printedTotals(parsed.matrix, costCol);
    if (printed.length === 0) {
      checks.push({ check: 'foots', ok: true, detail: `${sheet.sheetName}: no printed total row found to foot against.` });
      continue;
    }
    const closest = printed.reduce((best, one) =>
      Math.abs(one.value - summedCost) < Math.abs(best.value - summedCost) ? one : best,
    );
    const foots = Math.abs(closest.value - summedCost) <= Math.abs(closest.value) * FOOT_TOLERANCE;
    checks.push({
      check: 'foots',
      ok: foots,
      detail: foots
        ? `${sheet.sheetName}: mapped costs sum to ${money(summedCost)}, footing against the total printed on row ${closest.row}.`
        : `${sheet.sheetName}: mapped costs sum to ${money(summedCost)} but the nearest printed total (row ${closest.row}) is ${money(closest.value)}.`,
    });
    if (!foots) evidence.push(`total row ${sheet.sheetName}!${closest.row}: ${rawRow(workbook, sheet.sheetName, closest.row)}`);
  }

  // A header row pointing at data shows up as numeric "headers" on mapped
  // columns — a real header is words.
  for (const sheet of included) {
    if (sheet.headerRow === null) continue;
    const parsed = workbook.sheets.find((s) => s.name === sheet.sheetName);
    const header = parsed?.matrix[sheet.headerRow];
    if (!header) continue;
    const mapped = sheet.columns.filter((c) => c.field !== null);
    const numeric = mapped.filter((c) => typeof header[c.index] === 'number').length;
    // Two or more numbers on the claimed header row is decisive: real headers
    // are words, and even a register with a year in a header writes it as text.
    if (numeric >= 2) {
      checks.push({
        check: 'header-row',
        ok: false,
        detail: `${sheet.sheetName}: ${numeric} of ${mapped.length} mapped columns have numbers on header row ${sheet.headerRow} — that row is probably data, not headers.`,
      });
      evidence.push(`claimed header ${sheet.sheetName} row ${sheet.headerRow}: ${rawRow(workbook, sheet.sheetName, sheet.headerRow)}`);
    }
  }

  const warned = output.assets.filter((asset) => asset.warnings.length > 0).length;
  const warnRate = output.assets.length === 0 ? 0 : warned / output.assets.length;
  if (warnRate > WARNING_RATE_LIMIT) {
    const words = countBy(output.assets.flatMap((asset) => asset.warnings));
    checks.push({
      check: 'warning-rate',
      ok: false,
      detail: `${warned} of ${output.assets.length} assets read with warnings. Top warnings: ${words}.`,
    });
  } else {
    checks.push({ check: 'warning-rate', ok: true, detail: `${warned} of ${output.assets.length} assets carry a warning.` });
  }

  return { ok: checks.every((check) => check.ok), checks, output, evidence };
}

/** Numeric values in the cost column on rows that carry a total label. */
function printedTotals(matrix: unknown[][], costCol: number): { row: number; value: number }[] {
  const found: { row: number; value: number }[] = [];
  matrix.forEach((row, index) => {
    if (!row.some((cell) => isTotalLabel(cell))) return;
    const value = numberValue(row[costCol]);
    if (value !== null && value !== 0) found.push({ row: index, value });
  });
  return found;
}

function rawRow(workbook: ParsedWorkbook, sheetName: string, row: number): string {
  const sheet = workbook.sheets.find((s) => s.name === sheetName);
  const cells = sheet?.matrix[row];
  if (!cells) return '(row not found)';
  return cells.map((cell) => formatCell(cell, 40) ?? '').join(' | ');
}

function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, n]) => `"${reason}" ×${n}`)
    .join(', ');
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
