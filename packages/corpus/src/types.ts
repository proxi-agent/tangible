import type { FarMapping } from '@tangible/types';

/**
 * What a client sends, before anybody has decided anything about it.
 *
 * The product has been built and rehearsed against one register — a good one,
 * with real mess in it, but one. Everything downstream of the mapping screen
 * therefore knows exactly one shape of file. This is the rest of the mail: the
 * same handful of businesses, rendered the way ten different systems and two
 * different states actually render them.
 *
 * Each entry carries three things beyond its bytes. `traps` says what a careful
 * reader has to notice, so a failure can be read as "it missed the subtotals"
 * rather than as a wrong number. `mapping` is the mapping a competent reviewer
 * would confirm, which lets a test apply it and check the result against
 * `truth` — the corpus grades itself. And `expectation` records whether the
 * unattended path should carry this file or stop in front of a person, which is
 * the only claim in here that is about the product rather than about the file.
 */

export type CorpusKind = 'register' | 'rendition' | 'notice' | 'invoice';

/** What the file is stored as, which decides how the product reads it. */
export type CorpusFormat = 'xlsx' | 'xlsm' | 'xls' | 'csv' | 'tsv' | 'pdf';

export interface CorpusTruth {
  /** Rows a correct mapping turns into assets. */
  assetCount: number;
  /**
   * Sum of original cost as a correct reader gets it, to the cent. Null when
   * the file does not print original cost at all — which is itself a finding,
   * not a gap in the fixture.
   */
  totalCost: number | null;
  /** Sheets a correct mapping includes; empty for a file that maps to nothing. */
  includedSheets: readonly string[];
}

export interface CorpusExpectation {
  /**
   * What the unattended path should do — `clears` only for a file whose mapping
   * can be applied, checked against its own printed totals, and believed
   * without a person. Everything else holds, and the reason is the sentence a
   * preparer should see.
   */
  autopilot: 'clears' | 'holds';
  because: string;
}

export interface CorpusEntry {
  id: string;
  /** What the client would call it, extension included. */
  filename: string;
  kind: CorpusKind;
  format: CorpusFormat;
  /** The business it belongs to, by {@link CorpusBusiness.id}. */
  businessId: string;
  /** What produced the file: a system, or a person and a spreadsheet. */
  source: string;
  /** Where the property it describes sits, as the file itself spells it. */
  jurisdictions: readonly string[];
  /** One line on why this file exists in the corpus and no other one does. */
  premise: string;
  /** What a careful reader has to notice. One line each, in the file's terms. */
  traps: readonly string[];
  expectation: CorpusExpectation;
  /** The mapping a competent reviewer would confirm. Null when none is right. */
  mapping: FarMapping | null;
  truth: CorpusTruth | null;
  build: () => Uint8Array | Promise<Uint8Array>;
}

export interface CorpusSite {
  id: string;
  /** The name the business uses for it in conversation. */
  label: string;
  /** Every spelling its own records use — registers are not consistent. */
  aliases: readonly string[];
  street: string;
  city: string;
  state: 'TX' | 'FL' | 'AL';
  zip: string;
  county: string;
  /** The district's account number, where the business has one. */
  account: string | null;
}

export type AssetKind =
  | 'machinery'
  | 'furniture'
  | 'computer'
  | 'vehicle'
  | 'leasehold'
  | 'software'
  | 'inventory'
  | 'supplies'
  | 'leased'
  | 'realty';

export interface CorpusAsset {
  tag: string;
  description: string;
  /** The client's own wording for the class. Never a canonical category. */
  category: string;
  kind: AssetKind;
  /** Original cost when new, in dollars and cents. */
  cost: number;
  quantity: number;
  /** ISO date the asset was acquired. */
  acquired: string;
  /** Useful life in years, as the client's system carries it. */
  life: number;
  siteId: string;
  /** Book accumulated depreciation, for the files that print a net book value. */
  accumulated: number;
  /** ISO date, on the rows a register shows as gone. */
  disposedOn: string | null;
  vendor: string | null;
}

export interface CorpusBusiness {
  id: string;
  name: string;
  /** How the entity signs: LP, LLC, Inc. Renditions care. */
  entity: string;
  sic: string;
  /** What the business does, in the words its own people would use. */
  trade: string;
  sites: readonly CorpusSite[];
  assets: readonly CorpusAsset[];
}
