import type { RuleProvenance } from '@tangible/types';

/**
 * What a jurisdiction publishes about how it values business personal property.
 *
 * Texas appraisal districts publish their whole method: cost index factors by
 * year acquired, percent-good tables by life class, and which asset categories
 * get which life. That is the entire basis of an assessment, which means a
 * client's own numbers can be run through the district's own arithmetic and the
 * result compared against what they were actually assessed. This module is that
 * arithmetic; the schedules themselves are committed data with a citation.
 */

/** Life classes the general age/life table publishes, in years. */
export const LIFE_CLASSES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const;
export type LifeClass = (typeof LIFE_CLASSES)[number];

/**
 * Schedules keyed by equipment type rather than a life in years. These carry no
 * cost index — HCAD depreciates them straight off original cost, because the
 * equipment does not appreciate in replacement terms the way machinery does.
 */
export const SPECIAL_SCHEDULES = [
  'pc',
  'spc',
  'mf',
  'telecom4',
  'telecom6',
  'telecom8',
  'solar10',
] as const;
export type SpecialSchedule = (typeof SPECIAL_SCHEDULES)[number];

/**
 * What a district publishes about one line of business.
 *
 * The life a machine depreciates on is a property of the *taxpayer*, not of the
 * machine: the district reads it off the SIC code. A bakery's ovens and a
 * machine shop's lathes are both "machinery and equipment" and they are not
 * depreciated alike.
 */
export interface SicProfile {
  /** The district's own wording, so a picker shows what the taxpayer would recognise. */
  description: string;
  /** Life for machinery and equipment, in years. */
  machineryLife: LifeClass;
  /**
   * The guide's second life column. Carried for reference and deliberately not
   * applied: page 1 already fixes furniture at 8 and office equipment at 6, and
   * whether this column overrides those is not established.
   */
  miscLife: LifeClass;
  /** Texas state class the district assigns this line of business. */
  stateClass: string | null;
}

/**
 * Whether the numbers below are the district's, or a placeholder for them.
 *
 * The second state made this necessary. Everything about a jurisdiction other
 * than its depreciation tables — which categories exist, what is exempt, what
 * the exemption is worth, which statute reaches a prior year, when the return
 * is due — can be established from statutes and forms that are public, stable,
 * and citable. The tables cannot: they are a grid of several hundred cells in a
 * PDF, and there is no honest way to produce them except to transcribe them.
 *
 * So a jurisdiction can be wired up before its tables are transcribed, and the
 * schedule says which state it is in. An `awaiting-transcription` schedule
 * carries empty tables on purpose. `appraise` then returns a gap for every
 * asset instead of a number, which is the correct behaviour: a missing index
 * factor read as 1.000 would understate the district's market value, which
 * overstates the client's overpayment, which is the one direction an error in
 * this product must never go.
 */
export type ScheduleStatus = 'committed' | 'awaiting-transcription';

export interface ScheduleGap {
  /** The document that has to be read, named the way it is published. */
  document: string;
  url: string | null;
  /** Which tables are still missing out of it. */
  missing: string[];
}

export interface DepreciationSchedule {
  /**
   * Who says so, since when, and who signed it off.
   *
   * Required rather than optional, which is the entire point: a district's
   * depreciation table decides what a client is assessed, and one that arrived
   * in the repo without a citation, an effective window and an approver is a
   * number somebody typed. Making the field mandatory means a new county cannot
   * be added without answering all four, and the release gate can then check
   * things a reviewer would otherwise have to remember — that the schedule is
   * still in effect, that it names its own jurisdiction and year, and that a
   * person with standing approved it.
   *
   * `source` below is kept as well, and duplicates part of this. It is the
   * arithmetic's own citation, used in report footnotes where the reader wants
   * the guide and its page rather than the approval record.
   */
  provenance: RuleProvenance;
  jurisdictionId: string;
  /** How a person says it — "Harris County, TX". For pickers and reports. */
  jurisdictionName: string;
  taxYear: number;
  source: { title: string; url: string; pages: string };
  /** Year acquired → cost index factor. */
  indexFactors: Readonly<Record<number, number>>;
  /** Life class → year acquired → percent good (0–100). */
  percentGood: Readonly<Record<LifeClass, Readonly<Record<number, number>>>>;
  /** Special schedule → year acquired → percent good (0–100). */
  specialPercentGood: Readonly<Record<SpecialSchedule, Readonly<Record<number, number>>>>;
  /** SIC code → the lives that line of business depreciates on. */
  sicProfiles: Readonly<Record<string, SicProfile>>;
  /**
   * How this jurisdiction values each category, where it differs from the
   * default table.
   *
   * The category *keys* are shared across every jurisdiction and always will
   * be: they are the vocabulary a register is classified into, they are what a
   * reviewer's decision is remembered against, and re-keying them per state
   * would throw away every classification the moment a client crossed a state
   * line. What is not shared is what a key means for valuation. "Office
   * furniture" is an eight-year indexed class in Harris County and a ten-year
   * one under Florida's guidelines; "inventory" is rendered at full cost in
   * Texas and is not taxable property at all in Florida. Same key, different
   * arithmetic, and the difference belongs to the jurisdiction rather than to
   * the asset.
   *
   * Absent means "the default table applies", which keeps every Texas district
   * a schedule with no category block.
   */
  categories?: Readonly<Record<string, CategoryRule>>;
  /**
   * True where this schedule is the state's own standard rather than one
   * county's, and a county with nothing of its own should fall back to it.
   *
   * Opt-in per schedule, never a blanket rule, because in most of the country
   * it would be wrong. Texas districts each publish their own guide and several
   * of them disagree; valuing a Dallas client against Harris County's tables
   * because both start with `tx-` is exactly the silent error this codebase
   * refuses elsewhere. Florida is the case where it is right: the Department of
   * Revenue publishes one set of guidelines the whole state appraises against,
   * and a county schedule, where one exists, is the exception.
   */
  appliesStatewide?: boolean;
  status: ScheduleStatus;
  /** Set when `status` is `awaiting-transcription`. Printed, not hidden. */
  awaiting?: ScheduleGap;
}

/**
 * How a category of property is valued. Two things vary independently and both
 * matter: which depreciation table applies, and whether cost is trended to
 * replacement cost new first. Vehicles and computers are depreciated off
 * original cost directly; furniture and machinery are indexed first.
 */
export interface CategoryRule {
  key: string;
  label: string;
  /**
   * The table to depreciate against, `'none'` for property carried at full
   * cost, or `'exempt'` for property this jurisdiction does not tax at all.
   *
   * `'none'` and `'exempt'` are not the same answer and collapsing them would
   * be a real error. Texas inventory is `'none'`: it is taxable, it goes on
   * Schedule C of the rendition, and it is carried at 100% of cost. Florida
   * inventory is `'exempt'`: s. 196.185 takes it off the roll entirely, it does
   * not belong on the DR-405, and a client who reported it is overpaying the
   * whole of the tax on it rather than being valued generously.
   */
  schedule: LifeClass | SpecialSchedule | 'none' | 'exempt';
  /** Whether original cost is multiplied by the year's cost index first. */
  indexed: boolean;
  /**
   * Whether the taxpayer's SIC code decides the life, with `schedule` standing
   * in only until it is known. True for machinery, where the district's own
   * tables give a life per line of business.
   */
  sicDriven?: boolean;
  /**
   * Why the property is not taxed here. Required in spirit whenever `schedule`
   * is `'exempt'` — the report prints it, and "exempt because the table says
   * so" is not a position anybody can take to an assessor.
   */
  exemptAuthority?: string;
  /** What the district's guide says this covers, for the review UI and prompts. */
  description: string;
}
