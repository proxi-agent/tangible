/**
 * How an appraisal district names itself on the paper it accepts.
 *
 * Needed because field one of Form 50-162 is the district, and nothing else in
 * this codebase holds that name. What we do hold is the county — the valuation
 * schedules call Harris "Harris County, TX" — and the two are not the same
 * string: the district is a separate legal entity, and Harris County Appraisal
 * District renamed itself Harris Central Appraisal District in 2023 while the
 * county went on being Harris County.
 *
 * So this is a lookup and not a derivation. "<County> County Appraisal
 * District" would produce a plausible, wrong name for Harris and for every
 * district that calls itself Central, on a document filed with that entity.
 * Every entry here is the district's own name; an id that is not listed
 * returns null and the form refuses to print rather than guessing, which is a
 * one-line fix in this file the first time it comes up.
 */
const DISTRICT_NAME: Readonly<Record<string, string>> = {
  'tx-harris': 'Harris Central Appraisal District',
  'tx-dallas': 'Dallas Central Appraisal District',
  'tx-tarrant': 'Tarrant Appraisal District',
  'tx-bexar': 'Bexar Appraisal District',
  'tx-travis': 'Travis Central Appraisal District',
  'tx-collin': 'Collin Central Appraisal District',
  'tx-denton': 'Denton Central Appraisal District',
  'tx-fort-bend': 'Fort Bend Central Appraisal District',
  'tx-williamson': 'Williamson Central Appraisal District',
  'tx-montgomery': 'Montgomery Central Appraisal District',
  'tx-galveston': 'Galveston Central Appraisal District',
  'tx-el-paso': 'El Paso Central Appraisal District',
};

/** The district's own name, or null where we have not recorded it. */
export function appraisalDistrictName(jurisdictionId: string): string | null {
  return DISTRICT_NAME[jurisdictionId] ?? null;
}

/**
 * Every district we can print a form for, for a picker to offer.
 *
 * Deliberately the same table rather than a second list: an id offered here and
 * missing above would be a choice that silently makes the form unprintable.
 */
export const APPRAISAL_DISTRICTS: readonly { id: string; name: string }[] = Object.entries(
  DISTRICT_NAME,
)
  .map(([id, name]) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
