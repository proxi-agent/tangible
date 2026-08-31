/**
 * How an appraisal district names itself on the paper it accepts.
 *
 * Needed because field one of Forms 50-162, 50-132 and 50-771 is the district,
 * and nothing else in this codebase holds that name. What we do hold is the
 * county — the valuation schedules call Harris "Harris County, TX" — and the
 * two are not the same string: the district is a separate legal entity, and
 * Harris County Appraisal District renamed itself Harris Central Appraisal
 * District in 2023 while the county went on being Harris County.
 *
 * So this is a lookup and not a derivation, and the size of the difference is
 * the reason it stayed a lookup once it grew to cover the state. Of the 253
 * districts in `districts.data.ts`, **91 are not "<County> County Appraisal
 * District"** — 36% of them. Seventy-four insert "Central"; thirteen drop the
 * word "County" altogether (Tarrant, Bexar, Comal, Ellis, Milam, Wichita and
 * seven more); three put the county at the end, as in "Tax Appraisal District
 * of Bell County"; and one is Potter-Randall. A rule that built the name out of
 * the county would be wrong on more than one filing in three, and wrong
 * invisibly, on a document filed with the entity it misnames.
 *
 * An id that is not listed still returns null and the form still refuses to
 * print rather than guessing. That branch is now about a county outside Texas
 * rather than a Texas county nobody has typed in yet.
 */

import {
  DISTRICT_RECORDS,
  type AppraisalDistrictCounty,
  type AppraisalDistrictRecord,
} from './districts.data.js';

export type { AppraisalDistrictCounty, AppraisalDistrictRecord };

/**
 * Jurisdiction id to district.
 *
 * Keyed by county rather than by district because that is what the rest of the
 * repo holds: a site sits in a county, and `tx-harris` is the id it carries.
 * Potter and Randall are two keys onto one record, which is the whole reason
 * this map and {@link APPRAISAL_DISTRICTS} are built separately below.
 */
const BY_JURISDICTION: ReadonlyMap<string, AppraisalDistrictRecord> = new Map(
  DISTRICT_RECORDS.flatMap((district) =>
    district.counties.map((county) => [county.id, district] as const),
  ),
);

/** The district's own name, or null where we have not recorded it. */
export function appraisalDistrictName(jurisdictionId: string): string | null {
  return BY_JURISDICTION.get(jurisdictionId)?.name ?? null;
}

/**
 * The county a jurisdiction id names, as the county calls itself.
 *
 * Every county blank on Forms 50-132, 50-771 and 50-230 wants this and not the
 * district's name — "Harris", not "Harris Central Appraisal District", because
 * each of those blanks sits in a sentence that has already printed the rest.
 * Read off the record rather than off the id so a shared district gives the
 * right half of itself: `tx-potter` is Potter, not Potter-Randall.
 */
export function appraisalDistrictCounty(jurisdictionId: string): string | null {
  const district = BY_JURISDICTION.get(jurisdictionId);
  return district?.counties.find((county) => county.id === jurisdictionId)?.name ?? null;
}

/**
 * Everything published about the district a jurisdiction belongs to.
 *
 * The name is what goes on the form; the mailing address is where the form
 * goes, which under Tax Code 1.08 is the difference between a timely filing and
 * a late one, since a properly addressed and postmarked document is filed on
 * the day it was mailed.
 */
export function appraisalDistrict(jurisdictionId: string): AppraisalDistrictRecord | null {
  return BY_JURISDICTION.get(jurisdictionId) ?? null;
}

/** One row of a district picker: a jurisdiction id and how to show it. */
export interface AppraisalDistrictOption {
  id: string;
  /** The district's own name — the string that would go on a form. */
  name: string;
  /** How to show it in a list, which is not always the name. See below. */
  label: string;
}

/**
 * Every district we can print a form for, for a picker to offer.
 *
 * Deliberately derived from the same table rather than a second list: an id
 * offered here and missing above would be a choice that silently makes the form
 * unprintable.
 *
 * One row per *county*, not per district, because the value a picker sets is a
 * jurisdiction id and that is what a site carries. For 252 districts the two
 * are the same thing. Potter-Randall is the exception, and it is the reason
 * `label` exists: two rows would otherwise read "Potter-Randall County
 * Appraisal District" twice with no way to tell which one puts the site in
 * Potter. Only a shared district gets the county appended, so the other 252
 * rows are not padded with a word that adds nothing.
 */
export const APPRAISAL_DISTRICTS: readonly AppraisalDistrictOption[] = DISTRICT_RECORDS.flatMap(
  (district) =>
    district.counties.map((county) => ({
      id: county.id,
      name: district.name,
      label:
        district.counties.length > 1 ? `${district.name} — ${county.name} County` : district.name,
    })),
).sort((a, b) => a.label.localeCompare(b.label));
