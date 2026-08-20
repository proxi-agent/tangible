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

export interface DepreciationSchedule {
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
  /** The table to depreciate against, or 'none' for property carried at full cost. */
  schedule: LifeClass | SpecialSchedule | 'none';
  /** Whether original cost is multiplied by the year's cost index first. */
  indexed: boolean;
  /**
   * Whether the taxpayer's SIC code decides the life, with `schedule` standing
   * in only until it is known. True for machinery, where the district's own
   * tables give a life per line of business.
   */
  sicDriven?: boolean;
  /** What the district's guide says this covers, for the review UI and prompts. */
  description: string;
}
