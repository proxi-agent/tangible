'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ClaimOutcome, EngagementRecovery, RecoveryClaimRecord } from '@tangible/types';
import { api } from '@/lib/api';
import { count, moneyExact, percent, plural } from '@/lib/format';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';
import { Button, Field, Segmented, TextInput } from '@/components/ui/controls';
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
            help="What the district actually took off, so far as anybody has recorded it. Open positions count as nothing rather than as a loss, and so does a position the appraiser allowed without ever naming a figure."
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

      <ByFinding engagementId={engagementId} data={data} />

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
  /** The ones nobody has answered yet. What a settlement can still land on. */
  open: RecoveryClaimRecord[];
  claimed: number;
  allowed: number;
  proRata: number;
  stated: number;
}

/**
 * Every position, gathered to the argument it was made under.
 *
 * Shared by the table and by the settlement form rather than built twice,
 * because the two have to agree about which positions are still open — a form
 * offering a row the table calls settled is a form that writes over an answer.
 */
function groupClaims(claims: RecoveryClaimRecord[]): Group[] {
  const groups = new Map<string, Group>();
  for (const claim of claims) {
    const key = `${claim.taxYear}:${claim.findingKey}`;
    const group = groups.get(key) ?? {
      key,
      taxYear: claim.taxYear,
      findingKey: claim.findingKey,
      findingTitle: claim.findingTitle,
      claims: [],
      open: [],
      claimed: 0,
      allowed: 0,
      proRata: 0,
      stated: 0,
    };
    group.claims.push(claim);
    group.claimed += claim.valueClaimed ?? 0;
    group.allowed += claim.outcome?.valueAllowed ?? 0;
    if (claim.outcome === null) group.open.push(claim);
    if (claim.outcome?.allocation === 'pro-rata') group.proRata += 1;
    if (claim.outcome?.allocation === 'stated') group.stated += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.taxYear - a.taxYear || b.claimed - a.claimed);
}

/**
 * Grouped to the argument, newest year first.
 *
 * Not to the asset, even though that is the storage grain: a ghost-asset
 * finding across two hundred lines is one argument the district either took or
 * did not, and two hundred rows would bury that. The asset grain is what makes
 * the *next* season's prediction possible, not what makes this season readable.
 *
 * It is still reachable, one argument at a time. Opening a row is how a firm
 * finds the position that was recorded against the wrong account — which is the
 * only thing the per-asset list is for, and the reason it is closed by default.
 */
function ByFinding({ engagementId, data }: { engagementId: string; data: EngagementRecovery }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = groupClaims(data.claims);

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
          {rows.map((group) => {
            const isOpen = expanded === group.key;
            return (
              <Fragment key={group.key}>
                <tr className="align-top">
                  <td className="tabular px-5 py-2.5">{group.taxYear}</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : group.key)}
                      aria-expanded={isOpen}
                      className="flex items-start gap-1.5 text-left hover:text-[var(--color-accent)]"
                    >
                      {isOpen ? (
                        <ChevronDown size={13} className="mt-0.5 shrink-0" />
                      ) : (
                        <ChevronRight size={13} className="mt-0.5 shrink-0" />
                      )}
                      {group.findingTitle}
                    </button>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{count(group.claims.length)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{moneyExact(group.claimed)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{moneyExact(group.allowed)}</td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {group.claimed > 0 ? percent(group.allowed / group.claimed) : '—'}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.open.length > 0 ? (
                        <Badge tone="neutral">{count(group.open.length)} open</Badge>
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
                      {group.stated > 0 ? (
                        <Badge tone="accent">
                          <span className="inline-flex items-center gap-1">
                            Named, not priced
                            <InfoTip
                              title="Named, not priced"
                              content="The appraiser said this argument landed and never itemised the money. It counts as evidence about what this district accepts, and contributes nothing to the value allowed, because no figure was ever stated for it."
                              size={11}
                            />
                          </span>
                        </Badge>
                      ) : null}
                      {group.open.length === 0 && group.proRata === 0 && group.stated === 0 ? (
                        <Badge tone="good">Answered position by position</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {isOpen ? (
                  <tr>
                    <td colSpan={7} className="bg-[var(--color-sunken)] px-5 py-3">
                      <Positions engagementId={engagementId} group={group} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The positions under one argument, one row each.
 *
 * The only action here is taking one back, and it is deliberately the only one.
 * A claim is what the firm predicted at the moment a position went to a
 * district, so nothing on this list is editable — a record that could be
 * improved after the answer arrived would score the firm against a prediction
 * it never made.
 */
function Positions({ engagementId, group }: { engagementId: string; group: Group }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-2xs text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          <th className="py-1 pr-3">Item</th>
          <th className="py-1 pr-3 text-right">Claimed</th>
          <th className="py-1 pr-3 text-right">Allowed</th>
          <th className="py-1 pr-3">Standing</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--color-hairline)]">
        {group.claims.map((claim) => (
          <tr key={claim.id} className="align-top">
            <td className="py-1.5 pr-3">
              <div>{claim.assetDescription ?? claim.assetTag ?? 'Unidentified item'}</div>
              {claim.assetTag && claim.assetDescription ? (
                <div className="text-2xs text-[var(--color-ink-muted)]">{claim.assetTag}</div>
              ) : null}
            </td>
            <td className="tabular py-1.5 pr-3 text-right">
              {claim.valueClaimed === null ? '—' : moneyExact(claim.valueClaimed)}
            </td>
            <td className="tabular py-1.5 pr-3 text-right">
              {claim.outcome === null || claim.outcome.valueAllowed === null
                ? '—'
                : moneyExact(claim.outcome.valueAllowed)}
            </td>
            <td className="py-1.5 pr-3 text-[var(--color-ink-muted)]">{claim.standing}</td>
            <td className="py-1.5 text-right">
              <VoidClaim engagementId={engagementId} claim={claim} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Take one position back off the record.
 *
 * Not a delete, and the wording says so: the row stays, with the reason and the
 * person on it, and drops out of every total and out of the training set. The
 * reason is required because it is the only thing separating "claimed against
 * the wrong account" from "this one did not go our way", and a claim table a
 * firm can quietly tidy after the fact is a table that cannot score anything.
 */
function VoidClaim({ engagementId, claim }: { engagementId: string; claim: RecoveryClaimRecord }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const take = useMutation({
    mutationFn: () => api.voidClaim(claim.id, { reason }),
    onSuccess: async () => {
      setAsking(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['engagement-recovery', engagementId] });
    },
  });

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
        Take back
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <TextInput
          compact
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this coming off?"
          className="w-56"
        />
        <Button
          variant="danger"
          size="sm"
          disabled={reason.trim() === '' || take.isPending}
          onClick={() => take.mutate()}
        >
          {take.isPending ? 'Taking back…' : 'Confirm'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
      {take.error ? <ErrorState error={take.error} /> : null}
    </div>
  );
}

type SettleMode = 'account' | 'argument';

const OUTCOMES: { value: ClaimOutcome; label: string }[] = [
  { value: 'accepted', label: 'Allowed' },
  { value: 'partial', label: 'Allowed in part' },
  { value: 'rejected', label: 'Refused' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

/**
 * Record what the district did.
 *
 * Two forms, because a firm arrives holding one of two things. Usually it is a
 * settlement letter with a single figure on it and no explanation, and that is
 * the plain form: a year, a number, a date. Sometimes the appraiser worked
 * through the arguments on the phone and said which ones landed, and that is
 * worth vastly more — it is the only evidence in the product that can say what
 * a district accepts, as opposed to what it paid. The second form exists so
 * that call stops being lost.
 *
 * A resolution recorded against a notice already lands here on its own. This is
 * for everything that never came through a protest: an informal call, a refund
 * on a motion, a corrected bill that simply arrived.
 */
function Settle({ engagementId, data }: { engagementId: string; data: EngagementRecovery }) {
  const queryClient = useQueryClient();
  const years = data.byYear.map((year) => year.taxYear);
  const [taxYear, setTaxYear] = useState(String(years[years.length - 1] ?? ''));
  const [mode, setMode] = useState<SettleMode>('account');
  const [removed, setRemoved] = useState('');
  const [resolvedOn, setResolvedOn] = useState('');
  const [tax, setTax] = useState('');
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, { outcome: ClaimOutcome; amount: string }>>(
    {},
  );

  // Only what is still open, and only for the year on the form. The server
  // enforces both; offering a row it would refuse is how a form teaches people
  // to distrust it.
  const groups = groupClaims(data.claims).filter(
    (group) => group.taxYear === Number(taxYear) && group.open.length > 0,
  );

  const perClaim = groups.flatMap((group) => {
    const picked = choices[group.key];
    if (!picked) return [];
    // An amount is offered only where it can be the district's own: one open
    // position under the argument. Split across several it would be our
    // arithmetic wearing the district's authority, which is what `pro-rata`
    // exists to be called instead.
    const single = group.open.length === 1;
    const amount = single && picked.amount.trim() !== '' ? Number(picked.amount) : null;
    return group.open.map((claim) => ({
      claimId: claim.id,
      outcome: picked.outcome,
      valueAllowed: amount,
      taxRecovered: null,
    }));
  });

  const record = useMutation({
    mutationFn: () =>
      api.recordSettlement(engagementId, {
        locationId: null,
        taxYear: Number(taxYear),
        resolvedOn,
        resolutionId: null,
        settledValueRemoved: mode === 'account' ? Number(removed) : null,
        taxRecovered: mode === 'account' && tax !== '' ? Number(tax) : null,
        perClaim: mode === 'argument' ? perClaim : null,
        note: null,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(['engagement-recovery', engagementId], result);
      setOpen(false);
      setRemoved('');
      setTax('');
      setChoices({});
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Record a settlement
      </Button>
    );
  }

  const ready =
    taxYear !== '' &&
    resolvedOn !== '' &&
    (mode === 'account' ? removed !== '' : perClaim.length > 0);

  return (
    <div className="space-y-3 rounded-md border border-[var(--color-hairline)] p-4">
      <Segmented
        ariaLabel="How the district answered"
        size="sm"
        value={mode}
        onChange={(next) => setMode(next)}
        options={[
          {
            value: 'account',
            label: 'One figure for the account',
            title:
              'A settlement letter with a number on it and no explanation. Split across the open positions in proportion, and labelled as a share rather than as the district’s own answer.',
          },
          {
            value: 'argument',
            label: 'Argument by argument',
            title:
              'The appraiser said which arguments landed. Recorded against each position, and the only kind of outcome that teaches the acceptance rates anything.',
          },
        ]}
      />

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
        {mode === 'account' ? (
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
        ) : null}
        <Field label="Dated" help="The date on the district's letter or order.">
          <TextInput
            compact
            type="date"
            value={resolvedOn}
            onChange={(event) => setResolvedOn(event.target.value)}
          />
        </Field>
        {mode === 'account' ? (
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
        ) : null}
      </div>

      {mode === 'argument' ? (
        <Arguments groups={groups} choices={choices} onChange={setChoices} />
      ) : null}

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

/**
 * One line per open argument, and an answer for the ones the appraiser named.
 *
 * Everything starts at "no answer yet" and stays there unless somebody says
 * otherwise, so a call that settled two arguments out of six records two
 * outcomes and leaves four open. The alternative — defaulting every row to
 * something and asking the user to correct it — writes an answer the district
 * never gave onto whatever nobody looked at.
 *
 * The money column is present on single-position arguments and absent
 * elsewhere, and the absence is the honest half. An appraiser who allowed a
 * two-hundred-line ghost-asset argument without pricing it has given the
 * strongest evidence there is about acceptance and no evidence at all about
 * amount; the row records exactly that, and the value allowed stays where the
 * settlement letter put it.
 */
function Arguments({
  groups,
  choices,
  onChange,
}: {
  groups: Group[];
  choices: Record<string, { outcome: ClaimOutcome; amount: string }>;
  onChange: (next: Record<string, { outcome: ClaimOutcome; amount: string }>) => void;
}) {
  if (groups.length === 0) {
    return (
      <Callout tone="neutral">
        Nothing is still open for that year. A settlement can only land on a position that has not
        already been answered.
      </Callout>
    );
  }

  const set = (key: string, patch: Partial<{ outcome: ClaimOutcome; amount: string }>) => {
    const current = choices[key];
    if (patch.outcome === undefined && current === undefined) return;
    const next = { ...choices };
    if (patch.outcome === undefined) {
      next[key] = { ...current!, ...patch };
    } else {
      next[key] = { outcome: patch.outcome, amount: current?.amount ?? '' };
    }
    onChange(next);
  };

  const clear = (key: string) => {
    const next = { ...choices };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--color-hairline)]">
      <table className="w-full min-w-[34rem] text-xs">
        <thead>
          <tr className="text-2xs border-b border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-3 py-2">Argument</th>
            <th className="px-3 py-2 text-right">Open</th>
            <th className="px-3 py-2 text-right">Claimed</th>
            <th className="px-3 py-2">What the appraiser said</th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="Only where the argument covers a single open position, because only then can the figure be the district's own. Left blank, the outcome is recorded and no amount is invented for it.">
                <span>Amount allowed</span>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {groups.map((group) => {
            const picked = choices[group.key];
            const openClaimed = group.open.reduce((sum, one) => sum + (one.valueClaimed ?? 0), 0);
            const single = group.open.length === 1;
            return (
              <tr key={group.key} className="align-middle">
                <td className="px-3 py-2">{group.findingTitle}</td>
                <td className="tabular px-3 py-2 text-right">{count(group.open.length)}</td>
                <td className="tabular px-3 py-2 text-right">{moneyExact(openClaimed)}</td>
                <td className="px-3 py-2">
                  <select
                    value={picked?.outcome ?? ''}
                    onChange={(event) =>
                      event.target.value === ''
                        ? clear(group.key)
                        : set(group.key, { outcome: event.target.value as ClaimOutcome })
                    }
                    className="w-full rounded-md border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
                  >
                    <option value="">Nothing yet — leave open</option>
                    {OUTCOMES.map((one) => (
                      <option key={one.value} value={one.value}>
                        {one.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  {single ? (
                    <TextInput
                      compact
                      inputMode="decimal"
                      value={picked?.amount ?? ''}
                      disabled={picked === undefined}
                      onChange={(event) => set(group.key, { amount: event.target.value })}
                      placeholder="optional"
                      className="w-28 text-right"
                    />
                  ) : (
                    <span className="text-2xs text-[var(--color-ink-muted)]">
                      {count(group.open.length)} positions — recorded without an amount
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
