'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Scissors, Ban, Ruler, Calculator } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AdviceLever, CapitalizationAdvice } from '@tangible/types';
import { api } from '@/lib/api';
import { money, moneyExact, percent } from '@/lib/format';
import { Button, TextInput } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';

/**
 * What a purchase will cost in property tax, asked before it is booked.
 *
 * Every other screen in this workspace argues about a decision somebody made
 * years ago. This one is the same argument at the only moment it is cheap: the
 * coding of the invoice is still open, the split is still on the paperwork, and
 * moving a line from "equipment" to "software" is a keystroke rather than an
 * amended rendition, a 25.25 motion and a hearing.
 *
 * Three deliberate absences.
 *
 * Nothing is saved. There is no history, no list of past questions, and no
 * asset created — a controller pricing three quotes they will not buy should
 * leave no trace, and a hypothetical that turned into a record is how a
 * workspace becomes untrustworthy.
 *
 * The stream is shown in full rather than as a single number. A lifetime total
 * with no years under it is a number nobody can check; the table is the
 * district's own arithmetic at every age, and a controller who wants to argue
 * with year six can see year six.
 *
 * And an unpriceable lever prints no dollar sign. The split lever is the
 * valuable one and cannot be priced until somebody reads the invoice, so it
 * carries the per-thousand rate instead — the honest form of the same answer,
 * and the one that survives being quoted back.
 */
export function PrecapAdvisor({ engagementId }: { engagementId: string }) {
  const now = new Date();
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [glAccount, setGlAccount] = useState('');
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const advise = useMutation({
    mutationFn: () =>
      api.advise(engagementId, {
        description: description.trim(),
        glAccount: glAccount.trim() ? glAccount.trim() : null,
        registerCategory: null,
        usefulLife: null,
        cost: Number(cost),
        acquisitionYear: Number(year),
        acquisitionMonth: Number(month),
      }),
  });

  const costValue = Number(cost);
  const ready =
    description.trim().length > 0 &&
    Number.isFinite(costValue) &&
    costValue > 0 &&
    year.length === 4;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) advise.mutate();
  };

  return (
    <Card padded={false}>
      <CardHeader
        icon={Calculator}
        title="Before it is booked"
        description="What a purchase will be assessed, every year, on the district's own schedule — asked while the coding decision is still open."
        help="Business personal property is assessed on what was owned on January 1, and again every January until the district's tables bottom out. A purchase priced here is priced against the same schedule, the same classification engine and the same blended rate the savings report uses; nothing typed here is saved."
      />

      <form onSubmit={submit} className="grid gap-3 px-5 py-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="grid gap-1">
          <span className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            What it is
          </span>
          <TextInput
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Off the quote — “Hobart HL662 mixer” or “POS system implementation”"
            maxLength={500}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            Cost
          </span>
          <TextInput
            value={cost}
            inputMode="decimal"
            onChange={(event) => setCost(event.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="180000"
            className="tabular"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            In service
          </span>
          <div className="flex gap-1">
            <TextInput
              value={month}
              inputMode="numeric"
              aria-label="Month placed in service"
              onChange={(event) => setMonth(event.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              className="tabular w-14"
            />
            <TextInput
              value={year}
              inputMode="numeric"
              aria-label="Year placed in service"
              onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              className="tabular"
            />
          </div>
        </label>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={!ready || advise.isPending}>
            {advise.isPending ? 'Pricing…' : 'Price it'}
          </Button>
        </div>
        <label className="grid gap-1 sm:col-span-4">
          <span className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            GL account, if it is already decided
          </span>
          <TextInput
            value={glAccount}
            onChange={(event) => setGlAccount(event.target.value)}
            placeholder="Optional — the engine reads it the same way it reads a register"
            maxLength={120}
          />
        </label>
      </form>

      {advise.error ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-4">
          <ErrorState error={advise.error} />
        </div>
      ) : null}

      {advise.isPending ? (
        <div className="grid gap-2 border-t border-[var(--color-hairline)] px-5 py-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : null}

      {advise.data && !advise.isPending ? <Answer advice={advise.data.advice} /> : null}

      {!advise.data && !advise.isPending && !advise.error ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-6">
          <EmptyState title="Nothing priced yet">
            A line coded into a fifteen-year class rather than a five-year one is a commitment for a
            decade, and it is made in a second by whoever types the invoice. Describe the purchase
            the way the quote does — the wording is what the classification engine reads.
          </EmptyState>
        </div>
      ) : null}
    </Card>
  );
}

function Answer({ advice }: { advice: CapitalizationAdvice }) {
  const { classification, stream, gap } = advice;

  return (
    <div className="border-t border-[var(--color-hairline)]">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <Badge tone={classification.excluded ? 'good' : 'accent'}>{classification.label}</Badge>
        <Badge tone="neutral">
          {classification.source === 'memory'
            ? 'a decision somebody already made'
            : classification.source === 'ai'
              ? 'classified by the model'
              : 'not classified'}
        </Badge>
        {classification.confidence !== null ? (
          <span className="tabular text-xs text-[var(--color-ink-muted)]">
            {percent(classification.confidence)} confident
          </span>
        ) : null}
        {advice.jurisdictionName ? (
          <span className="ml-auto text-xs text-[var(--color-ink-muted)]">
            {advice.jurisdictionName} · {advice.scheduleTaxYear} tables · {percent(advice.taxRate)}{' '}
            blended
          </span>
        ) : null}
      </div>

      <p className="px-5 pb-4 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
        {classification.rationale}
      </p>

      {gap ? (
        <div className="px-5 pb-4">
          <Callout tone="warning" title="This purchase could not be priced">
            {gap.detail}
          </Callout>
        </div>
      ) : null}

      {stream ? (
        <>
          <StatGrid columns={3}>
            <StatCell>
              <Stat
                label="Over its assessed life"
                value={money(stream.lifetimeTax)}
                size="lg"
                help="Every assessed year added up, undiscounted. The district assesses this again each January until its own tables bottom out."
                note={`${stream.years.length} assessed years from ${stream.firstTaxYear}`}
              />
            </StatCell>
            <StatCell>
              <Stat
                label={`First year — ${stream.firstTaxYear}`}
                value={money(stream.firstYearTax)}
                help="The largest year in the stream, and the one the January 1 rule can remove entirely."
              />
            </StatCell>
            <StatCell>
              <Stat
                label="Per $1,000 booked"
                value={moneyExact(stream.perThousand)}
                help="What a thousand dollars of this invoice costs in property tax across the whole stream. This is the number that prices a split nobody has the amounts for yet."
              />
            </StatCell>
          </StatGrid>

          <div className="overflow-x-auto px-5 pb-5">
            <table className="min-w-[34rem] text-xs">
              <thead>
                <tr className="text-2xs border-y border-[var(--color-hairline)] tracking-wide text-[var(--color-ink-muted)] uppercase">
                  <th className="py-2 pr-4 text-left font-medium">Tax year</th>
                  <th className="py-2 pr-4 text-left font-medium">Age</th>
                  <th className="py-2 pr-4 text-right font-medium">District value</th>
                  <th className="py-2 text-right font-medium">Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-hairline)]">
                {stream.years.map((year) => (
                  <tr key={year.taxYear}>
                    <td className="tabular py-1.5 pr-4">{year.taxYear}</td>
                    <td className="tabular py-1.5 pr-4 text-[var(--color-ink-muted)]">
                      {year.age}
                      {year.atFloor ? (
                        <span className="ml-2 text-[var(--color-ink-muted)]">
                          fully depreciated
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular py-1.5 pr-4 text-right">{money(year.marketValue)}</td>
                    <td className="tabular py-1.5 text-right">{moneyExact(year.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {advice.levers.length > 0 ? (
        <div className="grid gap-3 border-t border-[var(--color-hairline)] px-5 py-4">
          <h3 className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            What could be done differently
          </h3>
          {advice.levers.map((lever, index) => (
            <Lever key={`${lever.kind}-${index}`} lever={lever} />
          ))}
        </div>
      ) : null}

      {advice.included.length > 0 ? (
        <div className="grid gap-2 border-t border-[var(--color-hairline)] px-5 py-4">
          <h3 className="text-2xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            And what stays in the cost
          </h3>
          {advice.included.map((item) => (
            <p
              key={item.phrase}
              className="text-xs leading-relaxed text-[var(--color-ink-secondary)]"
            >
              <span className="font-medium text-[var(--color-ink)]">{item.phrase}</span> —{' '}
              {item.note}
            </p>
          ))}
        </div>
      ) : null}

      {advice.caveats.length > 0 ? (
        <ul className="grid gap-1.5 border-t border-[var(--color-hairline)] px-5 py-4">
          {advice.caveats.map((caveat) => (
            <li key={caveat} className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
              {caveat}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const LEVER_ICONS = {
  exclusion: Ban,
  split: Scissors,
  life: Ruler,
  timing: CalendarClock,
} as const;

function Lever({ lever }: { lever: AdviceLever }) {
  const Icon = LEVER_ICONS[lever.kind];
  return (
    <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-sunken)] px-4 py-3">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
        <div className="grid gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-[var(--color-ink)]">{lever.title}</span>
            {lever.worth !== null ? (
              <Badge tone="good">{money(lever.worth)} over the stream</Badge>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {lever.detail}
          </p>
          {lever.basis ? (
            <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">{lever.basis}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
