'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radar, Trash2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  EMPTY_COLUMN_MAP,
  EVIDENCE_FIELDS,
  EVIDENCE_SOURCES,
  KEYED_ON,
  mappingIsUsable,
  proposeColumns,
  sourcesFor,
  type EvidenceColumnMap,
  type EvidenceField,
  type EvidenceSourceKind,
} from '@tangible/evidence';
import type { EvidenceBoard, EvidenceExport, SheetSummary } from '@tangible/types';
import { api } from '@/lib/api';
import { count, percent, plural } from '@/lib/format';
import { Button, Select } from '@/components/ui/controls';
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
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The systems outside the register, and what they have and have not been asked.
 *
 * The card leads with coverage rather than with files, because uploading a
 * maintenance export is not the achievement — being able to say something about
 * a given asset is. Four figures carry it: how many settled assets there are,
 * how many sit in a category some imported source can speak to at all, how many
 * a source actually found, and how many a covering source searched for and did
 * not find. That last number is the one findings are built on, and it is also
 * the one a bad mapping would inflate, which is why the mapping step below is a
 * person's decision rather than a background job.
 *
 * Blind spots are given the same weight as coverage. A category nothing covers
 * is not an error state — it is a named file worth asking the client for, and
 * the panel says which one.
 */
export function EvidenceCard({ engagementId }: { engagementId: string }) {
  const board = useQuery({
    queryKey: ['evidence', engagementId],
    queryFn: () => api.evidence(engagementId),
  });

  if (board.error) return <ErrorState error={board.error} />;
  if (!board.data) return <Loading />;

  const data = board.data;
  const pending = data.exports.filter((row) => row.status === 'parsed');

  return (
    <Card>
      <CardHeader
        title="Outside the register"
        icon={Radar}
        description="Exports from the systems that already know whether an asset is still there — maintenance, device management, the insurance schedule, the county's real property record, the lease subledger."
        help="Each source answers a different question, and each means something different when it says nothing. A maintenance system with no work order against a chiller is evidence the chiller is gone; a device manager with no record of a conveyor is evidence of nothing, because conveyors were never in its scope. Silence is only read as a denial where the source covers the category."
        action={<UploadControl engagementId={engagementId} />}
      />

      {data.coverage ? (
        <Coverage coverage={data.coverage} />
      ) : (
        <div className="border-b border-[var(--color-hairline)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          {data.note ?? 'Nothing to measure coverage against yet.'}
        </div>
      )}

      {data.exports.length === 0 ? (
        <Nothing />
      ) : (
        <ExportTable engagementId={engagementId} exports={data.exports} />
      )}

      {pending.map((row) => (
        <MappingPanel key={`${row.id}:${row.updatedAt}`} engagementId={engagementId} row={row} />
      ))}

      {data.coverage && data.coverage.blindSpots.length > 0 ? (
        <BlindSpots
          blindSpots={data.coverage.blindSpots}
          present={data.exports
            .filter((row) => row.status === 'imported')
            .map((row) => row.kind as EvidenceSourceKind)}
        />
      ) : null}
    </Card>
  );
}

function Coverage({ coverage }: { coverage: NonNullable<EvidenceBoard['coverage']> }) {
  const { assetCount, coveredCount, matchedCount, deniedCount } = coverage;
  const share = assetCount === 0 ? 0 : coveredCount / assetCount;

  return (
    <StatGrid>
      <StatCell>
        <Stat
          label="Assets in scope"
          value={count(assetCount)}
          help="Settled, taxable assets on this engagement — the denominator for everything else here."
        />
      </StatCell>
      <StatCell>
        <Stat
          label="A source can speak to"
          value={count(coveredCount)}
          note={assetCount === 0 ? undefined : `${percent(share)} of the register`}
          help="Assets sitting in a category at least one imported source covers. An asset outside every source's scope is not evidence of anything, in either direction."
        />
      </StatCell>
      <StatCell>
        <Stat
          label="Found"
          value={count(matchedCount)}
          tone={matchedCount > 0 ? 'good' : 'default'}
          help="Assets a source actually matched — a work order, a device check-in, a scheduled item, a lease line."
        />
      </StatCell>
      <StatCell>
        <Stat
          label="Searched, not found"
          value={count(deniedCount)}
          tone={deniedCount > 0 ? 'warning' : 'default'}
          help="Assets a covering source looked for and did not have. This is the evidence behind a ghost finding, and it counts only where the source's own silence means something."
        />
      </StatCell>
    </StatGrid>
  );
}

function ExportTable({
  engagementId,
  exports,
}: {
  engagementId: string;
  exports: EvidenceExport[];
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (exportId: string) => api.removeEvidence(engagementId, exportId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['evidence', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-xs">
        <thead>
          <tr className="text-2xs border-y border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2">File</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2 text-right">Records</th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="Rows the file held that carried no identifier and no description. They are counted rather than dropped quietly, because the gap between the row count somebody sees in Excel and the records this searched is exactly what makes a negative statement look stronger than it is.">
                <span>Skipped</span>
              </Tooltip>
            </th>
            <th className="px-3 py-2">Status</th>
            <th className="px-5 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {exports.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="px-5 py-2.5">
                <div className="font-medium">{row.originalFilename}</div>
                {row.error ? (
                  <div className="mt-0.5 text-[var(--color-critical)]">{row.error}</div>
                ) : null}
              </td>
              <td className="px-3 py-2.5">{EVIDENCE_SOURCES[row.kind].label}</td>
              <td className="tabular px-3 py-2.5 text-right">
                {row.status === 'imported' ? count(row.recordCount) : '—'}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                {row.status === 'imported' ? count(row.skippedCount) : '—'}
              </td>
              <td className="px-3 py-2.5">
                <Badge
                  tone={
                    row.status === 'imported'
                      ? 'good'
                      : row.status === 'failed'
                        ? 'critical'
                        : 'warning'
                  }
                >
                  {row.status === 'imported'
                    ? 'In use'
                    : row.status === 'failed'
                      ? 'Unreadable'
                      : 'Needs mapping'}
                </Badge>
              </td>
              <td className="px-5 py-2.5 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(row.id)}
                  title="Remove this export and everything it was proving"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                  <span className="sr-only">Remove</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remove.error ? (
        <p className="px-5 py-2 text-xs text-[var(--color-critical)]">
          {(remove.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The mapping step, which is deliberately not an AI proposal.
 *
 * A fixed asset register is an arbitrary artifact and gets a model to read it.
 * An evidence export has six possible fields and arrives out of a system with
 * conventional column names, so the proposal is a lookup table — offline,
 * deterministic, and re-run in the browser the moment the reader changes sheet
 * or header row, which is the point at which a model call would have made the
 * screen wait.
 */
function MappingPanel({ engagementId, row }: { engagementId: string; row: EvidenceExport }) {
  const queryClient = useQueryClient();
  const summaries = row.sheetSummaries ?? [];
  const [sheetName, setSheetName] = useState(row.sheetName ?? summaries[0]?.name ?? '');
  const [headerRow, setHeaderRow] = useState(row.headerRow ?? 0);
  const [columns, setColumns] = useState<EvidenceColumnMap>(
    row.proposedColumns ?? EMPTY_COLUMN_MAP,
  );

  const sheet = summaries.find((entry) => entry.name === sheetName) ?? summaries[0];

  const confirm = useMutation({
    mutationFn: () => api.confirmEvidence(engagementId, row.id, { sheetName, headerRow, columns }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['evidence', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  if (!sheet) {
    return (
      <div className="border-t border-[var(--color-hairline)] px-5 py-4">
        <Callout tone="critical" title={`${row.originalFilename} could not be read`}>
          {row.error ?? 'No sheets were found in the file.'}
        </Callout>
      </div>
    );
  }

  /** Re-propose whenever the row being read as headers changes. */
  const retarget = (nextSheet: SheetSummary, nextHeader: number) => {
    setSheetName(nextSheet.name);
    setHeaderRow(nextHeader);
    setColumns(proposeColumns(nextSheet.preview[nextHeader] ?? []));
  };

  const headers = sheet.preview[headerRow] ?? [];
  const width = Math.max(sheet.colCount, headers.length);
  const beyondPreview = sheet.colCount > (sheet.preview[0]?.length ?? 0);
  const usable = mappingIsUsable(columns);
  const keyed = KEYED_ON[row.kind];

  return (
    <div className="space-y-4 border-t border-[var(--color-hairline)] px-5 py-4">
      <div>
        <div className="text-sm font-medium">Map {row.originalFilename}</div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {EVIDENCE_SOURCES[row.kind].label} exports are usually matched on{' '}
          <span className="text-[var(--color-ink-secondary)]">{FIELD_LABELS[keyed]}</span>. Nothing
          is read from this file until the mapping is confirmed.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-ink-muted)]">Sheet</span>
          <Select
            value={sheet.name}
            onChange={(e) => {
              const next = summaries.find((entry) => entry.name === e.target.value);
              if (next) retarget(next, next.detectedHeaderRow ?? 0);
            }}
          >
            {summaries.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name} — {count(entry.rowCount)} {plural(entry.rowCount, 'row')}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-ink-muted)]">Header row</span>
          <Select
            value={String(headerRow)}
            onChange={(e) => retarget(sheet, Number(e.target.value))}
          >
            {sheet.preview.map((cells, index) => (
              <option key={index} value={String(index)}>
                Row {index + 1} — {rowGist(cells)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EVIDENCE_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-ink-muted)]">{FIELD_LABELS[field]}</span>
            <Select
              value={columns[field] === null ? 'none' : String(columns[field])}
              onChange={(e) =>
                setColumns({
                  ...columns,
                  [field]: e.target.value === 'none' ? null : Number(e.target.value),
                })
              }
            >
              <option value="none">Not in this file</option>
              {Array.from({ length: width }, (_, index) => (
                <option key={index} value={String(index)}>
                  {columnLabel(index, headers[index])}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>

      {beyondPreview ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          Only the first {sheet.preview[0]?.length ?? 0} columns are previewed; the rest are listed
          by their spreadsheet letter.
        </p>
      ) : null}

      {usable ? null : (
        <Callout tone="warning" title="This file cannot be imported as it stands">
          A source needs an asset tag, a serial, a model or a description — something a register row
          could be compared to. Importing one without any of them would leave every covered asset
          looking searched-and-not-found over a file that never held the answer.
        </Callout>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          disabled={!usable || confirm.isPending}
          onClick={() => confirm.mutate()}
        >
          {confirm.isPending ? 'Reading the file…' : 'Import under this mapping'}
        </Button>
        {confirm.error ? (
          <span className="text-xs text-[var(--color-critical)]">
            {(confirm.error as Error).message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What is missing, named as the file somebody would go and ask for.
 *
 * A blind spot is not a defect in the upload — it is a category no imported
 * source has scope over, which means nothing here will ever confirm or deny an
 * asset in it. Saying "the maintenance system covers this" is more useful than
 * a coverage percentage, because it is an action.
 */
function BlindSpots({
  blindSpots,
  present,
}: {
  blindSpots: NonNullable<EvidenceBoard['coverage']>['blindSpots'];
  present: readonly EvidenceSourceKind[];
}) {
  return (
    <div className="border-t border-[var(--color-hairline)] px-5 py-4">
      <div className="text-sm font-medium">Nothing can speak to these yet</div>
      <ul className="mt-2 space-y-2">
        {blindSpots.map((spot) => {
          const missing = sourcesFor(spot.categoryKey).filter(
            (source) => !present.includes(source.kind),
          );
          return (
            <li key={spot.categoryKey} className="text-xs">
              <span className="font-medium">{spot.label}</span>{' '}
              <span className="text-[var(--color-ink-muted)]">
                — {count(spot.assetCount)} {plural(spot.assetCount, 'asset')}.{' '}
                {missing.length === 0
                  ? 'No outside system in this product speaks to this category; it stays on the register on its own evidence.'
                  : `Ask for: ${missing.map((source) => source.examples).join('; ')}.`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UploadControl({ engagementId }: { engagementId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<EvidenceSourceKind>('cmms');

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadEvidence(engagementId, kind, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['evidence', engagementId] });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        The kind is chosen before the file, not after, because the kind is the
        meaning: the same column of serial numbers proves an asset exists if it
        came out of a device manager and proves the client does not own it if it
        came out of a lease schedule.
      */}
      <Select
        value={kind}
        onChange={(e) => setKind(e.target.value as EvidenceSourceKind)}
        aria-label="Which system this export came from"
      >
        {Object.values(EVIDENCE_SOURCES).map((source) => (
          <option key={source.kind} value={source.kind}>
            {source.label}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="sm"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud size={14} strokeWidth={1.8} />
        {upload.isPending ? 'Reading…' : 'Add export'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      {upload.error ? (
        <span className="text-xs text-[var(--color-critical)]">
          {(upload.error as Error).message}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The empty state carries the five sources rather than an instruction.
 *
 * Somebody who has never used this does not know that a lease subledger belongs
 * here, and that is the source that stops the most embarrassing finding this
 * product can produce. Listing what each one settles is the whole prompt.
 */
function Nothing() {
  return (
    <div className="px-5 py-6">
      <EmptyState title="No outside systems have been asked yet" icon={Radar}>
        <p>
          Every finding about whether an asset still exists rests on the register alone until one of
          these arrives. Each answers a different question:
        </p>
        <ul className="mt-3 space-y-1.5 text-left">
          {Object.values(EVIDENCE_SOURCES).map((source) => (
            <li key={source.kind}>
              <span className="font-medium">{source.label}</span>{' '}
              <span className="text-[var(--color-ink-muted)]">— {source.examples}</span>
            </li>
          ))}
        </ul>
      </EmptyState>
    </div>
  );
}

const FIELD_LABELS: Record<EvidenceField, string> = {
  assetTag: 'Asset tag',
  serial: 'Serial number',
  model: 'Model',
  description: 'Description',
  amount: 'Cost or value',
  lastSeenOn: 'Last seen',
};

/** A1-style column name, for the columns a preview never reached. */
function columnLabel(index: number, header: string | null | undefined): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  const text = (header ?? '').trim();
  return text === '' ? `Column ${letters}` : `${letters} — ${text}`;
}

/** Enough of a row to recognise it in a dropdown, and no more. */
function rowGist(cells: readonly (string | null)[]): string {
  const text = cells
    .filter((cell): cell is string => cell !== null && cell.trim() !== '')
    .slice(0, 4)
    .join(' · ');
  return text.length > 60 ? `${text.slice(0, 60)}…` : text === '' ? 'empty' : text;
}

function Loading() {
  return (
    <Card>
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Card>
  );
}
