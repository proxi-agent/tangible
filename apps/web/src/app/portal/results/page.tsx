'use client';

import { useQuery } from '@tanstack/react-query';
import type { ClientRecoveryLine, ClientRecoverySummary } from '@tangible/types';
import { api } from '@/lib/api';
import { count, moneyExact, percent, plural } from '@/lib/format';
import { usePortal } from '@/components/portal/portal-context';
import { PortalHeader } from '@/components/portal/portal-header';
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
import { LinkButton } from '@/components/ui/controls';

/**
 * What it actually saved.
 *
 * Every other page in this wing is about what a position is worth on paper. This
 * is the only one about what came back, and it is the page a business will judge
 * the engagement by — so the rules on it are stricter than anywhere else:
 *
 *   - A tax figure somebody can point at — a refund, a corrected bill — is
 *     reported apart from a figure derived by multiplying value by a rate. The
 *     two are never added, because a total mixing them would be the most
 *     misleading number this product could print.
 *   - Where the district settled the account without saying which arguments it
 *     allowed, the page says so in those words. The amounts are still shown,
 *     because they are the client's money and the split is arithmetic they can
 *     check; what is withheld is the impression that the district agreed with
 *     any particular line.
 *   - An argument still with the district counts as nothing, not as a loss.
 */
export default function PortalResultsPage() {
  const { engagementId, href } = usePortal();
  const query = useQuery({
    queryKey: ['portal-recovery', engagementId],
    queryFn: () => api.recoveryStatement(engagementId!),
    enabled: engagementId !== null,
  });

  if (engagementId === null) {
    return (
      <>
        <PortalHeader title="What it saved" description="Nothing has been opened for you yet." />
        <Card>
          <EmptyState title="No tax year open">
            Once we open a year for you, results appear here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const statement = query.data;

  return (
    <>
      <PortalHeader
        title="What it saved"
        description="Every position we took to the district on your behalf, and what came of it."
      />

      {query.isLoading ? (
        <Card>
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        </Card>
      ) : query.error ? (
        <Card>
          <ErrorState error={query.error} />
        </Card>
      ) : !statement || statement.lines.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing has gone to the district yet"
            action={<LinkButton href={href('/portal')}>See your report</LinkButton>}
          >
            This page fills in once a return or a correction goes out. Until then, your report is
            what a position is worth — not yet what it recovered.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Across every year"
              description={`${count(statement.summary.claims)} ${plural(statement.summary.claims, 'position')} taken to the district, ${count(statement.summary.pending)} still open.`}
            />
            <Totals summary={statement.summary} />
          </Card>

          {statement.byYear
            .slice()
            .sort((a, b) => b.taxYear - a.taxYear)
            .map((year) => (
              <Card key={year.taxYear}>
                <CardHeader title={`${year.taxYear}`} description={describe(year.summary)} />
                <Lines lines={statement.lines.filter((line) => line.taxYear === year.taxYear)} />
              </Card>
            ))}

          {statement.caveats.length > 0 ? (
            <div className="space-y-2">
              {statement.caveats.map((caveat) => (
                <Callout key={caveat} tone="neutral">
                  {caveat}
                </Callout>
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function describe(summary: ClientRecoverySummary): string {
  if (summary.settled === 0) return 'Everything is still with the district.';
  const share =
    summary.valueClaimed > 0 ? percent(summary.valueAllowed / summary.valueClaimed) : null;
  return share === null
    ? `${count(summary.settled)} of ${count(summary.claims)} answered.`
    : `${moneyExact(summary.valueAllowed)} of value taken off — ${share} of what we asked for.`;
}

function Totals({ summary }: { summary: ClientRecoverySummary }) {
  return (
    <StatGrid columns={4}>
      <StatCell className="px-5 py-4">
        <Stat
          label="We asked for"
          value={moneyExact(summary.valueClaimed)}
          help="Assessed value we asked the district to take off your account."
        />
      </StatCell>
      <StatCell className="px-5 py-4">
        <Stat
          label="They took off"
          value={moneyExact(summary.valueAllowed)}
          help="Assessed value the district actually removed. Positions still open count as nothing here rather than as a refusal."
        />
      </StatCell>
      <StatCell className="px-5 py-4">
        <Stat
          label="Refunded or credited"
          value={moneyExact(summary.taxDocumented)}
          help="Tax on a document you can point at — a refund cheque, a corrected bill. Only money somebody has actually seen."
        />
      </StatCell>
      <StatCell className="px-5 py-4">
        <Stat
          label="Estimated tax effect"
          value={summary.taxEstimated === null ? '—' : moneyExact(summary.taxEstimated)}
          note="value removed × your blended rate"
          help="What the value removed is worth at the blended rate for your county, where no bill or refund figure has been recorded. An estimate, and it is kept separate from the refunded column rather than added to it."
        />
      </StatCell>
    </StatGrid>
  );
}

function Lines({ lines }: { lines: ClientRecoveryLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs">
        <thead>
          <tr className="text-2xs border-b border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2">What we argued</th>
            <th className="px-3 py-2 text-right">Items</th>
            <th className="px-3 py-2 text-right">We asked for</th>
            <th className="px-3 py-2 text-right">They took off</th>
            <th className="px-5 py-2">Where it stands</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {lines.map((line) => (
            <tr key={`${line.taxYear}:${line.findingKey}`} className="align-top">
              <td className="px-5 py-2.5">{line.findingTitle}</td>
              <td className="tabular px-3 py-2.5 text-right">{count(line.assets)}</td>
              <td className="tabular px-3 py-2.5 text-right">{moneyExact(line.valueClaimed)}</td>
              <td className="tabular px-3 py-2.5 text-right">{moneyExact(line.valueAllowed)}</td>
              <td className="px-5 py-2.5">
                {line.pending === line.assets ? (
                  <Badge tone="neutral">{line.standing}</Badge>
                ) : (
                  line.standing
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
