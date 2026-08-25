'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SEGMENTS, SEGMENT_LIST, type SegmentDefinition, type SegmentKey } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent } from '@/lib/format';
import { Card, CardHeader, Skeleton } from '@/components/ui/primitives';
import { Field, Select, TextInput } from '@/components/ui/controls';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * The dropdown reads as sentences, not identifiers. `core_icp` told you nothing
 * unless you already knew the vocabulary; "Best-fit targets — chronic
 * non-filers, no tax agent" tells you what you are about to price.
 */
const TIER_GROUPS: { tier: SegmentDefinition['tier']; label: string }[] = [
  { tier: 'target', label: 'Who to sell to' },
  { tier: 'exposure', label: 'Who owes a penalty' },
  { tier: 'market', label: 'The whole market' },
  { tier: 'signal', label: 'Weaker signals' },
];

const SEGMENT_SUBTITLES: Record<SegmentKey, string> = {
  core_icp: 'chronic non-filers, no tax agent',
  chronic_nonfiler: 'never filed, any year',
  intermittent_nonfiler: 'skipped half their years or more',
  unfiled: 'no filing this year',
  filed_late: 'filed after the April 15 deadline',
  taxable: 'every account above the exemption',
  frozen_value: 'value never changes',
  never_declines: 'value only ever goes up',
  agent_represented: 'already has a tax agent',
};

/**
 * The feasibility question, made arguable rather than asserted.
 *
 * The two assumptions — price and conversion — are editable inputs, and the
 * number that decides the pitch is shown last: whether the subscription costs
 * less than the penalty it removes. If it does not, segment size is irrelevant.
 */
export function OpportunityPanel({
  jurisdictionId,
  taxYear,
}: {
  jurisdictionId: string;
  taxYear: number;
}) {
  const [segment, setSegment] = useState<SegmentKey>('core_icp');
  const [price, setPrice] = useState(399);
  const [conversion, setConversion] = useState(3.5);

  const { data, isLoading } = useQuery({
    queryKey: ['opportunity', jurisdictionId, taxYear, segment, price, conversion],
    queryFn: () =>
      api.opportunity({
        jurisdictionId,
        taxYear,
        segment,
        pricePerAccount: price,
        conversionRate: conversion / 100,
      }),
    enabled: Boolean(jurisdictionId) && price > 0,
  });

  return (
    <Card>
      <CardHeader
        title="Revenue model"
        description="If you sold a filing service to these businesses, what would it be worth?"
        help="Pick who you would sell to, set a price and a hit rate, and the arithmetic follows. The ceiling is arithmetic over the roll, not a forecast — it says what the segment is worth if everything converts, which nothing does."
      />

      <div className="grid gap-3 border-b border-[var(--color-hairline)] p-5 sm:grid-cols-3">
        <Field
          label="Who you would sell to"
          help="Each option is a named slice of the county roll. Narrower slices are smaller but easier to sell to, because the problem they have is more clearly theirs."
        >
          <Select value={segment} onChange={(e) => setSegment(e.target.value as SegmentKey)}>
            {TIER_GROUPS.map((group) => {
              const inGroup = SEGMENT_LIST.filter((s) => s.tier === group.tier);
              if (inGroup.length === 0) return null;
              return (
                <optgroup key={group.tier} label={group.label}>
                  {inGroup.map((definition) => (
                    <option key={definition.key} value={definition.key}>
                      {definition.label} — {SEGMENT_SUBTITLES[definition.key]}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </Field>
        <Field
          label="Price per account, per year"
          help="What one business would pay you annually to have its rendition filed on time."
        >
          <TextInput
            type="number"
            min={1}
            step={1}
            value={price}
            onChange={(e) => setPrice(Math.max(1, Number(e.target.value)))}
            className="tabular"
          />
        </Field>
        <Field
          label="Share who would buy (%)"
          help="Of every account in the slice above, the percentage you assume becomes a paying customer. 3–5% is a common outbound assumption; nothing here validates it."
        >
          <TextInput
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={conversion}
            onChange={(e) => setConversion(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="tabular"
          />
        </Field>
      </div>

      <p className="border-b border-[var(--color-hairline)] px-5 py-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        <strong className="font-semibold text-[var(--color-ink)]">
          {SEGMENTS[segment].label}:
        </strong>{' '}
        {SEGMENTS[segment].description}
        {SEGMENTS[segment].caveat ? (
          <span className="text-[var(--color-ink-muted)]"> {SEGMENTS[segment].caveat}</span>
        ) : null}
      </p>

      {isLoading || !data ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <div className="p-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Figure
              label="Businesses you could call"
              value={count(data.addressableAccounts)}
              hint="Accounts in this slice today"
              help="A real count from the county's own file for the selected year — not an estimate."
            />
            <Figure
              label="Revenue per year"
              value={money(data.expectedRevenue)}
              hint={`${count(Math.round(data.expectedAccounts))} customers at ${percent(conversion / 100, 1)}`}
              help="Accounts × the share who buy × the price. Recurring, because the filing is due again every year."
            />
            <Figure
              label="If every one bought"
              value={money(data.totalAddressableRevenue)}
              hint="The ceiling, not a target"
              help="The whole slice paying full price. Nobody converts a market completely; this is the upper bound the estimate above sits under."
            />
          </div>

          <div className="mt-5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-4">
            <p className="text-xs text-[var(--color-ink-secondary)]">
              The median account in this segment pays{' '}
              <strong className="tabular font-semibold text-[var(--color-ink)]">
                {moneyExact(data.medianPenaltyPerAccount)}
              </strong>{' '}
              a year in penalties.
            </p>
            {data.medianCustomerSavings === null ? null : data.medianCustomerSavings > 0 ? (
              <p className="mt-1.5 text-xs">
                At {moneyExact(price)} the product saves them{' '}
                <strong className="tabular font-semibold text-[var(--color-good)]">
                  {moneyExact(data.medianCustomerSavings)}
                </strong>{' '}
                — the pitch pays for itself.
              </p>
            ) : (
              <p className="mt-1.5 text-xs">
                At {moneyExact(price)} the product costs the median account{' '}
                <strong className="tabular font-semibold text-[var(--color-critical)]">
                  {moneyExact(Math.abs(data.medianCustomerSavings))}
                </strong>{' '}
                more than the penalty it removes. Segment size does not rescue that.
              </p>
            )}
            <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
              Total penalty burden across the segment: {moneyExact(data.currentPenaltyBurden)} per year.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  help,
}: {
  label: string;
  value: string;
  hint: string;
  help: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
        {label}
        <InfoTip title={label} content={help} size={11} />
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{hint}</p>
    </div>
  );
}
