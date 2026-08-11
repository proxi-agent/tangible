/**
 * Minimal SQL literal helpers.
 *
 * Every value that reaches these functions has already been through a Zod
 * schema at the API boundary, so these guard against quoting mistakes rather
 * than against untrusted input. Anything that cannot be represented safely
 * throws instead of being silently coerced.
 */

export function lit(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot inline non-finite number: ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Quote an identifier (table/column name). */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export function litList(values: readonly (string | number)[]): string {
  if (values.length === 0) return 'NULL';
  return values.map((v) => lit(v)).join(', ');
}

/** Join non-empty predicates into a WHERE clause, or `TRUE` when there are none. */
export function and(...clauses: (string | null | undefined | false)[]): string {
  const kept = clauses.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  return kept.length ? kept.map((c) => `(${c})`).join(' AND ') : 'TRUE';
}

/** Coerce a DuckDB numeric (which may arrive as bigint or DuckDBDecimal) to number. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = num(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}
