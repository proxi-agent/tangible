'use client';

import { useQuery } from '@tanstack/react-query';
import { use, useMemo, useState } from 'react';
import type { FindingKind, SavingsFinding, SavingsReport } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, percent, plural } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  BackLink,
  PageHeader,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { TextInput } from '@/components/ui/controls';
import { usePortal } from '@/components/portal/portal-context';
import { FindingAsk } from '@/components/portal/finding-ask';

/**
 * One finding, opened.
 *
 * The click target from the report's waterfall. Its job is to answer the two
 * questions a controller has about any line that removes value from their
 * return — *what is this* and *which of my assets are you talking about* — in
 * that order, in their own vocabulary, with the rows printed rather than
 * summarised.
 *
 * The finding key is the only thing in the URL. It names a category, not a
 * client: the engagement is still resolved from the portal's own scope, so
 * editing the address bar cannot walk to anybody else's register.
 */

const KIND_META: Record<FindingKind, { label: string; tone: 'good' | 'accent' | 'warning' }> = {
  measured: { label: 'Measured from your register', tone: 'good' },
  modeled: { label: 'Rests on an assumption', tone: 'accent' },
  screening: { label: 'Needs an answer from you', tone: 'warning' },
};

export default function PortalFindingPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { engagementId } = usePortal();

  const report = useQuery({
    queryKey: ['savings', engagementId],
    queryFn: () => api.savings(engagementId!),
    enabled: engagementId !== null,
  });

  const finding = report.data?.findings.find((item) => item.key === decodeURIComponent(key));

  if (report.isLoading) {
    return (
      <Card>
        <div className="space-y-3 px-5 py-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Card>
    );
  }
  if (report.error) {
    return (
      <Card>
        <ErrorState error={report.error} />
      </Card>
    );
  }
  if (!report.data || !finding) {
    return (
      <>
        <PageHeader
          back={<BackLink href="/portal">Your report</BackLink>}
          title="Not on this report"
        />
        <Card>
          <EmptyState title="That finding is not on your current report">
            It may have been on an earlier year, or the report may have been rebuilt since you
            opened this page.
          </EmptyState>
        </Card>
      </>
    );
  }

  return <Finding finding={finding} report={report.data} />;
}

function Finding({ finding, report }: { finding: SavingsFinding; report: SavingsReport }) {
  const [query, setQuery] = useState('');
  const meta = KIND_META[finding.kind];
  const rate = report.blendedTaxRate;

  const tagged = finding.evidence.some((row) => row.assetTag !== null && row.assetTag !== '');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? finding.evidence.filter(
          (row) =>
            (row.description ?? '').toLowerCase().includes(needle) ||
            (row.assetTag ?? '').toLowerCase().includes(needle) ||
            String(row.acquisitionYear ?? '').includes(needle),
        )
      : finding.evidence;
    // Largest cost first: the rows a reader will argue about are the expensive
    // ones, and they should not have to page to reach them.
    return [...matched].sort((a, b) => (b.originalCost ?? 0) - (a.originalCost ?? 0));
  }, [finding.evidence, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink href="/portal">Your report</BackLink>}
        title={finding.title}
        description={finding.summary}
        actions={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />

      <Card>
        <StatGrid columns={4}>
          <StatCell>
            <Stat
              label="Value off the return"
              value={finding.valueRemoved === null ? 'Not yet priced' : money(finding.valueRemoved)}
              tone={finding.valueRemoved === null ? 'default' : 'good'}
              help="Market value this takes off the rendition, on the district’s own schedules."
              note={
                finding.valueRemoved === null
                  ? 'It cannot be priced until the question below is answered'
                  : undefined
              }
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Tax a year"
              value={finding.valueRemoved === null ? '—' : money(finding.valueRemoved * rate)}
              help={`At ${percent(rate, 2)}, the blended rate for ${report.jurisdictionName ?? 'your jurisdiction'}.`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Assets"
              value={count(finding.assetCount)}
              help="Register lines this finding covers. All of them are listed below."
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Original cost"
              value={money(finding.originalCost)}
              help="What those lines cost when they were bought — the scale of the finding, before depreciation."
            />
          </StatCell>
        </StatGrid>
      </Card>

      <Card>
        <CardHeader title="Why this is a real position" />
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm">{finding.basis}</p>
          {finding.assumption ? (
            <Callout
              tone="neutral"
              title={finding.kind === 'screening' ? 'What settles it' : 'The assumption behind it'}
            >
              {finding.assumption}
            </Callout>
          ) : null}
          {/* And for a screening finding, the thing that settles it is a
              question — so it gets asked here, in the same breath as the
              explanation, rather than a page away. */}
          {finding.kind === 'screening' ? <FindingAsk finding={finding} /> : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="The assets behind it"
          description={`${count(finding.evidence.length)} ${plural(finding.evidence.length, 'line')} from the register you sent.`}
          help="Printed line by line on purpose: a claim about your property that you cannot check row by row is one you should not have to accept."
          action={
            finding.evidence.length > 8 ? (
              <TextInput
                compact
                value={query}
                placeholder={tagged ? 'Find a tag or description' : 'Find a description'}
                onChange={(event) => setQuery(event.target.value)}
                className="w-52"
              />
            ) : null
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="Nothing matches">
            No asset on this finding matches that search.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-left">
                  {/* The register's own tag, not our id. A client checking a
                      claim against their books has no use for a uuid we
                      minted, and the column is dropped entirely when the
                      register carried no tags rather than printing one. */}
                  {tagged ? <Th>Asset</Th> : null}
                  <Th>Description</Th>
                  <Th align="right">Acquired</Th>
                  <Th align="right">Original cost</Th>
                  <Th align="right">On the schedules</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.assetId} className="border-b border-[var(--color-hairline)]">
                    {tagged ? <Td className="font-mono text-xs">{row.assetTag ?? '—'}</Td> : null}
                    <Td>{row.description ?? '—'}</Td>
                    <Td align="right">{row.acquisitionYear ?? '—'}</Td>
                    <Td align="right">{money(row.originalCost)}</Td>
                    <Td align="right">
                      {row.scheduleValue === null ? '—' : money(row.scheduleValue)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`eyebrow px-5 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-5 py-2 ${align === 'right' ? 'tabular text-right' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
