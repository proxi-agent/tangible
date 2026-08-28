'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EngagementRecovery, RecoveryClaimRecord } from '@tangible/types';
import { api } from '@/lib/api';
import { count, moneyExact, percent, plural } from '@/lib/format';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';
import { Button, Field, TextInput } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';

/**
 * What we claimed, and what we got.
 *
 * The scoreboard above answers this at the grain a district works at. This one
 * answers it at the grain the *arguments* were made at, which is the only grain
 * that can say which arguments are worth making again. A season where the
 * district took $600,000 off looks identical on the scoreboard whether it
 * conceded every ghost asset or every misclassification; here the difference is
 * the whole content.
 *
 * The one thing this card refuses to blur is where a number came from. A row
 * whose amount is a share of an unitemized settlement is labelled as such
 * everywhere it appears, and the totals keep documented tax apart from
 * estimated tax rather than adding them into a single figure that would be
 * neither.
 */
export function RecoveryCard({ engagementId }: { engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-recovery', engagementId],
    queryFn: () => api.recovery(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;
  // Nothing has gone to a district yet. The returns board is already the
  // to-do list; a scoreboard with no game behind it would only repeat it.
  if (data.claims.length === 0) return null;

  const { summary } = data;
  const hitRate = summary.valueClaimed > 0 ? summary.valueAllowed / summary.valueClaimed : null;

  return (
    <Card>
      <CardHeader
        title="What was claimed, and what came back"
        description={`${count(summary.claims)} ${plural(summary.claims, 'position')} taken to a district across ${count(data.byYear.length)} ${plural(data.byYear.length, 'year')}.`}
        help="A position is one asset under one finding for one year — the grain an argument is made at. The district settles at the account level, so which of these it agreed with is sometimes stated and sometimes only assumed. The card says which."
      />

      <StatGrid columns={5} className="border-b border-[var(--color-hairline)]">
        <StatCell className="px-5 py-4">
          <Stat
            label="Value claimed"
            value={moneyExact(summary.valueClaimed)}
            help="Assessed value the positions asked the district to take off."
          />
        </StatCell>
        <StatCell className="px-5 py-4">
          <Stat
            label="Value allowed"
            value={moneyExact(summary.valueAllowed)}
            note={hitRate === null ? undefined : `${percent(hitRate)} of what was asked`}
            help="What the district actually took off, so far as anybody has recorded it. Open positions count as nothing rather than as a loss."
          />
        </StatCell>
        <StatCell className="px-5 py-4">
          <Stat
            label="Tax documented"
            value={moneyExact(summary.taxDocumented)}
            help="Money on a refund cheque or a corrected bill. Never a rate multiplication — this figure and the estimate beside it are different kinds of number and are never added."
          />
        </StatCell>
        <StatCell className="px-5 py-4">
          <Stat
            label="Tax estimated"
            value={summary.taxEstimated === null ? '—' : moneyExact(summary.taxEstimated)}
            note="value allowed × blended rate"
            help="What the value allowed implies at the rate on file, for the positions where no refund figure was recorded. An estimate, and it overlaps nothing in the documented column."
          />
        </StatCell>
        <StatCell className="px-5 py-4">
          <Stat
            label="Scoreable"
            value={`${count(summary.learnable)} / ${count(summary.settled)}`}
            note={`${count(summary.pending)} still open`}
            help="Settled positions the district said something specific about. A settlement split in proportion, and a position withdrawn before it was heard, are both reported and neither teaches the model anything."
          />
        </StatCell>
      </StatGrid>

      <ByFinding data={data} />

      {data.caveats.length > 0 ? (
        <div className="space-y-2 px-5 pb-4">
          {data.caveats.map((caveat) => (
            <Callout key={caveat} tone="neutral">
              {caveat}
            </Callout>
          ))}
        </div>
      ) : null}

      <div className="px-5 pb-5">
        <Settle engagementId={engagementId} data={data} />
      </div>
    </Card>
  );
}

interface Group {
  key: string;
  taxYear: number;
  findingKey: string;
  findingTitle: string;
  claims: RecoveryClaimRecord[];
  claimed: number;
  allowed: number;
  pending: number;
  proRata: number;
}

/**
 * Grouped to the argument, newest year first.
 *
 * Not to the asset, even though that is the storage grain: a ghost-asset
 * finding across two hundred lines is one argument the district either took or
 * did not, and two hundred rows would bury that. The asset grain is what makes
 * the *next* season's prediction possible, not what makes this season readable.
 */
function ByFinding({ data }: { data: EngagementRecovery }) {
  const groups = new Map<string, Group>();
  for (const claim of data.claims) {
    const key = `${claim.taxYear}:${claim.findingKey}`;
    const group = groups.get(key) ?? {
      key,
      taxYear: claim.taxYear,
      findingKey: claim.findingKey,
      findingTitle: claim.findingTitle,
      claims: [],
      claimed: 0,
      allowed: 0,
      pending: 0,
      proRata: 0,
    };
    group.claims.push(claim);
    group.claimed += claim.valueClaimed ?? 0;
    group.allowed += claim.outcome?.valueAllowed ?? 0;
    if (claim.outcome === null) group.pending += 1;
    if (claim.outcome?.allocation === 'pro-rata') group.proRata += 1;
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a, b) => b.taxYear - a.taxYear || b.claimed - a.claimed);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-xs">
        <thead>
          <tr className="text-2xs border-b border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2">Year</th>
            <th className="px-3 py-2">Argument</th>
            <th className="px-3 py-2 text-right">Items</th>
            <th className="px-3 py-2 text-right">Claimed</th>
            <th className="px-3 py-2 text-right">Allowed</th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="Allowed as a share of claimed. Open positions are excluded from neither number — they claimed something and were allowed nothing yet, which is what the count beside it says.">
                <span>Rate</span>
              </Tooltip>
            </th>
            <th className="px-5 py-2">Standing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {rows.map((group) => (
            <tr key={group.key} className="align-top">
              <td className="tabular px-5 py-2.5">{group.taxYear}</td>
              <td className="px-3 py-2.5">{group.findingTitle}</td>
              <td className="tabular px-3 py-2.5 text-right">{count(group.claims.length)}</td>
              <td className="tabular px-3 py-2.5 text-right">{moneyExact(group.claimed)}</td>
              <td className="tabular px-3 py-2.5 text-right">{moneyExact(group.allowed)}</td>
              <td className="tabular px-3 py-2.5 text-right">
                {group.claimed > 0 ? percent(group.allowed / group.claimed) : '—'}
              </td>
              <td className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {group.pending > 0 ? (
                    <Badge tone="neutral">{count(group.pending)} open</Badge>
                  ) : null}
                  {group.proRata > 0 ? (
                    <Badge tone="warning">
                      <span className="inline-flex items-center gap-1">
                        Share of a settlement
                        <InfoTip
                          title="Share of a settlement"
                          content="The district agreed a figure for the whole account without saying which positions it allowed. This amount is that figure split in proportion to what each position asked for — reportable, but not evidence about this argument."
                          size={11}
                        />
                      </span>
                    </Badge>
                  ) : null}
                  {group.pending === 0 && group.proRata === 0 ? (
                    <Badge tone="good">Answered position by position</Badge>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Record what the district did.
 *
 * Deliberately the plainest possible form: a year, and the one number the
 * district stated. That is what a firm actually has in front of them — a
 * settlement letter with a figure on it — and asking for anything more
 * elaborate is how a record stops getting kept.
 *
 * A resolution recorded against a notice already lands here on its own. This is
 * for everything that never came through a protest: an informal call, a refund
 * on a motion, a corrected bill that simply arrived.
 */
function Settle({ engagementId, data }: { engagementId: string; data: EngagementRecovery }) {
  const queryClient = useQueryClient();
  const years = data.byYear.map((year) => year.taxYear);
  const [taxYear, setTaxYear] = useState(String(years[years.length - 1] ?? ''));
  const [removed, setRemoved] = useState('');
  const [resolvedOn, setResolvedOn] = useState('');
  const [tax, setTax] = useState('');
  const [open, setOpen] = useState(false);

  const record = useMutation({
    mutationFn: () =>
      api.recordSettlement(engagementId, {
        locationId: null,
        taxYear: Number(taxYear),
        resolvedOn,
        resolutionId: null,
        settledValueRemoved: Number(removed),
        taxRecovered: tax === '' ? null : Number(tax),
        perClaim: null,
        note: null,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(['engagement-recovery', engagementId], result);
      setOpen(false);
      setRemoved('');
      setTax('');
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Record a settlement
      </Button>
    );
  }

  const ready = taxYear !== '' && removed !== '' && resolvedOn !== '';

  return (
    <div className="space-y-3 rounded-md border border-[var(--color-hairline)] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Year" help="The tax year the district's letter is about.">
          <select
            value={taxYear}
            onChange={(event) => setTaxYear(event.target.value)}
            className="w-full rounded-md border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Value taken off"
          help="The single figure the district agreed to remove from the account. It is split across the open positions in proportion to what each asked for, and every resulting row is labelled as a share rather than as the district's own answer."
        >
          <TextInput
            compact
            inputMode="decimal"
            value={removed}
            onChange={(event) => setRemoved(event.target.value)}
            placeholder="600000"
          />
        </Field>
        <Field label="Dated" help="The date on the district's letter or order.">
          <TextInput
            compact
            type="date"
            value={resolvedOn}
            onChange={(event) => setResolvedOn(event.target.value)}
          />
        </Field>
        <Field
          label="Refund, if any"
          help="Only a figure somebody can point at — a cheque, a corrected bill. Left blank, the tax is estimated at the rate on file and reported separately."
        >
          <TextInput
            compact
            inputMode="decimal"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
            placeholder="optional"
          />
        </Field>
      </div>
      {record.error ? <ErrorState error={record.error} /> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!ready || record.isPending} onClick={() => record.mutate()}>
          {record.isPending ? 'Recording…' : 'Record'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
