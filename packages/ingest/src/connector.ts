import type { Jurisdiction, SourceFile } from '@tangible/types';
import type { ColumnLayout } from '@tangible/types';

export interface IngestLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: IngestLogger = {
  info: (m) => console.log(`[ingest] ${m}`),
  warn: (m) => console.warn(`[ingest] ${m}`),
  error: (m) => console.error(`[ingest] ${m}`),
};

/**
 * How a delimited source file is read.
 *
 * County appraisal districts publish headerless, tab-delimited, latin-1 dumps
 * whose column order changes between years. `layoutByYear` pins the mapping for
 * those; files that do carry a header resolve by name and need no entry.
 */
export interface FileFormat {
  delimiter: string;
  /** `'auto'` sniffs the first row against the known header aliases. */
  hasHeader: boolean | 'auto';
  encoding: 'utf-8' | 'latin-1';
  /**
   * Quoting. Districts split two ways: tab-delimited dumps carry bare quotes
   * inside free-text fields and must have quoting disabled entirely, while
   * comma-delimited exports are properly quoted and break without it. Defaults
   * to disabled, which is the safe reading of a delimiter that cannot appear in
   * the data.
   */
  quote?: string;
  escape?: string;
  /**
   * Raw SQL for fields that cannot be expressed as a column mapping — a value
   * derived from two columns, or one whose meaning depends on the tax year.
   * Takes precedence over the layout. Receives the tax year being loaded.
   */
  expressions?: Partial<Record<string, (taxYear: number) => string>>;
  /** Column index (headerless) or column name (with header) per canonical field. */
  layoutByYear?: Record<string, ColumnLayout>;
  /** Fallback used for any year without its own entry. */
  defaultLayout?: ColumnLayout;
  /**
   * How to read coded columns whose values are jurisdiction-specific strings
   * rather than a generic Y/N. First matching rule wins.
   */
  booleanRules?: Partial<Record<string, CodeRule[]>>;
}

/**
 * One interpretation rule for a coded column.
 *
 * `match` is a SQL ILIKE pattern applied to the trimmed raw value; the empty
 * string matches NULL and blank, which for filing columns is usually the most
 * meaningful value in the file — a blank rendition code means nothing was filed.
 */
export interface CodeRule {
  match: string;
  value: boolean | null;
}

/**
 * A second file, keyed by account, that supplies fields the main roll does not.
 *
 * Districts routinely split their data this way — exemptions in one table, tax
 * agents in another, supplemental attributes in a third. Rather than special-
 * casing each, a connector declares what a companion contributes and the loader
 * joins it in. Companion values take precedence over the main file.
 */
export interface CompanionFile {
  /** Shown in the ingest log, e.g. 'exemptions' or 'agents'. */
  label: string;
  /** Filename patterns identifying the file, best first. */
  patterns: RegExp[];
  /** Column holding the account number. */
  accountColumn: string;
  /** Optional predicate limiting which companion rows count. */
  where?: string;
  /**
   * Canonical fields this file supplies, as SQL over the companion's own
   * columns. An account with no matching row falls back to the main file.
   */
  fields: Partial<Record<string, string>>;
  /** Companion is missing from the archive: warn, or fail the load. */
  required?: boolean;
}

/**
 * A connector knows how to get one jurisdiction's public roll onto disk and how
 * to read it. Everything after that — loading, normalizing, analyzing — is
 * shared, so adding a county is a matter of adding a connector.
 */
export interface Connector {
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  readonly format: FileFormat;

  /** Candidate source files for a tax year, best first. */
  discover(taxYear: number): Promise<SourceFile[]>;

  /**
   * Pick the account-level file out of an extracted archive. Archives contain
   * many tables; only one is the account roll.
   */
  pickAccountFile(extractedPaths: string[]): string | null;

  /** Companion files keyed by account, joined in at load time. */
  readonly companionFiles?: readonly CompanionFile[];

  /**
   * Optional per-connector SQL predicate applied to the staged raw rows before
   * they are inserted into `account_year`. Use for jurisdiction-specific quirks
   * that cannot be expressed as a column mapping.
   */
  rawTransformSql?(rawTable: string, taxYear: number): string | null;
}

export interface IngestContext {
  taxYears: number[];
  dataDir: string;
  force: boolean;
  logger: IngestLogger;
  onProgress?: (message: string) => void;
}

export interface IngestYearResult {
  taxYear: number;
  rowsLoaded: number;
  sourceFile: string;
  skipped: boolean;
  reason?: string;
}

export interface IngestResult {
  jurisdictionId: string;
  connectorId: string;
  years: IngestYearResult[];
  totalRows: number;
}
