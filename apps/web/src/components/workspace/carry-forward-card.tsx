'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type {
  CarryForward,
  CarryFinding,
  CarryGroup,
  CarryVerdict,
  SiteCoverage,
} from '@/lib/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, day, money, moneyExact, plural } from '@/lib/format';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * What changed since the last return went out.
 *
 * A second season with a client is supposed to be cheaper than the first, and
 * the reason it usually is not is that the only record of last year is a PDF.
 * The app has more than that — it froze which pieces of property each return was
 * built from — and this is the first screen to read it back.
 *
 * The card is deliberately absent on a first season rather than empty. There is
 * no comparison to make, and a card saying so is a card somebody has to read
 * every time they open the page for the rest of the engagement.
 */
export function CarryForwardCard({ engagementId }: { engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-carry-forward', engagementId],
    queryFn: () => api.carryForward(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-32 w-full" />;
  if (data.priorYear === null) return null;

  return (
    <Card>
      <CardHeader
        title={
          data.returns.length > 0
            ? `Since the ${data.priorYear} ${plural(data.returns.length, 'return')}`
            : `Since ${data.priorYear}`
        }
        description={provenance(data)}
      />
      <Coverage sites={data.coverage} />
      <Ledger data={data} />
      {data.findings.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-[var(--color-ink-secondary)]">
          Nothing to raise. Every asset on this year&rsquo;s register was either covered by the{' '}
          {data.priorYear} filing or acquired since, and nothing that filing covered has left the
          book.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]">
          {data.findings.map((finding) => (
            <Finding key={finding.key} finding={finding} groups={data.groups} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Which returns this is measured against, said in the header rather than buried.
 *
 * Every number below is a subtraction from these documents, and a comparison
 * against a return the reader has forgotten filing is a comparison they cannot
 * check. The filing dates are here for the same reason.
 */
function provenance(data: CarryForward): string {
  if (data.returns.length === 0) {
    // A client whose prior season we hold only as a document they handed us.
    // Saying so up front sets the ceiling on everything below: a rendition
    // states totals and never names an asset.
    return (
      `This year's register against the ${data.priorYear} renditions on file. Nothing went out ` +
      `from here that year, so the comparison runs off what the client provided; the register ` +
      `now carries ${count(data.registerCount)} ${plural(data.registerCount, 'asset')}.`
    );
  }
  const returns = data.returns
    .map((one) => `${one.locationLabel} (filed ${day(one.filedOn)})`)
    .join(', ');
  return (
    `This year's register against what actually went out for ${data.priorYear}: ${returns}. ` +
    `${data.returns.length === 1 ? 'That return was' : 'Those returns were'} built from ${count(data.consideredCount)} ` +
    `${plural(data.consideredCount, 'asset')}; the register now carries ${count(data.registerCount)}.`
  );
}

const EVIDENCE_OF: Record<SiteCoverage['evidence'], { label: string; hint: string; dot: string }> = {
  itemized: {
    label: 'asset by asset',
    hint: 'We filed this site’s prior return, so we know which pieces of property it was built from. Every verdict below is available here.',
    dot: 'bg-[var(--color-good)]',
  },
  aggregate: {
    label: 'totals only',
    hint: 'The prior return here is the client’s own, read off the document they uploaded. A rendition reports in aggregate and never names an asset, so property at this site is set apart rather than called new or omitted.',
    dot: 'bg-[var(--color-series-1)]',
  },
  none: {
    label: 'nothing on file',
    hint: 'No return was filed through this app for this site, and no prior rendition has been uploaded. Nothing here has been compared — which is not the same as nothing being wrong.',
    dot: 'bg-[var(--color-warning)]',
  },
};

/**
 * What we hold about each site, before any verdict is read.
 *
 * The correction this card most needed. Property is rendered per site, so
 * “never rendered” is only sayable about a site whose return we actually
 * have — and the first version of this screen said it about every site of
 * every client whose earlier filings were done somewhere else. Putting coverage
 * above the ledger makes the limit of the comparison the first thing read
 * rather than a caveat somebody finds later.
 */
function Coverage({ sites }: { sites: SiteCoverage[] }) {
  if (sites.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--color-hairline)] px-5 py-3">
      {sites.map((site) => {
        const meta = EVIDENCE_OF[site.evidence];
        return (
          <Tooltip key={site.locationId ?? 'unplaced'} title={site.label} content={meta.hint}>
            <div className="flex cursor-help items-center gap-2 text-xs">
              <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} />
              <span className="font-medium text-[var(--color-ink)]">{site.label}</span>
              <span className="text-[var(--color-ink-secondary)]">{meta.label}</span>
              <span className="tabular text-[var(--color-ink-muted)]">
                {count(site.assetCount)} · {money(site.cost)}
              </span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

const LEDGER: Record<CarryVerdict, { label: string; hint: string; tone: string }> = {
  carried: {
    label: 'Carried',
    hint: 'On the prior return and still on the register. These re-render.',
    tone: 'text-[var(--color-ink)]',
  },
  acquired: {
    label: 'Acquired since',
    hint: 'Bought during or after the prior tax year, so the prior return could not have covered them. These are new to the form.',
    tone: 'text-[var(--color-good)]',
  },
  omitted: {
    label: 'Never rendered',
    hint: 'Owned before the prior January 1 and not on that return. This is the exposure.',
    tone: 'text-[var(--color-critical)]',
  },
  undated: {
    label: 'No acquisition year',
    hint: 'Not on the prior return, and the register does not say when they were bought — so whether they should have been is unanswerable from here.',
    tone: 'text-[var(--color-warning)]',
  },
  aggregate: {
    label: 'Totals only',
    hint: 'At a site whose prior return we hold only as the client’s own document. A rendition names no assets, so these can be neither confirmed as rendered nor called omitted.',
    tone: 'text-[var(--color-ink)]',
  },
  uncompared: {
    label: 'Not compared',
    hint: 'At a site with no prior return on file at all. Whether these were rendered is unknown from here — the document would settle it.',
    tone: 'text-[var(--color-warning)]',
  },
  dropped: {
    label: 'Off the register',
    hint: 'On the prior return and not on this register at all. Absence is not disposal — somebody has to say which it was.',
    tone: 'text-[var(--color-warning)]',
  },
};

/** The subtraction as a row of numbers, before any of it is argued about. */
function Ledger({ data }: { data: CarryForward }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 px-5 py-4">
      {data.groups.map((group) => {
        const meta = LEDGER[group.verdict];
        return (
          <Tooltip key={group.verdict} title={meta.label} content={meta.hint}>
            <div className="cursor-help">
              <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                {meta.label}
              </p>
              <p className={cn('tabular mt-0.5 text-lg font-semibold', meta.tone)}>
                {count(group.count)}
              </p>
              <p className="tabular text-xs text-[var(--color-ink-muted)]">{cost(group)}</p>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * A group's cost, with the assets that have none said out loud.
 *
 * A total of $0 across four assets and a total of $0 across four assets whose
 * cost the register never recorded are different facts, and only one of them
 * means the property is worthless.
 */
function cost(group: CarryGroup): string {
  if (group.costless === group.count) return `no cost recorded`;
  const known = money(group.cost);
  return group.costless > 0 ? `${known} · ${count(group.costless)} without cost` : known;
}

const SEVERITY = {
  critical: { rail: 'bg-[var(--color-critical)]', text: 'text-[var(--color-critical)]' },
  warning: { rail: 'bg-[var(--color-warning)]', text: 'text-[var(--color-ink)]' },
  note: { rail: 'bg-[var(--color-hairline)]', text: 'text-[var(--color-ink)]' },
} as const;

/** Which group a finding is talking about, so its evidence can be opened. */
const EVIDENCE: Record<string, CarryVerdict> = {
  'omitted-from-prior-return': 'omitted',
  'no-prior-return-on-file': 'uncompared',
  'prior-return-not-itemized': 'aggregate',
  'dropped-from-register': 'dropped',
  'undated-and-unrendered': 'undated',
};

function Finding({ finding, groups }: { finding: CarryFinding; groups: CarryGroup[] }) {
  const [open, setOpen] = useState(false);
  const group = groups.find((one) => one.verdict === EVIDENCE[finding.key]);
  const severity = SEVERITY[finding.severity];

  return (
    <li className="flex gap-3 px-5 py-4">
      <span className={cn('mt-1 w-0.5 shrink-0 self-stretch rounded-full', severity.rail)} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', severity.text)}>{finding.headline}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
          {finding.detail}
        </p>
        {group ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((was) => !was)}
              className="mt-2 -ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs text-[var(--color-ink-secondary)] outline-none hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]"
              aria-expanded={open}
            >
              <ChevronRight
                size={12}
                strokeWidth={2}
                className={cn('transition-transform', open && 'rotate-90')}
              />
              {open ? 'Hide' : 'Show'} {group.count <= group.sample.length ? 'the' : 'the largest'}{' '}
              {count(Math.min(group.count, group.sample.length))}
            </button>
            {open ? <Evidence group={group} /> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The sample, labelled as one.
 *
 * The counts and totals above are over the whole group; this is the first
 * dozen. Saying so matters more here than it looks — a reader who takes twelve
 * rows for the full list will under-call the exposure and go and tell the
 * client a number that is wrong in the direction that costs them.
 */
function Evidence({ group }: { group: CarryGroup }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--color-hairline)]">
      <table className="w-full min-w-[28rem] text-xs">
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {group.sample.map((line) => (
            <tr key={line.assetId}>
              <td className="px-3 py-1.5">
                <span className="block max-w-80 truncate">{line.description ?? 'No description'}</span>
                {line.assetTag ? (
                  <span className="text-[11px] text-[var(--color-ink-muted)]">{line.assetTag}</span>
                ) : null}
              </td>
              <td className="tabular px-3 py-1.5 text-right whitespace-nowrap text-[var(--color-ink-muted)]">
                {line.acquisitionYear ?? 'year unknown'}
              </td>
              <td className="tabular px-3 py-1.5 text-right whitespace-nowrap">
                {moneyExact(line.originalCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {group.count > group.sample.length ? (
        <p className="border-t border-[var(--color-hairline)] px-3 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
          The largest {count(group.sample.length)} of {count(group.count)}. The totals above cover
          all of them.
        </p>
      ) : null}
    </div>
  );
}
