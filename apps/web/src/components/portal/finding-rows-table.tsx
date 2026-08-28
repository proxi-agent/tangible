'use client';

import Link from 'next/link';
import type { FindingRowDecision, FindingRowPage, ReviewableRow } from '@tangible/types';
import { money, percent } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The fourteen columns.
 *
 * The old table printed five: description, year, cost, schedule value, tag. It
 * told a controller *which* assets without telling them what any one of them
 * was worth to them, how sure we were, or what they had already said about it —
 * which is to say it was a list rather than a queue. These fourteen are the
 * columns you need to work a row and then stop thinking about it.
 *
 * Money that cannot be computed prints as a dash and money that will be
 * computed later prints as "pending". They are different states and the table
 * says so: a nought in the recovery column would be read as "worth nothing",
 * which is the one thing it does not mean.
 */

const TIER_TONE: Record<'high' | 'medium' | 'low', BadgeTone> = {
  high: 'good',
  medium: 'accent',
  low: 'neutral',
};

const DISPOSITION: Record<string, { label: string; tone: BadgeTone }> = {
  accepted: { label: 'Accepted', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
  'pending-client': { label: 'Need info', tone: 'warning' },
};

export function FindingRowsTable({
  page,
  selected,
  onToggle,
  onToggleAll,
  selectable,
  assetHref,
}: {
  page: FindingRowPage;
  selected: ReadonlySet<string>;
  onToggle: (assetId: string) => void;
  onToggleAll: () => void;
  /** False for a viewer who may read the report but not decide on it. */
  selectable: boolean;
  assetHref: (assetId: string) => string;
}) {
  const allOnPage = page.rows.length > 0 && page.rows.every(({ row }) => selected.has(row.assetId));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[72rem] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)]">
            {selectable ? (
              <th className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select every row in view"
                  checked={allOnPage}
                  onChange={onToggleAll}
                  className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                />
              </th>
            ) : null}
            <Th>Asset</Th>
            <Th>Description</Th>
            <Th>Location</Th>
            <Th align="right">Acquired</Th>
            <Th align="right">Original cost</Th>
            <Th align="right">Assessed as filed</Th>
            <Th align="right">Off the return</Th>
            <Th align="right">Tax a year</Th>
            <Th align="right">Expected recovery</Th>
            <Th>Confidence</Th>
            <Th>Evidence</Th>
            <Th>Why it was flagged</Th>
            <Th>Decision</Th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map(({ row, decision }) => (
            <tr
              key={row.rowKey}
              className={
                'border-b border-[var(--color-hairline)] ' +
                (selected.has(row.assetId) ? 'bg-[var(--color-accent-soft)]' : '')
              }
            >
              {selectable ? (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.description ?? row.assetTag ?? 'this asset'}`}
                    checked={selected.has(row.assetId)}
                    onChange={() => onToggle(row.assetId)}
                    className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                  />
                </td>
              ) : null}
              <Td className="font-mono text-xs">
                {/* The register's own tag is the link, because that is the
                    string a controller will search their own system for. */}
                <Link
                  href={assetHref(row.assetId)}
                  className="text-[var(--color-accent-ink)] hover:underline"
                >
                  {row.assetTag ?? 'Open'}
                </Link>
              </Td>
              <Td className="max-w-[22rem] truncate" title={row.description ?? undefined}>
                {row.description ?? '—'}
                {row.categoryLabel ? (
                  <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                    {row.categoryLabel}
                  </span>
                ) : null}
              </Td>
              <Td className="text-xs text-[var(--color-ink-secondary)]">
                {row.siteLabel ?? 'Not placed'}
                {row.costCenter ? (
                  <span className="block text-[var(--color-ink-muted)]">{row.costCenter}</span>
                ) : null}
              </Td>
              <Td align="right">{row.acquisitionYear ?? '—'}</Td>
              <Td align="right">{money(row.originalCost)}</Td>
              <Td align="right">
                {row.assessedAsFiled === null ? '—' : money(row.assessedAsFiled)}
              </Td>
              <Td align="right" className="font-medium">
                {row.valueRemoved === null ? '—' : money(row.valueRemoved)}
              </Td>
              <Td align="right">{row.taxAtRisk === null ? '—' : money(row.taxAtRisk)}</Td>
              <Td align="right" className="text-[var(--color-ink-muted)]">
                {row.expectedRecovery === null ? 'Pending' : money(row.expectedRecovery)}
              </Td>
              <Td>
                <Tooltip
                  title={`${row.confidence.tier} · ${percent(row.confidence.score, 0)}`}
                  content={
                    <ul className="space-y-1">
                      {row.confidence.signals.map((signal) => (
                        <li key={signal.code}>
                          <span
                            className={
                              signal.weight < 0
                                ? 'text-[var(--color-critical)]'
                                : 'text-[var(--color-good)]'
                            }
                          >
                            {signal.weight < 0 ? '−' : '+'}
                          </span>{' '}
                          {signal.label}
                          {signal.detail ? (
                            <span className="text-[var(--color-ink-muted)]">
                              {' '}
                              ({signal.detail})
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  }
                >
                  <Badge tone={TIER_TONE[row.confidence.tier]} dot>
                    {row.confidence.tier}
                  </Badge>
                </Tooltip>
              </Td>
              <Td className="text-xs text-[var(--color-ink-secondary)]">
                {row.evidencePresent ? 'Checkable' : '—'}
              </Td>
              <Td
                className="max-w-[26rem] truncate text-xs text-[var(--color-ink-secondary)]"
                title={row.confidence.why}
              >
                {row.confidence.why}
              </Td>
              <Td>
                <Disposition decision={decision} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Disposition({ decision }: { decision: ReviewableRow['decision'] }) {
  if (decision === null) {
    return <span className="text-xs text-[var(--color-ink-muted)]">Not decided</span>;
  }
  const meta = DISPOSITION[decision.status] ?? { label: decision.status, tone: 'neutral' as const };
  return (
    <Tooltip
      title={meta.label}
      content={
        <>
          {decision.note ? <p>{decision.note}</p> : <p>No note.</p>}
          <p className="eyebrow mt-1.5">
            {decision.decidedBy ?? 'Someone'} · {decision.decidedAt.slice(0, 10)}
            {decision.revisions > 1 ? ` · changed ${decision.revisions - 1}×` : ''}
          </p>
          {moved(decision) ? (
            <p className="mt-1.5 text-[var(--color-warning)]">
              The number behind this row has moved since it was decided.
            </p>
          ) : null}
        </>
      }
    >
      <Badge tone={moved(decision) ? 'warning' : meta.tone}>{meta.label}</Badge>
    </Tooltip>
  );
}

function moved(decision: FindingRowDecision): boolean {
  return decision.hasMovedSinceDecision;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`eyebrow px-3 py-2 font-medium whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className,
  title,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={`px-3 py-2 align-top ${align === 'right' ? 'tabular text-right whitespace-nowrap' : ''} ${className ?? ''}`}
    >
      {children}
    </td>
  );
}
