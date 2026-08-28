import { appraise, type Appraisal, type AppraisalGap, type AppraisalInput } from './appraise.js';
import type { DepreciationSchedule } from './types.js';

/**
 * What a purchase will cost in property tax, every year, before it is booked.
 *
 * `appraise` answers what an asset is worth this year. That is the right
 * question for a register that already exists, and the wrong one for a purchase
 * that has not happened yet: nobody decides how to code an invoice on the
 * strength of one year's tax. The decision is made against the whole stream,
 * because the same $200,000 is assessed again every January until it reaches
 * the district's floor, and a line coded into a fifteen-year class rather than
 * a five-year one is a commitment for a decade.
 *
 * The arithmetic is `appraise` walked over age rather than over calendar years,
 * which the schedules make exact: a district's tables are keyed to *year
 * acquired*, so an asset of age k is valued on the row the schedule publishes
 * for `taxYear - k`. Projecting is therefore not a forecast of anything — it is
 * this year's published table read at every age the asset will pass through.
 *
 * The one assumption, stated because it is the only one: the district
 * republishes tables of the same shape. Index factors drift a point or two a
 * year and percent-good columns are stable for a decade at a time, so the
 * stream is a good estimate and not a quotation. Anything that turned on the
 * third decimal of year nine would be a misuse of it.
 */

/** How far out to project before giving up. Longer than any published life. */
const HORIZON = 40;

export interface ProjectedYear {
  taxYear: number;
  /** Januaries since the purchase. Age 1 is the first assessment. */
  age: number;
  marketValue: number;
  tax: number;
  /** True once the asset has bottomed out in the district's own model. */
  atFloor: boolean;
}

export interface Projection {
  /** The appraisal for the first year the asset is assessed. */
  first: Appraisal;
  /** The first assessed tax year, which is the January after the purchase. */
  firstTaxYear: number;
  years: ProjectedYear[];
  /**
   * Every year's tax added up, undiscounted.
   *
   * Undiscounted deliberately. A discount rate is a finance assumption this
   * product has no standing to make on a client's behalf, and the number it
   * would change is the one a controller is going to sanity-check by hand.
   */
  lifetimeTax: number;
  /**
   * Tax in the first assessed year — the year the January 1 rule can remove,
   * and the largest single year in the stream.
   */
  firstYearTax: number;
  /**
   * Lifetime tax per $1,000 of cost booked into this category.
   *
   * The number that prices a split. An invoice that bundles equipment with
   * software does not come with the split written on it, and nobody knows the
   * amounts at the point the coding decision is made — but everybody knows that
   * a thousand dollars moved from one line to the other is worth this.
   */
  perThousand: number;
  /** True where the projection ran out of horizon rather than reaching a floor. */
  truncated: boolean;
}

export type ProjectionResult = { ok: true; value: Projection } | { ok: false; gap: AppraisalGap };

/**
 * Project one purchase across its assessed life.
 *
 * `acquisitionYear` on the input is the year the asset is *bought*, not the
 * first year it is taxed. Business personal property is assessed on what was
 * owned on January 1, so a purchase in March is first rendered the following
 * January — which is why the published tables start at age 1 and why an asset
 * bought on the 28th of December and one bought on the 2nd of January are a
 * whole year of tax apart.
 */
export function project(
  input: AppraisalInput,
  schedule: DepreciationSchedule,
  taxRate: number,
): ProjectionResult {
  const years: ProjectedYear[] = [];
  let first: Appraisal | null = null;

  for (let age = 1; age <= HORIZON; age += 1) {
    // The schedule is a table of ages wearing calendar clothes: its row for
    // `taxYear - age` *is* the row for an asset of this age. Reading it that
    // way is what lets one published guide price a purchase that has not
    // happened yet.
    const result = appraise({ ...input, acquisitionYear: schedule.taxYear - age }, schedule);
    if (!result.ok) {
      // A gap at age 1 is a gap in the whole projection; a gap further out
      // would mean the table has a hole in the middle, which `appraise`
      // already refuses to interpolate around.
      if (age === 1) return result;
      break;
    }

    const value = result.value;
    if (first === null) first = value;

    years.push({
      taxYear: input.acquisitionYear + age,
      age,
      marketValue: value.marketValue,
      tax: value.marketValue * taxRate,
      atFloor: value.atFloor,
    });

    // Once the district's model says the asset is fully depreciated, the years
    // after it are the same number repeated. Exempt and non-depreciating
    // property never reaches a floor and would run to the horizon, so both stop
    // here too: a projection that printed forty identical rows for inventory
    // would be arithmetically right and useless.
    if (value.atFloor || value.exempt || value.schedule === 'none') break;
  }

  if (first === null || years.length === 0) {
    return {
      ok: false,
      gap: { reason: 'no-schedule', detail: 'No year of this schedule applies' },
    };
  }

  const lifetimeTax = years.reduce((sum, year) => sum + year.tax, 0);
  const perThousand = input.originalCost > 0 ? (lifetimeTax / input.originalCost) * 1000 : 0;

  return {
    ok: true,
    value: {
      first,
      firstTaxYear: years[0]!.taxYear,
      years,
      lifetimeTax,
      firstYearTax: years[0]!.tax,
      perThousand,
      truncated: years.length === HORIZON && !years[years.length - 1]!.atFloor,
    },
  };
}
