import type {
  ExtractedRendition,
  FootingIssue,
  FootingResult,
  PriorReturnSchedule,
  RenditionScheduleKey,
} from '@tangible/types';

/**
 * Check a extracted prior rendition against itself.
 *
 * A filed tax form carries its own proof. Each schedule prints a total, the
 * lines under it sum to that total, and the schedule totals sum to the form's
 * grand total. Reading the parts and the printed totals *independently* turns
 * that redundancy into a test the extraction has to pass: a model that reads
 * $185,000 as $18,500 produces a form that no longer adds up, and says so,
 * rather than becoming the silent baseline every later finding is measured
 * against.
 *
 * This is the same free cross-check the HCAD guide gave by printing its SIC
 * tables twice, and it is worth as much here. It is also the reason this whole
 * function is pure and has no model in it — the check is only worth anything if
 * it is independent of the thing it is checking.
 *
 * **A form that does not foot is not discarded.** Filers make arithmetic errors,
 * and a prior return whose schedules do not add up is a finding in its own
 * right — one that may be worth more than anything in the register. What a
 * discrepancy buys is a refusal to treat the figures as settled until a person
 * has looked, which is what `status` carries.
 */

/**
 * Forms are filed in whole dollars and rounded by hand. A dollar of slack per
 * line absorbs that without absorbing a transposition, which is the error this
 * is actually hunting: the smallest digit-swap on a four-figure line is $9.
 */
const TOLERANCE_PER_LINE = 1;
const MIN_TOLERANCE = 1;

function toleranceFor(lineCount: number): number {
  return Math.max(MIN_TOLERANCE, lineCount * TOLERANCE_PER_LINE);
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * What a line contributes to a total.
 *
 * Cost when the filer used the cost basis, estimate when they used the
 * estimate. A line carrying both is filed on cost — the form's Schedule E asks
 * for cost and year, and an estimate written beside it is supplementary.
 * Summing both would double-count the same property.
 */
function lineValue(line: { historicalCost: number | null; goodFaithEstimate: number | null }) {
  return line.historicalCost ?? line.goodFaithEstimate ?? null;
}

function sumLines(schedule: PriorReturnSchedule): { total: number; unreadable: number } {
  let total = 0;
  let unreadable = 0;
  for (const line of schedule.lines) {
    const value = lineValue(line);
    if (value === null) unreadable += 1;
    else total += value;
  }
  return { total, unreadable };
}

/** Schedule A exists for accounts under $20,000, and the form says so on its face. */
const SCHEDULE_A_CEILING = 20_000;

export interface VerifyOptions {
  /** The engagement's tax year, to sanity-check the one printed on the form. */
  expectedTaxYear?: number | null;
  /**
   * The accounts the engagement files under. A district opens one per business
   * location, so a multi-site client has several and a prior return is only the
   * wrong document if it names none of them.
   */
  expectedAccountIds?: readonly string[];
}

export function verifyRendition(
  rendition: ExtractedRendition,
  options: VerifyOptions = {},
): FootingResult {
  const issues: FootingIssue[] = [];
  const push = (
    severity: FootingIssue['severity'],
    code: string,
    message: string,
    extra: Partial<FootingIssue> = {},
  ) => {
    issues.push({
      severity,
      code,
      message,
      schedule: extra.schedule ?? null,
      expected: extra.expected ?? null,
      actual: extra.actual ?? null,
    });
  };

  let derivedTotal = 0;
  let lineCount = 0;
  let statedScheduleSum = 0;
  let statedScheduleCount = 0;

  for (const schedule of rendition.schedules) {
    const { total, unreadable } = sumLines(schedule);
    derivedTotal += total;
    lineCount += schedule.lines.length;

    if (unreadable > 0) {
      push(
        'warning',
        'line-without-value',
        `Schedule ${schedule.key} has ${unreadable} ${unreadable === 1 ? 'line' : 'lines'} with neither a cost nor an estimate. Those lines contribute nothing to the totals below.`,
        { schedule: schedule.key },
      );
    }

    // The footing check proper.
    if (schedule.statedTotal !== null) {
      statedScheduleSum += schedule.statedTotal;
      statedScheduleCount += 1;
      const drift = Math.abs(schedule.statedTotal - total);
      if (drift > toleranceFor(schedule.lines.length)) {
        push(
          'error',
          'schedule-does-not-foot',
          `Schedule ${schedule.key} prints a total of ${money(schedule.statedTotal)}, but its ${schedule.lines.length} ${schedule.lines.length === 1 ? 'line adds' : 'lines add'} to ${money(total)} — a difference of ${money(drift)}. Either a line was misread or the return itself does not add up.`,
          { schedule: schedule.key, expected: schedule.statedTotal, actual: total },
        );
      }
    } else if (schedule.lines.length > 0) {
      push(
        'warning',
        'no-stated-total',
        `Schedule ${schedule.key} has lines but no printed total to check them against, so nothing corroborates how they were read.`,
        { schedule: schedule.key },
      );
    }

    // Schedule E is the one filed by year acquired, and a line without a year
    // cannot be aged — which is exactly what a comparison needs it for.
    if (schedule.key === 'E') {
      const yearless = schedule.lines.filter((line) => line.yearAcquired === null).length;
      if (yearless > 0) {
        push(
          'warning',
          'schedule-e-missing-year',
          `${yearless} Schedule E ${yearless === 1 ? 'line has' : 'lines have'} no year acquired. Schedule E is filed by year, and without it these lines cannot be aged against a depreciation schedule.`,
          { schedule: schedule.key },
        );
      }
    }

    if (schedule.key === 'A' && schedule.statedTotal !== null) {
      if (schedule.statedTotal >= SCHEDULE_A_CEILING) {
        push(
          'warning',
          'schedule-a-over-ceiling',
          `Schedule A totals ${money(schedule.statedTotal)}, at or above the ${money(SCHEDULE_A_CEILING)} the form reserves it for. Either the account did not qualify or property belongs on another schedule.`,
          { schedule: schedule.key, expected: SCHEDULE_A_CEILING, actual: schedule.statedTotal },
        );
      }
    }
  }

  // The second footing: schedule totals against the form's grand total. Checked
  // against the *stated* schedule totals where we have them, because that
  // isolates which of the two sums is wrong instead of collapsing both errors
  // into one number.
  if (rendition.statedFormTotal !== null) {
    const basis = statedScheduleCount > 0 ? statedScheduleSum : derivedTotal;
    const drift = Math.abs(rendition.statedFormTotal - basis);
    if (drift > toleranceFor(Math.max(lineCount, rendition.schedules.length))) {
      push(
        'error',
        'form-does-not-foot',
        `The form prints a total of ${money(rendition.statedFormTotal)}, but its schedules add to ${money(basis)} — a difference of ${money(drift)}.`,
        { expected: rendition.statedFormTotal, actual: basis },
      );
    }
  } else if (lineCount > 0) {
    push(
      'warning',
      'no-form-total',
      'The form has no readable grand total, so the schedules have nothing to be checked against as a whole.',
    );
  }

  // Identity: is this the document we think it is?
  if (options.expectedAccountIds?.length && rendition.accountId) {
    const filed = rendition.accountId.replace(/\D/g, '');
    const ours = options.expectedAccountIds.map((id) => id.replace(/\D/g, '')).filter(Boolean);
    if (filed && ours.length > 0 && !ours.includes(filed)) {
      const named =
        options.expectedAccountIds.length === 1
          ? `account ${options.expectedAccountIds[0]}`
          : `accounts ${options.expectedAccountIds.join(', ')}`;
      push(
        'error',
        'account-mismatch',
        `This return is filed under account ${rendition.accountId}, but the engagement files under ${named}. Comparing a different account's filing would attribute someone else's numbers to this client.`,
      );
    }
  }

  if (
    options.expectedTaxYear &&
    rendition.taxYear &&
    rendition.taxYear !== options.expectedTaxYear
  ) {
    push(
      'warning',
      'tax-year-mismatch',
      `This return is for ${rendition.taxYear}, and the engagement is for ${options.expectedTaxYear}. That is normal for a prior-year filing — confirm it is the year you meant to compare against.`,
      { expected: options.expectedTaxYear, actual: rendition.taxYear },
    );
  }

  // Plausibility of what was read, independent of any total.
  for (const schedule of rendition.schedules) {
    for (const line of schedule.lines) {
      const value = lineValue(line);
      if (value !== null && value < 0) {
        push(
          'error',
          'negative-line',
          `Schedule ${schedule.key} line "${line.type}" carries a negative amount of ${money(value)}. A rendition reports cost, which cannot be negative.`,
          { schedule: schedule.key, actual: value },
        );
      }
      if (line.yearAcquired !== null) {
        const ceiling = rendition.taxYear ?? new Date().getFullYear();
        if (line.yearAcquired < 1900 || line.yearAcquired > ceiling) {
          push(
            'error',
            'implausible-year',
            `Schedule ${schedule.key} line "${line.type}" is dated ${line.yearAcquired}, which is outside the range a ${ceiling} return can report.`,
            { schedule: schedule.key, actual: line.yearAcquired },
          );
        }
      }
    }
  }

  if (rendition.unreadable.length > 0) {
    push(
      'warning',
      'unreadable-regions',
      `The extractor could not read ${rendition.unreadable.length} ${rendition.unreadable.length === 1 ? 'region' : 'regions'} of the document: ${rendition.unreadable.join('; ')}.`,
    );
  }

  if (lineCount === 0) {
    push('error', 'no-lines', 'No schedule lines were read from this document at all.');
  }

  const status = issues.some((issue) => issue.severity === 'error') ? 'discrepant' : 'verified';

  return {
    status,
    issues,
    derivedTotal,
    statedTotal: rendition.statedFormTotal,
    lineCount,
  };
}

/**
 * The reported figures rolled to the grain a comparison uses.
 *
 * Keyed by schedule, property type and year acquired — the form's own grain, not
 * ours. Mapping the filer's wording onto our category vocabulary is a separate
 * decision with its own review, because "Machinery & Equip" and "Shop
 * Equipment" are the client's words and deciding they mean `machinery-equipment`
 * is a judgement, not a lookup.
 */
export function rollupReported(
  rendition: ExtractedRendition,
): Map<
  string,
  { schedule: RenditionScheduleKey; type: string; yearAcquired: number | null; value: number }
> {
  const rolled = new Map<
    string,
    { schedule: RenditionScheduleKey; type: string; yearAcquired: number | null; value: number }
  >();
  for (const schedule of rendition.schedules) {
    for (const line of schedule.lines) {
      const value = lineValue(line);
      if (value === null) continue;
      const type = line.type.trim();
      const key = `${schedule.key}|${type.toLowerCase()}|${line.yearAcquired ?? '~'}`;
      const entry = rolled.get(key);
      if (entry) entry.value += value;
      else
        rolled.set(key, {
          schedule: schedule.key,
          type,
          yearAcquired: line.yearAcquired,
          value,
        });
    }
  }
  return rolled;
}
