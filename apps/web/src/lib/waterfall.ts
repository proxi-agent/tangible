import type { SavingsReport } from '@tangible/types';

/**
 * The shape of the report as a walk from one value to another.
 *
 * Pulled out of the chart because it is now drawn twice — once as bars on the
 * screen and once as a table in the printable report — and the arithmetic below
 * is not the kind that survives being written down twice. Where the walk starts
 * depends on whether a district account exists and on which side of the register
 * it sits, and a printed PDF that quietly began at the register while the screen
 * began at the roll would disagree with itself by the largest number on the page.
 *
 * Everything here is a plain value. Labels, links and the explanations that hang
 * off the bars belong to whichever surface is drawing it.
 */
export interface WaterfallStep {
  /** Stable across both surfaces: a finding key, `roll-gap`, or `exemption`. */
  key: string;
  label: string;
  /** Value this step takes off. Always positive. */
  amount: number;
  /** The finding to open, when this step has assets behind it. */
  findingKey: string | null;
}

export interface WaterfallShape {
  /** What is being taxed today — the roll where it exceeds the books, else the books. */
  start: number;
  /** True when `start` is the district's number rather than the register's. */
  fromRoll: boolean;
  steps: WaterfallStep[];
  /** What a corrected return supports. */
  end: number;
}

/**
 * Compose the walk, or answer null when there is nothing to draw.
 *
 * The starting value is the roll when a district has the client above their own
 * books, and the gap between the two becomes the first step. That is where most
 * of the money on a first report lives: an appraiser with no rendition in hand
 * estimates, and estimates high, so a chart that started at the register would
 * leave that gap off the page while the headline saving counts it — the one
 * discrepancy a controller is guaranteed to find.
 *
 * A roll *below* the register is exposure, not saving. Drawing it as a step that
 * removes negative value would be a lie told with arithmetic, so there the walk
 * starts at the register and the gap is simply absent.
 */
export function waterfallShape(report: SavingsReport): WaterfallShape | null {
  const register = report.farImpliedValue + report.totalValueRemoved;
  const assessed = report.assessed?.assessedValue ?? null;
  const gap = assessed === null ? 0 : assessed - register;
  const fromRoll = gap > 0 && assessed !== null;
  const start = fromRoll ? assessed : register;
  if (start <= 0) return null;

  const steps: WaterfallStep[] = [
    ...(fromRoll
      ? [
          {
            key: 'roll-gap',
            label: 'The district’s estimate, above what your books show',
            amount: gap,
            findingKey: null,
          },
        ]
      : []),
    ...report.findings
      .filter((finding) => finding.valueRemoved !== null && finding.valueRemoved > 0)
      .sort((a, b) => (b.valueRemoved ?? 0) - (a.valueRemoved ?? 0))
      .map((finding) => ({
        key: finding.key,
        label: finding.title,
        amount: finding.valueRemoved ?? 0,
        findingKey: finding.key,
      })),
    ...(report.exemption.applied > 0
      ? [
          {
            key: 'exemption',
            label: report.exemption.label,
            amount: report.exemption.applied,
            findingKey: null,
          },
        ]
      : []),
  ];

  return { start, fromRoll, steps, end: report.proposedTaxableValue };
}
