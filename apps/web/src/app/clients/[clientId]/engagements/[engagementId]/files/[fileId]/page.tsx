'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type {
  CanonicalAssetField,
  FarFile,
  FarMapping,
  MappingAsk,
  MappingVerification,
  NormalizationResult,
  SheetMapping,
  SheetSummary,
  AskRecord,
  UpdateAskRequest,
} from '@tangible/types';
import { CANONICAL_ASSET_FIELDS, CANONICAL_FIELD_INFO } from '@tangible/types';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, moneyExact, percent, plural } from '@/lib/format';
import { FarFileStatusBadge } from '@/components/workspace/badges';
import { Button, Select } from '@/components/ui/controls';
import {
  Badge,
  BackLink,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat as SharedStat,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * The review screen: the AI's proposed mapping and the human decision meet over
 * the same preview rows the model saw. Nothing becomes an asset until the
 * person clicks confirm — this page is the gate that keeps a plausible-but-
 * wrong column mapping from quietly poisoning the analysis.
 */

export default function MappingReviewPage() {
  const { clientId, engagementId, fileId } = useParams<{
    clientId: string;
    engagementId: string;
    fileId: string;
  }>();
  const queryClient = useQueryClient();

  const {
    data: file,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['far-file', fileId],
    queryFn: () => api.farFile(fileId),
  });

  const [mapping, setMapping] = useState<FarMapping | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [result, setResult] = useState<NormalizationResult | null>(null);
  // A proposal that landed while the reviewer was editing, held rather than
  // applied. Their work is not something a background call gets to discard.
  const [heldProposal, setHeldProposal] = useState<FarFile | null>(null);
  const [edited, setEdited] = useState(false);
  const autoProposed = useRef(false);

  const propose = useMutation({
    mutationFn: (options: { auto: boolean }) =>
      api.proposeMapping(fileId).then((updated) => ({ updated, auto: options.auto })),
    onSuccess: ({ updated, auto }) => {
      queryClient.setQueryData(['far-file', fileId], updated);
      // The file list shows a status badge fed by this record.
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
      setAiNotice(null);
      if (!updated.proposal) return;
      if (auto && edited) setHeldProposal(updated);
      // An explicit re-propose is a request to see the proposal, so it wins
      // over the confirmed mapping a normalized file still carries.
      else setMapping(initialMapping(updated, 'proposal'));
    },
    onError: (cause: unknown) => {
      setAiNotice(cause instanceof Error ? cause.message : String(cause));
    },
  });

  const confirm = useMutation({
    mutationFn: () => api.confirmMapping(fileId, mapping!),
    onSuccess: (normalization: NormalizationResult) => {
      setResult(normalization);
      void queryClient.invalidateQueries({ queryKey: ['far-file', fileId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-assets', engagementId] });
    },
  });

  // Adopt the stored mapping once the file arrives; propose automatically the
  // first time a freshly-parsed file is opened, so the reviewer starts from a
  // draft rather than a blank grid.
  const { mutate: proposeMutate, isPending: proposePending } = propose;
  useEffect(() => {
    if (!file) return;
    setMapping((current) => current ?? initialMapping(file));
    if (file.status === 'parsed' && !file.proposal && !autoProposed.current) {
      autoProposed.current = true;
      proposeMutate({ auto: true });
    }
  }, [file, proposeMutate]);

  if (error) return <ErrorState error={error} />;
  // The header line, then the mapping card with a few column rows sketched in.
  if (isLoading || !file || !mapping) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-80 max-w-full" />
        <Card>
          <div className="space-y-2 p-5">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3.5 w-full max-w-lg" />
          </div>
          <ul className="divide-y divide-[var(--color-hairline)]">
            {[0, 1, 2, 3].map((row) => (
              <li key={row} className="px-5 py-3.5">
                <Skeleton className="h-4 w-full max-w-md" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }
  if (!file.sheetSummaries) {
    return (
      <ErrorState
        error={new Error(file.error ?? 'This file has no parsed sheets — re-upload it.')}
      />
    );
  }

  const summaries = file.sheetSummaries;
  const summary = summaries[activeSheet];
  const sheetMapping = summary
    ? mapping.sheets.find((s) => s.sheetName === summary.name)
    : undefined;

  const updateSheet = (sheetName: string, patch: Partial<SheetMapping>) => {
    setEdited(true);
    setMapping((current) =>
      current
        ? {
            sheets: current.sheets.map((s) => (s.sheetName === sheetName ? { ...s, ...patch } : s)),
          }
        : current,
    );
  };

  const setField = (sheetName: string, index: number, field: CanonicalAssetField | null) => {
    setEdited(true);
    setMapping((current) => {
      if (!current) return current;
      return {
        sheets: current.sheets.map((s) => {
          if (s.sheetName !== sheetName) return s;
          return {
            ...s,
            columns: s.columns.map((column) => {
              if (column.index === index) return { ...column, field };
              // One field, one column: assigning it here clears it elsewhere,
              // because normalization would otherwise silently keep the first.
              if (field !== null && column.field === field) return { ...column, field: null };
              return column;
            }),
          };
        }),
      };
    });
  };

  const checklist = mappingChecklist(mapping);

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <BackLink href={`/clients/${clientId}/engagements/${engagementId}`}>Engagement</BackLink>
        }
        title={file.originalFilename}
        meta={<FarFileStatusBadge status={file.status} />}
      />

      {file.proposal ? (
        /* The densest screen in the app carried no section headings at all: it
           opened cold on a confidence percentage, leaving the reader to infer
           from the prose that this block is a machine's reading of the workbook
           and everything below it is theirs to correct. */
        <Card>
          <CardHeader
            title="How the workbook was read"
            description="What the model made of the sheet names and the first rows — how sure it is, what it checked itself against, and anything it still needs from the client."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => propose.mutate({ auto: false })}
                disabled={proposePending}
              >
                {proposePending ? 'Proposing…' : 'Re-propose'}
              </Button>
            }
          />
          <div className="p-5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles size={14} strokeWidth={2} className="text-[var(--color-accent)]" />
              {file.proposalModel ?? 'AI'} · self-rated confidence{' '}
              {percent(file.proposal.confidence, 0)}
            </p>
            {/* The longest unbroken prose in the app, and it had the full
                width of a full-bleed card to run in — a hundred and fifty
                characters a line, on the one paragraph a reviewer has to read
                closely because it is the model saying what it assumed. */}
            <p className="mt-1 max-w-[74ch] text-sm leading-relaxed text-[var(--color-ink-secondary)]">
              {file.proposal.rationale}
            </p>
            {file.proposal.verification ? (
              <Verification verification={file.proposal.verification} />
            ) : null}
            <Asks fileId={fileId} fallback={file.proposal.asks ?? []} />
          </div>
        </Card>
      ) : proposePending ? (
        <Card className="px-5 py-4 text-sm text-[var(--color-ink-secondary)]">
          Asking the model for a column mapping…
        </Card>
      ) : null}

      {heldProposal ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-4 py-2.5 text-xs leading-relaxed">
          <span className="min-w-0 flex-1">
            A proposed mapping arrived while you were editing, so your work was kept. Applying it
            replaces every column selection below.
          </span>
          <Button
            onClick={() => {
              setMapping(initialMapping(heldProposal, 'proposal'));
              setHeldProposal(null);
            }}
          >
            Apply proposal
          </Button>
          <Button variant="ghost" onClick={() => setHeldProposal(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {aiNotice ? (
        <Callout tone="warning" icon={AlertTriangle}>
          {aiNotice} You can still map every column by hand below.
        </Callout>
      ) : null}

      {summary && sheetMapping ? (
        <Card>
          <CardHeader
            title="Column mapping"
            description="Point each of the workbook's columns at the field it fills. One field takes one column, and a sheet left out contributes no assets."
          />
          {/* The sheet switcher floated loose above the card it switches, so on
              a workbook with a rollforward tab it read as page navigation
              rather than as the tab bar of this one grid. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-hairline)] px-5 py-3">
            {summaries.map((s, index) => {
              const m = mapping.sheets.find((sheet) => sheet.sheetName === s.name);
              const active = index === activeSheet;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setActiveSheet(index)}
                  className={cn(
                    'cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors outline-none',
                    'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
                    active
                      ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] font-medium'
                      : 'border-[var(--color-hairline)] hover:bg-[var(--color-plane)]',
                    m && !m.include && 'opacity-50',
                  )}
                >
                  {s.name}
                  {m && !m.include ? ' (excluded)' : ''}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--color-hairline)] px-5 py-3 text-sm">
            <Toggle
              checked={sheetMapping.include}
              onChange={(include) => updateSheet(summary.name, { include })}
              label="Include this sheet"
              help="Excluded sheets — summaries, rollforwards, notes — contribute no assets."
            />
            <label className="text-2xs flex items-center gap-1.5 font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
              Header row
              <Select
                value={sheetMapping.headerRow === null ? 'none' : String(sheetMapping.headerRow)}
                onChange={(e) =>
                  updateSheet(summary.name, {
                    headerRow: e.target.value === 'none' ? null : Number(e.target.value),
                  })
                }
                className="h-8 w-24 text-xs"
              >
                <option value="none">none</option>
                {summary.preview.map((_, i) => (
                  <option key={i} value={i}>
                    row {i + 1}
                  </option>
                ))}
              </Select>
              <InfoTip
                title="Header row"
                content="The row holding column titles; data starts below it. Title rows above the real headers are common."
                size={12}
              />
            </label>
            <Toggle
              checked={sheetMapping.categoryFromBands}
              onChange={(categoryFromBands) => updateSheet(summary.name, { categoryFromBands })}
              label="Sections name the category"
              help='Hand-built registers often carry the asset class only as a section row — "Machinery & Equipment" above the rows it describes. When on, such rows set the category for everything beneath them instead of becoming assets.'
            />
            <span className="ml-auto text-xs text-[var(--color-ink-muted)]">
              {count(summary.rowCount)} rows × {summary.colCount} columns
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-hairline)]">
                  <th className="w-10 px-2 py-2 text-right text-xs text-[var(--color-ink-muted)]">
                    #
                  </th>
                  {Array.from({ length: Math.min(summary.colCount, 40) }, (_, index) => (
                    <th key={index} className="min-w-36 px-1.5 py-2">
                      <FieldSelect
                        value={fieldAt(sheetMapping, index)}
                        onChange={(field) => setField(summary.name, index, field)}
                        disabled={!sheetMapping.include}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.preview.map((row, rowIndex) => {
                  const isHeader = rowIndex === sheetMapping.headerRow;
                  return (
                    <tr
                      key={rowIndex}
                      className={cn(
                        'border-b border-[var(--color-hairline)] last:border-0',
                        isHeader &&
                          'bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] font-medium',
                      )}
                    >
                      <td className="tabular px-2 py-1.5 text-right text-xs text-[var(--color-ink-muted)]">
                        {rowIndex + 1}
                      </td>
                      {Array.from({ length: Math.min(summary.colCount, 40) }, (_, colIndex) => (
                        <td key={colIndex} className="max-w-48 truncate px-1.5 py-1.5">
                          {row[colIndex] ?? ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* The one act on the page that rewrites data, and it had been a bare
          strip of chips with a button pushed to the right of them — nothing
          said what confirming does, or that doing it twice is safe. */}
      <Card>
        <CardHeader
          title="Confirm the mapping"
          description="Confirming normalizes every included sheet into assets. Doing it again replaces them wholesale — there is no partial state."
          action={
            <Button
              variant="primary"
              disabled={confirm.isPending || !mapping.sheets.some((s) => s.include)}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending
                ? 'Normalizing…'
                : file.status === 'normalized'
                  ? 'Re-confirm & replace assets'
                  : 'Confirm mapping & import assets'}
            </Button>
          }
        />
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {checklist.map((item) => (
              <Badge key={item.label} tone={item.ok ? 'good' : 'warning'}>
                {item.ok ? <Check size={11} strokeWidth={3} className="mr-1" /> : null}
                {item.label}
              </Badge>
            ))}
          </div>
          {!checklist.every((c) => c.ok) ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
              Confirming without the amber fields works — the gaps land as per-row warnings instead
              of silently guessed values.
            </p>
          ) : null}
          {confirm.error ? (
            <p className="mt-2 text-xs text-[var(--color-critical)]">
              {confirm.error instanceof ApiError ? confirm.error.message : String(confirm.error)}
            </p>
          ) : null}
        </div>
      </Card>

      {result ? (
        <Card>
          <CardHeader
            title="Import result"
            description="What the confirmed mapping produced. Re-confirming replaces these assets wholesale — there is no partial state."
          />
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
            <Stat label="Assets imported" value={count(result.inserted)} />
            <Stat label="Total original cost" value={moneyExact(result.totalCost)} />
            <Stat label="Rows with warnings" value={count(result.warningCount)} />
            <Stat label="Rows skipped" value={count(result.skippedCount)} />
          </div>
          {result.skipped.length > 0 ? (
            <div className="border-t border-[var(--color-hairline)] px-5 py-3">
              <p className="text-2xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                Skipped rows{' '}
                {result.skippedCount > result.skipped.length
                  ? `(first ${result.skipped.length} of ${result.skippedCount})`
                  : ''}
              </p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--color-ink-secondary)]">
                {result.skipped.slice(0, 12).map((skip, i) => (
                  <li key={i}>
                    {skip.sheet}
                    {skip.row >= 0 ? ` row ${skip.row + 1}` : ''} — {skip.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="border-t border-[var(--color-hairline)] px-5 py-3">
            <Link href={`/clients/${clientId}/engagements/${engagementId}`}>
              <Button variant="primary">Back to the engagement</Button>
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <SharedStat label={label} value={value} size="lg" />;
}

function Toggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-sm pointer-coarse:min-h-8">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)]"
      />
      {label}
      <InfoTip title={label} content={help} size={12} />
    </label>
  );
}

function FieldSelect({
  value,
  onChange,
  disabled,
}: {
  value: CanonicalAssetField | null;
  onChange: (field: CanonicalAssetField | null) => void;
  disabled: boolean;
}) {
  return (
    <Select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as CanonicalAssetField | null)}
      className={cn(
        'h-8 w-full text-xs',
        value
          ? 'border-[color-mix(in_oklab,var(--color-accent)_45%,transparent)] font-medium'
          : 'text-[var(--color-ink-muted)]',
      )}
    >
      <option value="">— unmapped</option>
      {CANONICAL_ASSET_FIELDS.map((field) => (
        <option key={field} value={field}>
          {CANONICAL_FIELD_INFO[field].label}
        </option>
      ))}
    </Select>
  );
}

function fieldAt(sheet: SheetMapping, index: number): CanonicalAssetField | null {
  return sheet.columns.find((column) => column.index === index)?.field ?? null;
}

/**
 * Build the local editing state. Opening the page shows what was last
 * confirmed, falling back to the proposal; asking for a proposal shows the
 * proposal, because a rationale describing a mapping the grid does not show is
 * worse than no rationale at all. Either way every column index gets an entry so
 * the selects have something to bind to, and sheets the mapping does not know
 * about appear excluded.
 */
function initialMapping(file: FarFile, prefer: 'confirmed' | 'proposal' = 'confirmed'): FarMapping {
  const summaries = file.sheetSummaries ?? [];
  const proposed = file.proposal ? { sheets: file.proposal.sheets } : null;
  const source =
    prefer === 'proposal'
      ? (proposed ?? file.confirmedMapping)
      : (file.confirmedMapping ?? proposed);

  const sheets = summaries.map((summary): SheetMapping => {
    const existing = source?.sheets.find((s) => s.sheetName === summary.name);
    const byIndex = new Map(existing?.columns.map((c) => [c.index, c]) ?? []);
    return {
      sheetName: summary.name,
      include: existing?.include ?? source === null,
      headerRow: existing ? existing.headerRow : summary.detectedHeaderRow,
      categoryFromBands: existing?.categoryFromBands ?? false,
      columns: Array.from({ length: summary.colCount }, (_, index) => ({
        index,
        field: byIndex.get(index)?.field ?? null,
        ...(byIndex.get(index)?.note ? { note: byIndex.get(index)!.note } : {}),
      })),
    };
  });

  return { sheets };
}

function mappingChecklist(mapping: FarMapping): { label: string; ok: boolean }[] {
  const included = mapping.sheets.filter((s) => s.include);
  const mapped = new Set(
    included.flatMap((s) =>
      s.columns.map((c) => c.field).filter((f): f is CanonicalAssetField => f !== null),
    ),
  );
  const sheetsLabel = `${included.length} ${plural(included.length, 'sheet')} included`;
  return [
    { label: sheetsLabel, ok: included.length > 0 },
    { label: 'description', ok: mapped.has('description') },
    { label: 'original cost', ok: mapped.has('originalCost') },
    {
      label: 'acquisition date/year',
      ok: mapped.has('acquisitionDate') || mapped.has('acquisitionYear'),
    },
  ];
}

/**
 * What the proposal survived before it reached this screen.
 *
 * These are the measurements the propose–verify–revise loop ran against the
 * full workbook — the proposal was applied in memory and its output footed
 * against the file's own printed totals. Shown check by check rather than as
 * one verdict, because a failed check is not "reject": some registers really
 * have no total row, and the reviewer deciding whether to trust the mapping
 * should see exactly which measurement the doubt comes from. Older proposals
 * carry no verification and render without this block.
 */
function Verification({ verification }: { verification: MappingVerification }) {
  const failed = verification.checks.filter((check) => !check.ok);
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-[var(--color-ink-muted)]">
        {verification.rounds === 1
          ? 'Checked against the full workbook — survived the first proposal.'
          : `Checked against the full workbook — took ${verification.rounds} rounds.`}
        {failed.length > 0
          ? ` ${failed.length} ${plural(failed.length, 'check')} still ${plural(failed.length, 'fails', 'fail')}:`
          : ''}
      </p>
      <ul className="space-y-0.5">
        {verification.checks.map((check) => (
          <li key={check.check} className="flex items-start gap-1.5 text-xs leading-relaxed">
            {check.ok ? (
              <Check
                size={12}
                strokeWidth={2.5}
                className="mt-0.5 shrink-0 text-[var(--color-good)]"
              />
            ) : (
              <span className="mt-0.5 shrink-0 font-semibold text-[var(--color-critical)]">!</span>
            )}
            <span
              className={
                check.ok ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-ink-secondary)]'
              }
            >
              {check.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The questions only the client can answer.
 *
 * Rendered as forwardable questions, not commentary, because that is what they
 * are: each one is a decision the mapping or the filing depends on that the
 * file itself cannot make. They live outside the rationale so they read as
 * work to be done rather than caveats to be skimmed — the failure mode this
 * exists to prevent is "is this fiscal year or calendar year?" being read once
 * at intake and never put to anybody.
 */
function Asks({ fileId, fallback }: { fileId: string; fallback: readonly MappingAsk[] }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['file-asks', fileId],
    queryFn: () => api.fileAsks(fileId),
  });

  const update = useMutation({
    mutationFn: ({ askId, body }: { askId: string; body: UpdateAskRequest }) =>
      api.updateAsk(askId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['file-asks', fileId] });
    },
  });

  const ledger = data?.items ?? [];
  // Ledger rows exist for any file proposed since asks became durable; the
  // fallback covers older proposals whose asks live only in the jsonb.
  if (ledger.length === 0 && fallback.length === 0) return null;

  const answered = ledger.filter((a) => a.status === 'answered').length;

  return (
    <div className="mt-2.5 space-y-1.5 rounded-md border border-[color-mix(in_oklab,var(--color-accent)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_6%,transparent)] px-3 py-2.5">
      <p className="text-xs font-medium">
        {ledger.length > 0
          ? `Questions for the client — ${answered} of ${ledger.length} answered`
          : `${fallback.length === 1 ? 'One question' : `${fallback.length} questions`} for the client — the file cannot answer ${fallback.length === 1 ? 'it' : 'these'}:`}
      </p>
      {ledger.length > 0 ? (
        <>
          <ul className="space-y-2">
            {ledger.map((ask) => (
              <AskRow
                key={ask.id}
                ask={ask}
                pending={update.isPending}
                onUpdate={(body) => update.mutate({ askId: ask.id, body })}
              />
            ))}
          </ul>
          {answered > 0 ? (
            <p className="text-xs text-[var(--color-ink-secondary)]">
              Answers go back into the next proposal as fact — re-propose to fold them into the
              mapping.
            </p>
          ) : null}
        </>
      ) : (
        <ul className="space-y-1.5">
          {fallback.map((ask, i) => (
            <li key={i} className="text-xs leading-relaxed">
              <span className="font-medium">{ask.question}</span>
              {ask.sheetName ? (
                <span className="text-[var(--color-ink-muted)]"> ({ask.sheetName})</span>
              ) : null}
              <span className="block text-[var(--color-ink-secondary)]">{ask.why}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One question, worked. Open takes an answer or a dismissal; both are
 * reversible, because a corrected answer or a reconsidered dismissal is normal
 * work, not an exception.
 */
function AskRow({
  ask,
  pending,
  onUpdate,
}: {
  ask: AskRecord;
  pending: boolean;
  onUpdate: (body: UpdateAskRequest) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <li className="text-xs leading-relaxed">
      <span
        className={
          ask.status === 'dismissed'
            ? 'font-medium text-[var(--color-ink-muted)] line-through'
            : 'font-medium'
        }
      >
        {ask.question}
      </span>
      {ask.sheetName ? (
        <span className="text-[var(--color-ink-muted)]"> ({ask.sheetName})</span>
      ) : null}
      <span className="block text-[var(--color-ink-secondary)]">{ask.why}</span>
      {ask.status === 'answered' ? (
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[var(--color-good)]">Answered: {ask.answer}</span>
          <button
            type="button"
            className="text-[var(--color-ink-muted)] underline decoration-dotted hover:text-[var(--color-ink)]"
            onClick={() => onUpdate({ status: 'open', answer: null })}
            disabled={pending}
          >
            reopen
          </button>
        </span>
      ) : ask.status === 'dismissed' ? (
        <span className="mt-0.5 flex items-center gap-1.5 text-[var(--color-ink-muted)]">
          Dismissed — the client will not be asked.
          <button
            type="button"
            className="underline decoration-dotted hover:text-[var(--color-ink)]"
            onClick={() => onUpdate({ status: 'open', answer: null })}
            disabled={pending}
          >
            reopen
          </button>
        </span>
      ) : (
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="The client's answer…"
            className="min-w-48 flex-1 rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <Button
            onClick={() => onUpdate({ status: 'answered', answer: draft })}
            disabled={pending || draft.trim().length === 0}
          >
            Record answer
          </Button>
          <button
            type="button"
            className="text-[var(--color-ink-muted)] underline decoration-dotted hover:text-[var(--color-ink)]"
            onClick={() => onUpdate({ status: 'dismissed', answer: null })}
            disabled={pending}
          >
            dismiss
          </button>
        </span>
      )}
    </li>
  );
}
