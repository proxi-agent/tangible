'use client';

import type { FindingRow, TaxChain } from '@tangible/types';
import { cn } from '@/lib/cn';
import { moneyExact, percent } from '@/lib/format';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * One asset's walk from cost to tax, twice.
 *
 * The report used to print a single blended rate and a single dollar figure,
 * which is correct arithmetic and an unarguable claim: a controller who doubts
 * the number has nothing to point at, and an appraiser who disagrees with one
 * step has to reject the whole line. So each step the district itself takes is
 * printed, in the order they take it, as-filed beside as-corrected — and the
 * disagreement then shows up on the step it happens on.
 *
 * Two things are deliberate. The assessment ratio is its own row even in Texas,
 * where it is 1 and contributes nothing: the moment a second state lands it is
 * the step that carries the difference, and a chain that only grows a row when
 * the arithmetic starts to matter is a chain nobody has been reading. And a
 * null never becomes a zero — a row with no acquisition year has no index
 * factor, and printing 1.0 there would assert a fact about a year nobody knows.
 */
export function TaxChainTable({ row }: { row: FindingRow }) {
  if (!row.chain) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">
        This report predates the per-asset chain. The next analysis run prints every step from cost
        to tax for this line.
      </p>
    );
  }

  const { asFiled, asCorrected } = row.chain;

  const steps: {
    key: string;
    label: string;
    help?: string;
    filed: string;
    corrected: string;
    /** The bottom line of each half — the two numbers the argument is between. */
    emphasis?: boolean;
  }[] = [
    {
      key: 'cost',
      label: 'Assessable cost',
      help: 'Original cost, less anything inside it we have identified as not being taxable property — freight is assessable in Texas, a software licence and a service contract are not. Equal to original cost on any line where no invoice has been read.',
      filed: moneyExact(asFiled.assessableCost),
      corrected: moneyExact(asCorrected.assessableCost),
    },
    {
      key: 'index',
      label: 'Index factor',
      help: 'The district’s own inflation factor for the acquisition year, taking historical cost up to what the same property would cost new today.',
      filed: factor(asFiled.indexFactor),
      corrected: factor(asCorrected.indexFactor),
    },
    {
      key: 'rcn',
      label: 'Replacement cost new',
      filed: moneyExact(asFiled.replacementCostNew),
      corrected: moneyExact(asCorrected.replacementCostNew),
    },
    {
      key: 'good',
      label: 'Percent good',
      help: 'How much life the district’s published schedule says is left in property of this class at this age.',
      filed: pct(asFiled.percentGood),
      corrected: pct(asCorrected.percentGood),
    },
    {
      key: 'market',
      label: 'Market value',
      filed: moneyExact(asFiled.marketValue),
      corrected: moneyExact(asCorrected.marketValue),
    },
    {
      key: 'ratio',
      label: 'Assessment ratio',
      help: 'The share of market value a state actually assesses. Texas and Florida assess the whole of it, so this step changes nothing here — it is printed because it is a step the district takes, and in other states it is the one that moves the number most.',
      filed: ratio(asFiled.assessmentRatio),
      corrected: ratio(asCorrected.assessmentRatio),
    },
    {
      key: 'assessed',
      label: 'Assessed value',
      filed: moneyExact(asFiled.assessedValue),
      corrected: moneyExact(asCorrected.assessedValue),
    },
    {
      key: 'millage',
      label: 'Rate',
      help: 'Tax per dollar of assessed value, blended across every taxing unit whose boundaries this site falls inside.',
      filed: percent(asFiled.millage, 2),
      corrected: percent(asCorrected.millage, 2),
    },
    {
      key: 'tax',
      label: 'Tax for the year',
      filed: moneyExact(asFiled.tax),
      corrected: moneyExact(asCorrected.tax),
      emphasis: true,
    },
  ];

  const difference = delta(asFiled, asCorrected);

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-hairline)]">
            <th className="eyebrow py-1.5 text-left font-medium">Step</th>
            <th className="eyebrow py-1.5 text-right font-medium">As it stands</th>
            <th className="eyebrow py-1.5 text-right font-medium">Corrected</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.key} className="border-b border-[var(--color-hairline)] last:border-0">
              <td className="py-1.5 pr-2">
                {step.label}
                {step.help ? (
                  <InfoTip title={step.label} content={step.help} size={11} className="ml-1" />
                ) : null}
              </td>
              <td
                className={cn(
                  'tabular py-1.5 text-right whitespace-nowrap',
                  step.emphasis && 'font-semibold',
                )}
              >
                {step.filed}
              </td>
              <td
                className={cn(
                  'tabular py-1.5 text-right whitespace-nowrap',
                  step.emphasis
                    ? 'font-semibold text-[var(--color-good)]'
                    : step.filed !== step.corrected
                      ? 'text-[var(--color-good)]'
                      : 'text-[var(--color-ink-muted)]',
                )}
              >
                {step.corrected}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {difference !== null ? (
        <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">
          {moneyExact(difference)} of tax a year rides on this line — before any allowance for the
          district disagreeing, which is what the recovery below applies.
        </p>
      ) : null}
    </div>
  );
}

/** Null propagates: a step nobody can compute prints as a dash, never as zero. */
function delta(asFiled: TaxChain, asCorrected: TaxChain): number | null {
  if (asFiled.tax === null || asCorrected.tax === null) return null;
  return asFiled.tax - asCorrected.tax;
}

function factor(value: number | null): string {
  return value === null ? '—' : `× ${value.toFixed(2)}`;
}

/** Percent good arrives 0–100 off the district's table, not as a fraction. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

function ratio(value: number): string {
  return value === 1 ? '× 1 (assessed in full)' : `× ${value.toFixed(2)}`;
}
