import type { Rendition, RenditionLine, RenditionSchedule } from '@tangible/types';
import type { FormOmission, FormParty, FormSigner } from './form-50-144.js';
import { fillPinnedForm } from './fill-pdf.js';

/**
 * Fill the Comptroller's actual Form 50-144.
 *
 * The sibling of `buildForm50144`, not a layer on top of it: both render the
 * same rendition, one for a person to read and one for the district's own
 * paper. Neither depends on the other's formatting.
 *
 * Two things about the real form drive the whole design here.
 *
 * The first is that **the years are printed on the page.** Schedule E is not a
 * list of rows; it is six fixed ladders whose rungs are labelled 2025, 2024,
 * ... 2012 & Prior, typeset into this revision of the PDF. A cost does not go
 * in the row we choose, it goes in the rung its year names — and if the tax
 * year is not the one this revision was printed for, every rung is off by one
 * and the whole schedule is quietly wrong. So the tax year is checked, and a
 * mismatch stops the fill rather than shifting the numbers.
 *
 * The second is that **the form is smaller than a register.** Schedules A, B, C
 * and D hold three rows each and Schedule F holds five; a client with nine
 * inventory categories does not fit. The form's own answer is an attached
 * listing, which is ordinary practice — but it has to be counted and named, so
 * `overflow` says exactly what did not fit and where it went.
 *
 * Everything else follows the rule the document model already sets: a blank is
 * never a value. A field we cannot answer stays empty and turns up in
 * `omissions` naming what is missing, rather than being filled with a zero, a
 * guess, or today's date.
 */

/** The pinned revision. Filling a different one silently moves every field. */
export const FORM_50144_REVISION = '50-144 · 10/25';

/**
 * SHA-256 of `assets/50-144.pdf` as downloaded from comptroller.texas.gov.
 * Recorded so a swapped asset is a visible change rather than a surprise.
 */
export const FORM_50144_SHA256 = 'ab3203f315fcecf6a78f34e448b6f13b2126507b346f969afc860ef2dbe0e701';

/**
 * The newest year printed on this revision's Schedule E ladders.
 *
 * The rendition's assessment date is January 1, so nothing acquired in the tax
 * year itself is on the form: the top rung is always the year before, and this
 * revision's top rung says 2025.
 */
const LADDER_TOP_YEAR = 2025;

/** The one tax year this revision's printed ladder is correct for. */
export const FORM_50144_TAX_YEAR = LADDER_TOP_YEAR + 1;

/**
 * Schedule E's six sub-tables, in the order the form prints them.
 *
 * The letters are the form's field-name suffixes, and they are *not* the
 * schedule letters — `HCWN_1A` is row 1 of Furniture and Fixtures inside
 * Schedule E, not Schedule A. An easy and expensive thing to get backwards.
 *
 * Categories the form has no named table for go to "Other", which is the one
 * sub-table with a description column — so odd property gets named on the form
 * rather than folded into Machinery where nobody would find it again.
 */
interface SubTable {
  letter: string;
  title: string;
  /** Rungs before the total row. The last rung is the "& Prior" bucket. */
  rungs: number;
  /** Only "Other" lets us say what the property is. */
  describes: boolean;
  categories: readonly string[];
}

const SUB_TABLES: readonly SubTable[] = [
  {
    letter: 'A',
    title: 'Furniture and Fixtures',
    rungs: 14,
    describes: false,
    categories: ['furniture-fixtures', 'ffe'],
  },
  {
    letter: 'B',
    title: 'Machinery and Equipment',
    rungs: 14,
    describes: false,
    categories: ['machinery-equipment'],
  },
  {
    letter: 'C',
    title: 'Office Equipment',
    rungs: 14,
    describes: false,
    categories: ['office-equipment'],
  },
  {
    letter: 'D',
    title: 'Computer Equipment',
    rungs: 9,
    describes: false,
    categories: ['computer-pc'],
  },
  {
    letter: 'E',
    title: 'POS/Servers/Mainframes',
    rungs: 9,
    describes: false,
    categories: ['computer-mainframe'],
  },
  {
    letter: 'F',
    title: 'Other',
    rungs: 9,
    describes: true,
    categories: [],
  },
];

const OTHER = SUB_TABLES[SUB_TABLES.length - 1] as SubTable;

/** How the representation radio on page 1 spells each capacity. Verbatim. */
const REPRESENTATION_OPTION: Readonly<Record<string, string>> = {
  owner: 'Owner, employee or employee of an affiliated entity of the owner',
  employee: 'Owner, employee or employee of an affiliated entity of the owner',
  agent: 'Authorized Agent',
  // The leading space is the form's, not a typo. Match it or the radio throws.
  fiduciary: ' Fiduciary',
  'secured-party': 'Secured Party',
};

/** A value going into a named AcroForm text field. */
export interface FormFillText {
  field: string;
  value: string;
}

/** A radio or checkbox, with the option string the form itself uses. */
export interface FormFillChoice {
  field: string;
  /** Null checks a checkbox; a string selects that radio option. */
  option: string | null;
}

/** Property with no box on the printed form, and where it went instead. */
export interface FormOverflow {
  /** The table it belongs to, in the form's words. */
  schedule: string;
  reason: string;
  assetCount: number;
  historicalCost: number;
}

export interface FormFillPlan {
  revision: string;
  taxYear: number;
  /**
   * Set when filling this revision would put numbers in the wrong boxes, as
   * opposed to leaving boxes empty. An incomplete form is a form somebody can
   * see is incomplete; a form whose costs sit one row off is not, so this one
   * refuses to render rather than trusting anybody to notice.
   */
  blocked: string | null;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  /** What did not fit, for the attached listing the form asks for. */
  overflow: readonly FormOverflow[];
  /** Fields left deliberately blank, and why. */
  omissions: readonly FormOmission[];
}

export interface FormFillInput {
  rendition: Rendition;
  party: FormParty;
  signer: FormSigner;
}

/** Rows in each printed table on page 2. Counted off the form, not guessed. */
const PRINTED_ROWS = 3;
const BAILMENT_ROWS = 5;

/**
 * A money cell in the Schedule E grid, as plain digits.
 *
 * No commas on purpose. All 150 currency fields on page 3 carry an
 * `AFNumber_Format(0, 0, 0, 0, "", true)` action, so the viewer draws the
 * thousands separators itself, and each TOTAL additionally carries an
 * `AFSimple_Calculate("SUM", …)` over the rungs above it. Writing "185,000"
 * into a box whose own script is going to re-read it as a number is a way to
 * get 185 into a total, on a document nobody re-checks the arithmetic of.
 */
const gridMoney = (n: number): string => String(Math.round(n));

/**
 * A money cell in the printed tables on page 2.
 *
 * Grouped, unlike {@link gridMoney}: none of the 81 fields in Schedules A
 * through D carries a format or calculate action, so nothing re-reads these
 * and no viewer will add the separators later. A bare 1250000 in a column an
 * appraiser reads by eye is worth a misplaced digit.
 */
const money = (n: number): string => Math.round(n).toLocaleString('en-US');

const address = (lines: readonly string[]): string | null =>
  lines.length === 0 ? null : lines.join(', ');

const scheduleOf = (rendition: Rendition, key: string): RenditionSchedule | undefined =>
  rendition.schedules.find((s) => s.key === key);

/**
 * Which rung a year lands on, or why it has none.
 *
 * Rung 1 is the top year and the last rung is the "& Prior" bucket, so anything
 * old enough falls into it rather than off the ladder. Only two things miss:
 * a line with no year at all, and a year at or after the tax year — which
 * describes property that was not owned on the assessment date and should not
 * have reached the form.
 */
const rungFor = (
  year: number | null,
  taxYear: number,
  rungs: number,
): { rung: number } | { rung: null; reason: string } => {
  if (year === null) {
    return { rung: null, reason: 'no year acquired, so no rung on the printed ladder' };
  }
  const offset = taxYear - year;
  if (offset < 1) {
    return {
      rung: null,
      reason: `acquired in ${year}, which is not owned on the January 1 ${taxYear} assessment date`,
    };
  }
  return { rung: Math.min(offset, rungs) };
};

export function planFormFill(input: FormFillInput): FormFillPlan {
  const { rendition, party, signer } = input;
  const usingEstimate = rendition.basis === 'estimate';
  const text: FormFillText[] = [];
  const choices: FormFillChoice[] = [];
  const overflow: FormOverflow[] = [];
  const omissions: FormOmission[] = [];

  const put = (field: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') text.push({ field, value });
  };

  const omit = (
    field: string,
    missing: string,
    severity: FormOmission['severity'] = 'warning',
  ): void => {
    omissions.push({ field, missing, severity });
  };

  let blocked: string | null = null;
  if (rendition.taxYear !== FORM_50144_TAX_YEAR) {
    blocked = `Tax year ${rendition.taxYear} on a form printed for ${FORM_50144_TAX_YEAR}.`;
    omissions.push({
      field: 'Schedule E year ladder',
      missing:
        `This is the ${FORM_50144_REVISION} form, whose Schedule E rungs are printed ` +
        `${LADDER_TOP_YEAR} down to ${LADDER_TOP_YEAR - 13} & Prior — correct for tax year ` +
        `${FORM_50144_TAX_YEAR} only. This rendition is for ${rendition.taxYear}. Download the ` +
        'revision for that year before filing; filling this one would put every cost on the ' +
        'wrong year.',
      severity: 'blocking',
    });
  }

  // ---- Page 1: who and where -------------------------------------------

  put('Tax Year', String(rendition.taxYear));
  const account = rendition.accountId;
  if (account === null) {
    omit(
      'Appraisal District Account Number',
      'No account number on the engagement. A rendition without one is filed against a ' +
        'business the district has to identify by hand.',
    );
  } else {
    // The same number is printed on all three pages so loose sheets can be
    // reunited; the form gives each page its own field for it.
    for (const field of [
      'Appraisal District Account Number',
      'Account Number',
      'Account Number 2',
      'ADN',
    ]) {
      put(field, account);
    }
  }

  put('Business Name', party.ownerName);
  omit(
    'Business Owner',
    `We hold "${party.ownerName}" as the business. The form asks separately for who owns it, ` +
      'which we do not model — usually the same name, sometimes a holding entity.',
  );

  const situs = address(party.situsAddress);
  if (situs === null) {
    omit(
      'Property Location Address',
      'No situs address. This is the field that decides which district taxes the property, ' +
        'so the form cannot be filed without it.',
      'blocking',
    );
  } else {
    put('Property Location Address, City, State, ZIP Code', situs);
    // Schedules B and C ask again, per row, where the property is taxable.
    for (const key of ['B', 'C'] as const) {
      const schedule = scheduleOf(rendition, key);
      schedule?.lines.slice(0, PRINTED_ROWS).forEach((_, i) => {
        put(`Sc${key}:Property Address or Address Where TaxableRow${i + 1}`, situs);
      });
    }
  }

  omit(
    'Email / Phone',
    'No contact details on the client record. The district uses these to ask questions before it estimates.',
  );

  // ---- Page 1: representation ------------------------------------------

  const option = REPRESENTATION_OPTION[signer.capacity];
  if (option !== undefined) choices.push({ field: 'Representation', option });
  put('Name of Owner, Authorized Agent, Fiduciary or Secured Party', signer.name);
  const mailing = address(party.mailingAddress);
  if (mailing === null) {
    omit(
      'Representation’s Mailing Address',
      'No mailing address for whoever signs. This is where the district sends the notice of ' +
        'appraised value, so a wrong or missing one costs the protest window.',
      'blocking',
    );
  } else {
    put("Representation's Mailing Address, City, State, ZIP Code0", mailing);
  }

  if (signer.capacity === 'agent' && signer.appointmentFiledOn === null) {
    omissions.push({
      field: 'Agent appointment',
      missing:
        'Filed as agent with no Form 50-162 on file. The form requires the appointment before ' +
        'the district will process the rendition.',
      severity: 'blocking',
    });
  }

  // Truthful either way, and the only Section 2 question we can actually
  // answer: a signer who is not a secured party is not one.
  if (signer.capacity !== 'secured-party') {
    choices.push({ field: 'secured party', option: 'No' });
  } else {
    omit(
      'Secured party question',
      'A secured party has to say whether the property’s historical cost new is above $50,000 ' +
        '(Tax Code 22.01(c-1)). That is a question about the security interest, not the register.',
    );
  }
  omit(
    'Related business entity',
    'The form asks whether the filer is a related business entity. Not something the register ' +
      'knows; the signer answers it.',
  );

  put('Business Description', party.businessDescription);
  omit(
    'Did assets remain in place as of Jan. 1?',
    'A question about the location on the assessment date, not about the register.',
  );

  // ---- Page 1: Section 5, and what we will not assert ------------------

  choices.push({
    field: 'Total market value of your property',
    option: rendition.qualifiesForScheduleA ? 'under $20,000' : '$20,000 or more',
  });

  const estimate = rendition.totalGoodFaithEstimate;
  if (usingEstimate && estimate !== null) {
    const under = estimate <= 125_000;
    choices.push({
      field: 'Total market value of your property-2',
      option: under ? '$125,000 or less' : 'More than $125,000',
    });
    if (under) choices.push({ field: 'S5_market value', option: null });
  } else {
    // Two different silences, and saying which one it is matters: one is a
    // choice of basis, the other is a gap somebody could go and close.
    omit(
      'Market value $125,000 or less',
      usingEstimate
        ? 'Left blank on purpose. This rendition is filed on the estimate basis but the total ' +
            'estimate is withheld, because some property here cannot be valued — so there is no ' +
            'figure to hold against $125,000. Classify the unvaluable property and the box answers ' +
            'itself.'
        : 'Left blank on purpose. This rendition is filed on historical cost and year acquired, ' +
            'which states no market value — and checking a market-value box is an assertion, not a ' +
            'formality. Filing on the estimate basis answers it.',
    );
  }

  // ---- Page 1: Section 6 ------------------------------------------------

  put('Printed Name of Authorized Individual', signer.name);
  omit(
    'Signature and date',
    'Left blank on purpose. The signature is the signer’s and the date is the day they sign it; ' +
      'a date printed by us would say this was sworn on a day nobody swore anything.',
  );
  if (rendition.notarization.required) {
    omit(
      'Notary block',
      `Notarization required — ${rendition.notarization.reason} The day, month, year and notary ` +
        'lines are the notary’s to complete.',
    );
  }

  // ---- Page 2: Schedules A through D -----------------------------------

  fillListSchedule(
    rendition,
    'A',
    'ScA:General Property Description by TypeCategory',
    usingEstimate,
    put,
    overflow,
  );
  fillListSchedule(
    rendition,
    'B',
    'ScB:Property Description by TypeCategory',
    usingEstimate,
    put,
    overflow,
  );
  fillListSchedule(
    rendition,
    'C',
    'ScC:Property Description by TypeCategory',
    usingEstimate,
    put,
    overflow,
  );

  const vehicles = scheduleOf(rendition, 'D');
  if (vehicles && vehicles.lines.length > 0) {
    vehicles.lines.slice(0, PRINTED_ROWS).forEach((line, i) => {
      const row = i + 1;
      put(`ScD:Historical Cost When New Omit CentsRow${row}`, money(line.historicalCost));
      if (line.yearAcquired !== null) put(`ScD:Year AcquiredRow${row}`, String(line.yearAcquired));
      if (usingEstimate && line.goodFaithEstimate !== null) {
        put(`ScD:Good Faith Estimate of Market ValueRow${row}`, money(line.goodFaithEstimate));
      }
    });
    countOverflow(vehicles, 'Schedule D — vehicles', overflow);
    omit(
      'Schedule D year, make, model and VIN',
      'The register carries cost and year, not vehicle identity. The form marks those columns ' +
        'optional, but a district that cannot match the vehicle to its own source values it from ' +
        'cost instead, which is usually the higher number.',
    );
  }

  const inventory = scheduleOf(rendition, 'B');
  if (inventory && inventory.lines.length > 0) {
    omit(
      'Inventory questions (Sept. 1 date, interstate commerce, freeport)',
      'Three questions the form asks about inventory. Freeport in particular is worth an answer ' +
        'rather than a blank — an exemption goes unclaimed if nobody ticks it.',
    );
  }

  // ---- Page 3: Schedule E, on the printed ladder -----------------------

  const equipment = scheduleOf(rendition, 'E');
  if (equipment) fillLadder(equipment, rendition.taxYear, usingEstimate, put, overflow);

  // ---- Page 3: Schedule F ----------------------------------------------

  const bailment = scheduleOf(rendition, 'F');
  if (bailment && bailment.lines.length > 0) {
    bailment.lines.slice(0, BAILMENT_ROWS).forEach((line, i) => {
      put(`General Property DescriptionRow${i + 1}`, line.type);
    });
    countOverflow(bailment, 'Schedule F — property held but not owned', overflow, BAILMENT_ROWS);
    omissions.push({
      field: 'Schedule F owner names and addresses',
      missing:
        'Schedule F is a list of owners, and the register records leased-in property without ' +
        'recording who it belongs to. The description goes on; the name and address the district ' +
        'needs in order to assess the actual owner do not.',
      severity: 'blocking',
    });
  }

  return {
    revision: FORM_50144_REVISION,
    taxYear: rendition.taxYear,
    blocked,
    text,
    choices,
    overflow,
    omissions,
  };
}

const countOverflow = (
  schedule: RenditionSchedule,
  label: string,
  overflow: FormOverflow[],
  printed: number = PRINTED_ROWS,
): void => {
  const extra = schedule.lines.slice(printed);
  if (extra.length === 0) return;
  overflow.push({
    schedule: label,
    reason: `${extra.length} more ${extra.length === 1 ? 'line' : 'lines'} than the ${printed} the printed table holds — attach the listing the form asks for`,
    assetCount: extra.reduce((sum, l) => sum + l.assetCount, 0),
    historicalCost: extra.reduce((sum, l) => sum + l.historicalCost, 0),
  });
};

function fillListSchedule(
  rendition: Rendition,
  key: string,
  descriptionField: string,
  usingEstimate: boolean,
  put: (field: string, value: string | null) => void,
  overflow: FormOverflow[],
): void {
  const schedule = scheduleOf(rendition, key);
  if (!schedule || schedule.lines.length === 0) return;
  const prefix = `Sc${key}:`;
  schedule.lines.slice(0, PRINTED_ROWS).forEach((line, i) => {
    const row = i + 1;
    put(`${descriptionField}Row${row}`, line.type);
    put(`${prefix}Estimate of Quantity of Each TypeRow${row}`, String(line.assetCount));
    put(`${prefix}Historical Cost When NewRow${row}`, money(line.historicalCost));
    if (line.yearAcquired !== null)
      put(`${prefix}Year AcquiredRow${row}`, String(line.yearAcquired));
    if (usingEstimate && line.goodFaithEstimate !== null) {
      put(`${prefix}Good Faith Estimate of Market ValueRow${row}`, money(line.goodFaithEstimate));
    }
  });
  countOverflow(
    schedule,
    `Schedule ${key} — ${schedule.title.replace(/^Schedule \w+ — /, '')}`,
    overflow,
  );
}

const subTableFor = (line: RenditionLine): SubTable => {
  for (const table of SUB_TABLES) {
    if (line.categoryKeys.some((key) => table.categories.includes(key))) return table;
  }
  return OTHER;
};

/**
 * Schedule E: six ladders, costs summed onto the rung their year names.
 *
 * Note what this collapses. Two lines from the same sub-table and the same year
 * share a rung, and everything older than the bottom rung shares the "& Prior"
 * bucket — so a register with thirty distinct years still fits fourteen boxes.
 * That is why Schedule E has no row overflow: only property with no usable year
 * misses, and that is reported rather than rounded onto a rung.
 */
function fillLadder(
  schedule: RenditionSchedule,
  taxYear: number,
  usingEstimate: boolean,
  put: (field: string, value: string | null) => void,
  overflow: FormOverflow[],
): void {
  interface Cell {
    cost: number;
    estimate: number | null;
    types: string[];
  }
  const cells = new Map<string, Cell>();
  const unplaced = new Map<string, { assetCount: number; historicalCost: number }>();

  for (const line of schedule.lines) {
    const table = subTableFor(line);
    const placement = rungFor(line.yearAcquired, taxYear, table.rungs);
    if (placement.rung === null) {
      const at = unplaced.get(placement.reason) ?? { assetCount: 0, historicalCost: 0 };
      at.assetCount += line.assetCount;
      at.historicalCost += line.historicalCost;
      unplaced.set(placement.reason, at);
      continue;
    }
    const id = `${placement.rung}${table.letter}`;
    const cell = cells.get(id) ?? { cost: 0, estimate: null, types: [] };
    cell.cost += line.historicalCost;
    if (line.goodFaithEstimate !== null) {
      cell.estimate = (cell.estimate ?? 0) + line.goodFaithEstimate;
    }
    if (table.describes && !cell.types.includes(line.type)) cell.types.push(line.type);
    cells.set(id, cell);
  }

  for (const table of SUB_TABLES) {
    let cost = 0;
    let estimate: number | null = null;
    for (let rung = 1; rung <= table.rungs; rung += 1) {
      const cell = cells.get(`${rung}${table.letter}`);
      if (!cell) continue;
      // Accumulate what we printed, not what we held. The TOTAL below carries
      // AFSimple_Calculate("SUM", …) over these same rungs, so a total that
      // rounds the unrounded sum can sit a dollar off the column above it —
      // and then move on its own the first time the form recalculates.
      const printedCost = Math.round(cell.cost);
      put(`HCWN_${rung}${table.letter}`, gridMoney(printedCost));
      cost += printedCost;
      if (usingEstimate && cell.estimate !== null) {
        const printedEstimate = Math.round(cell.estimate);
        put(`GFEMV_${rung}${table.letter}`, gridMoney(printedEstimate));
        estimate = (estimate ?? 0) + printedEstimate;
      }
      if (table.describes && cell.types.length > 0) {
        put(`Description_${rung}`, cell.types.join('; '));
      }
    }
    if (cost === 0) continue;
    const totalRow = table.rungs + 1;
    put(`HCWNT_${totalRow}${table.letter}`, gridMoney(cost));
    if (usingEstimate && estimate !== null) {
      // The form drops the T from this one total field. Its own inconsistency,
      // not ours — write the name it actually has.
      const field =
        table.letter === 'F' ? `GFEMV_${totalRow}F` : `GFEMVT_${totalRow}${table.letter}`;
      put(field, gridMoney(estimate));
    }
  }

  for (const [reason, totals] of unplaced) {
    overflow.push({
      schedule: 'Schedule E — furniture, fixtures, machinery, equipment and computers',
      reason,
      assetCount: totals.assetCount,
      historicalCost: totals.historicalCost,
    });
  }
}

const templateUrl = (): URL => new URL('../assets/50-144.pdf', import.meta.url);

/**
 * Write a plan onto the pinned PDF.
 *
 * Every field name is checked against the document rather than assumed. If the
 * Comptroller republishes the form and renames a field, this throws naming the
 * field — which is the whole reason the PDF is pinned in the repo next to the
 * code that fills it. Silently dropping a cost onto the floor is the failure
 * mode worth spending an exception on.
 *
 * The signature field is never touched, and the form is left fillable rather
 * than flattened: whoever signs it may still need to correct something, and a
 * flattened form takes that away.
 */
export async function renderForm50144(plan: FormFillPlan): Promise<Uint8Array> {
  if (plan.blocked !== null) {
    throw new Error(
      `Refusing to fill Form 50-144: ${plan.blocked} Every cost would land one rung off the year ` +
        'it was acquired, and nothing on the printed page would say so.',
    );
  }
  return fillPinnedForm({
    template: templateUrl(),
    formLabel: 'Form 50-144',
    revision: FORM_50144_REVISION,
    text: plan.text,
    choices: plan.choices,
    driftHint: 're-read the form before filing anything from it.',
  });
}
