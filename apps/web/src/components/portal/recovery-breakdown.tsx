'use client';

import type { AcceptanceEvidenceView, ExpectedRecovery } from '@tangible/types';
import { routeAuthority } from '@tangible/savings';
import { moneyExact, percent } from '@/lib/format';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * What the position is worth once the odds are applied.
 *
 * The queue ranks on one number, and a queue that ranks on a number nobody can
 * take apart is a queue that has to be trusted rather than checked. So the
 * three discounts are printed separately: how sure we are the line is what we
 * say it is, how often a district concedes this kind of position, and — for
 * each prior year — whether the year can still be reopened at all.
 *
 * They are kept apart rather than multiplied into one because they fail
 * differently. A controller who thinks our confidence is optimistic has a
 * different argument from one who thinks districts fight harder than we assume,
 * and both should be able to make their argument against the specific factor
 * they disagree with instead of against the total.
 *
 * `acceptanceIsPlaceholder` is passed in rather than assumed: until enough
 * engagements have closed to measure a concession rate, that multiplier is a
 * stated assumption, and a number built on a stated assumption has to say so on
 * the same screen it appears on.
 *
 * `evidence` is the same disclosure made one grain finer. A firm eventually
 * knows what happens to disposal arguments and still has no idea what happens
 * to freeport ones, and at that point a single page-wide "measured" flag would
 * be attaching the firm's best-evidenced claim to its least-evidenced line. So
 * the tooltip answers about this argument, and says how many closed positions
 * stand behind it rather than only that some exist.
 */
export function RecoveryBreakdown({
  recovery,
  acceptanceIsPlaceholder,
  evidence = null,
}: {
  recovery: ExpectedRecovery;
  acceptanceIsPlaceholder: boolean;
  /**
   * The learned rate behind this particular finding, where there is one. The
   * page-wide flag says whether the firm has measured anything at all; this
   * says whether *this argument* was one of them, which is the question the
   * person reading the line is actually asking.
   */
  evidence?: AcceptanceEvidenceView | null;
}) {
  const { prospective, retroactive } = recovery;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Expected recovery</span>
        <span className="tabular text-sm font-semibold text-[var(--color-good)]">
          {moneyExact(recovery.expected)}
        </span>
      </div>

      <table className="w-full text-xs">
        <tbody>
          <Line
            label={`This year${retroactive.years.length > 0 ? '' : ' only'}`}
            gross={prospective.tax}
            net={prospective.expected}
          />
          {retroactive.years.map((year) => (
            <Line
              key={year.taxYear}
              label={`${year.taxYear}`}
              gross={year.tax}
              net={year.expected}
              note={`${percent(year.probabilityOpen, 0)} still open`}
            />
          ))}
          <tr className="border-t border-[var(--color-hairline-strong)]">
            <td className="py-1.5 font-medium">
              Best case, before the odds
              <InfoTip
                title="Best case"
                content="Every year won in full. What the three factors below discount."
                size={11}
                className="ml-1"
              />
            </td>
            <td className="tabular py-1.5 text-right whitespace-nowrap">
              {moneyExact(recovery.undiscounted)}
            </td>
            <td className="tabular py-1.5 text-right font-semibold whitespace-nowrap text-[var(--color-good)]">
              {moneyExact(recovery.expected)}
            </td>
          </tr>
        </tbody>
      </table>

      <ul className="space-y-1 text-xs text-[var(--color-ink-secondary)]">
        <li className="flex items-baseline justify-between gap-3">
          <span>How sure we are this line is what we say it is</span>
          <span className="tabular">{percent(recovery.probabilityCorrect, 0)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span>
            How often a district concedes a position like this
            {evidence?.measured ? (
              <InfoTip
                title="Measured, not assumed"
                content={`Taken from ${evidence.observations} position${evidence.observations === 1 ? '' : 's'} of this kind that a district has actually answered${evidence.localObservations > 0 ? `, ${evidence.localObservations} of them in this county` : ''}. It starts from the rate we assumed (${Math.round(evidence.prior * 100)}%) and is moved by those answers in proportion to how many there are — which is why a handful of outcomes shifts it a little rather than a lot.`}
                size={11}
                className="ml-1"
              />
            ) : acceptanceIsPlaceholder || evidence !== null ? (
              <InfoTip
                title="An assumption, not a measurement"
                content="No position of this kind has closed with enough district answers to measure the rate yet, so it is a stated constant. It is applied as a real multiplier from the start, so when outcomes arrive what changes is the value rather than the way the number is built."
                size={11}
                className="ml-1"
              />
            ) : null}
          </span>
          <span className="tabular">{percent(recovery.probabilityAccepted, 0)}</span>
        </li>
        {/*
          Why two lines of the same finding can carry different rates.
          Without this the page shows one number moving between rows with no
          account of itself, which reads as noise rather than as the one thing
          on this panel that was learned from the district instead of from us.
        */}
        {recovery.acceptanceLift ? (
          <li className="pl-3 text-[var(--color-ink-muted)]">
            Moved for this line by what it is flagged on: {lower(recovery.acceptanceLift.label)}.
            <InfoTip
              title="Measured on this evidence"
              content={recovery.acceptanceLift.basis}
              size={11}
              className="ml-1"
            />
          </li>
        ) : null}
        {retroactive.route ? (
          <li className="flex items-baseline justify-between gap-3">
            <span>Prior years go back under {routeAuthority(retroactive.route)}</span>
            <span className="tabular">{moneyExact(retroactive.expected)}</span>
          </li>
        ) : retroactive.years.length === 0 ? (
          <li>Nothing prior to this year is reachable for this kind of correction.</li>
        ) : null}
      </ul>
    </div>
  );
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function Line({
  label,
  gross,
  net,
  note,
}: {
  label: string;
  gross: number;
  net: number;
  note?: string;
}) {
  return (
    <tr className="border-b border-[var(--color-hairline)]">
      <td className="py-1.5 pr-2">
        {label}
        {note ? <span className="ml-1.5 text-[var(--color-ink-muted)]">{note}</span> : null}
      </td>
      <td className="tabular py-1.5 text-right whitespace-nowrap text-[var(--color-ink-muted)]">
        {moneyExact(gross)}
      </td>
      <td className="tabular py-1.5 text-right whitespace-nowrap">{moneyExact(net)}</td>
    </tr>
  );
}
