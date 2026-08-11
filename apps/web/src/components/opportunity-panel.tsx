'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SEGMENT_KEYS, type SegmentKey } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent } from '@/lib/format';
import { Card, CardHeader, Skeleton } from '@/components/ui/primitives';
import { Field, Select, TextInput } from '@/components/ui/controls';

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
        description="Multiplies a real account count by two stated assumptions. The ceiling is not a forecast."
      />

      <div className="grid gap-3 border-b border-[var(--color-hairline)] p-5 sm:grid-cols-3">
        <Field label="Segment">
          <Select value={segment} onChange={(e) => setSegment(e.target.value as SegmentKey)}>
            {SEGMENT_KEYS.map((key) => (
              <option key={key} value={key}>
                {key.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price / account / yr">
          <TextInput
            type="number"
            min={1}
            step={1}
            value={price}
            onChange={(e) => setPrice(Math.max(1, Number(e.target.value)))}
            className="tabular"
          />
        </Field>
        <Field label="Conversion rate (%)">
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
              label="Addressable accounts"
              value={count(data.addressableAccounts)}
              hint="Accounts in the segment today"
            />
            <Figure
              label="Expected ARR"
              value={money(data.expectedRevenue)}
              hint={`${count(Math.round(data.expectedAccounts))} customers at ${percent(conversion / 100, 1)}`}
            />
            <Figure
              label="Ceiling ARR"
              value={money(data.totalAddressableRevenue)}
              hint="Every account converted"
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

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{hint}</p>
    </div>
  );
}
