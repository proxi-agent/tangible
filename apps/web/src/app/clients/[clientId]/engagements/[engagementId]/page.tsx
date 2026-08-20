'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ArrowLeft, FileCheck, FileSpreadsheet, FileText, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { Asset, AssetSortField, Engagement, EngagementDetail, FarFile } from '@tangible/types';
import { FAR_UPLOAD_EXTENSIONS } from '@tangible/types';
import { lookupSicProfile, scheduledJurisdictions, TX_HARRIS_2026 } from '@tangible/valuation';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, plural } from '@/lib/format';
import { FarFileStatusBadge } from '@/components/workspace/badges';
import { ClassificationCard } from '@/components/workspace/classification-card';
import { PriorsCard } from '@/components/workspace/priors-card';
import { ValuationCard } from '@/components/workspace/valuation-card';
import { Button, ChipGroup, Select, TextInput } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/data-table';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

export default function EngagementPage() {
  const { clientId, engagementId } = useParams<{ clientId: string; engagementId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => api.engagement(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/clients/${clientId}`}
          className="flex items-center gap-1 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          {data.client.name}
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Tax year {data.engagement.taxYear}</h1>
        <JurisdictionPicker engagement={data.engagement} />
        <AccountLink engagement={data.engagement} />
        <SicField engagement={data.engagement} />
        {data.classification.classifiedCount > 0 ? (
          <Link
            href={`/clients/${clientId}/engagements/${engagementId}/report`}
            className="ml-auto"
          >
            <Button variant="primary">
              <FileText size={14} strokeWidth={2} />
              Savings report
            </Button>
          </Link>
        ) : null}
        {data.classification.classifiedCount > 0 ? (
          <Link href={`/clients/${clientId}/engagements/${engagementId}/filing`}>
            <Button>
              <FileCheck size={14} strokeWidth={2} />
              Rendition
            </Button>
          </Link>
        ) : null}
      </div>

      {data.stats.assetCount > 0 ? <StatsRow detail={data} /> : null}
      {/* Value before inventory: the point of the register is what it is worth,
          and the asset list is the evidence underneath that. */}
      {data.classification.classifiedCount > 0 ? (
        <ValuationCard engagementId={engagementId} />
      ) : null}
      {data.stats.assetCount > 0 ? (
        <ClassificationCard engagementId={engagementId} stats={data.classification} />
      ) : null}
      <FilesCard detail={data} clientId={clientId} engagementId={engagementId} />
      {/* Both halves of the intake sit together: the register says what the
          client owns, the prior filing says what they told the district. */}
      <PriorsCard clientId={clientId} engagementId={engagementId} />
      {data.stats.assetCount > 0 ? <AssetsCard detail={data} engagementId={engagementId} /> : null}
    </div>
  );
}

const JURISDICTIONS = scheduledJurisdictions();

/**
 * Where the property sits, which decides whose arithmetic values it.
 *
 * The list is the jurisdictions whose schedules are actually loaded, not every
 * county in the warehouse: picking one we cannot price would set an expectation
 * the valuation card then has to break.
 */
function JurisdictionPicker({ engagement }: { engagement: Engagement }) {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (jurisdictionId: string) => api.updateEngagement(engagement.id, { jurisdictionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagement.id] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-valuation', engagement.id] });
    },
  });

  return (
    <div className="flex items-center gap-2">
      <Select
        value={engagement.jurisdictionId ?? ''}
        onChange={(e) => update.mutate(e.target.value)}
        disabled={update.isPending}
        aria-label="Jurisdiction"
        className="h-8 text-xs"
      >
        <option value="">Jurisdiction not set</option>
        {JURISDICTIONS.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </Select>
      {!engagement.jurisdictionId ? (
        <Tooltip
          title="Why this matters"
          content="Business personal property is assessed where it sits on January 1, and each district publishes its own depreciation schedules. Nothing can be valued until this is set."
        >
          <span className="cursor-help text-[11px] text-[var(--color-warning)]">
            needed to value
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * The client's account on the public roll.
 *
 * Free text rather than a picker: an operator reads this off a notice or an
 * HCAD search, and forcing them through a lookup screen to record a number they
 * already have in front of them would just mean it never gets recorded. A wrong
 * number fails visibly — the report says it found no account — rather than
 * quietly comparing against someone else's assessment.
 */
function AccountLink({ engagement }: { engagement: Engagement }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(engagement.accountId ?? '');
  const update = useMutation({
    mutationFn: (accountId: string) => api.updateEngagement(engagement.id, { accountId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagement.id] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-savings', engagement.id] });
    },
  });

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(value.trim());
      }}
    >
      <TextInput
        placeholder="Roll account #"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== (engagement.accountId ?? '')) update.mutate(value.trim());
        }}
        aria-label="Account on the public roll"
        className="h-8 w-40 text-xs"
      />
      {!engagement.accountId ? (
        <Tooltip
          title="Why this matters"
          content="The savings report compares the corrected position against what the district actually assessed. Without the account number there is no “before”, so no saving can be claimed."
        >
          <span className="cursor-help text-[11px] text-[var(--color-ink-muted)]">
            needed to compare
          </span>
        </Tooltip>
      ) : null}
    </form>
  );
}

/**
 * The taxpayer's SIC code.
 *
 * Texas keys the machinery life to what the business does, not to the machine,
 * so this one field moves every machinery asset on the engagement between an
 * eight- and a fifteen-year schedule. Left blank, machinery sits on the
 * category's ten-year placeholder — which is a real number, just not the
 * district's answer, and the report says which one applied.
 */
function SicField({ engagement }: { engagement: Engagement }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(engagement.sicCode ?? '');
  const update = useMutation({
    mutationFn: (sicCode: string) => api.updateEngagement(engagement.id, { sicCode }),
    onSuccess: () => {
      for (const key of ['engagement', 'engagement-valuation', 'engagement-savings']) {
        void queryClient.invalidateQueries({ queryKey: [key, engagement.id] });
      }
    },
  });

  const profile = value.trim() ? lookupSicProfile(TX_HARRIS_2026, value) : null;

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(value.trim());
      }}
    >
      <TextInput
        placeholder="SIC"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== (engagement.sicCode ?? '')) update.mutate(value.trim());
        }}
        aria-label="SIC code"
        className="h-8 w-24 text-xs"
      />
      {profile ? (
        <Tooltip
          title={`SIC ${profile.sic}`}
          content={`${profile.profile.description} — machinery depreciates on a ${profile.profile.machineryLife}-year life in this district.`}
        >
          <span className="max-w-40 cursor-help truncate text-[11px] text-[var(--color-ink-muted)]">
            {profile.profile.machineryLife}yr · {profile.profile.description.toLowerCase()}
          </span>
        </Tooltip>
      ) : value.trim() ? (
        <span className="text-[11px] text-[var(--color-warning)]">not in the guide</span>
      ) : null}
    </form>
  );
}

function StatsRow({ detail }: { detail: EngagementDetail }) {
  const { stats } = detail;
  const tiles = [
    { label: 'Assets', value: count(stats.assetCount) },
    { label: 'Total original cost', value: money(stats.totalCost) },
    { label: 'Marked disposed', value: count(stats.disposedCount) },
    { label: 'Rows with warnings', value: count(stats.warningCount) },
    { label: 'Missing cost', value: count(stats.missingCostCount) },
    { label: 'Missing year', value: count(stats.missingYearCount) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Card key={tile.label} className="px-4 py-3">
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            {tile.label}
          </p>
          <p className="tabular mt-1 text-lg font-semibold">{tile.value}</p>
        </Card>
      ))}
    </div>
  );
}

function FilesCard({
  detail,
  clientId,
  engagementId,
}: {
  detail: EngagementDetail;
  clientId: string;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadFar(engagementId, file),
    onSuccess: (file: FarFile) => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
      // Straight to mapping — the review is the very next thing anyone does.
      if (file.status === 'parsed') {
        router.push(`/clients/${clientId}/engagements/${engagementId}/files/${file.id}`);
      }
    },
  });

  const accept = FAR_UPLOAD_EXTENSIONS.join(',');

  return (
    <Card>
      <CardHeader
        title="Fixed asset registers"
        description="Upload the client's FAR export — Sage, NetSuite, QuickBooks, or a hand-built workbook. Parsing never guesses: the AI proposes a column mapping and a person confirms it before assets exist."
      />

      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload.mutate(file);
          }}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-sm transition-colors outline-none',
            'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
            dragging
              ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_8%,transparent)]'
              : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] hover:bg-[var(--color-plane)]',
          )}
        >
          <UploadCloud size={20} strokeWidth={1.8} className="text-[var(--color-ink-muted)]" />
          {upload.isPending ? (
            <span>Uploading and reading sheets…</span>
          ) : (
            <>
              <span className="font-medium">Drop a register here, or click to choose</span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {FAR_UPLOAD_EXTENSIONS.join(' · ')} — stored privately, parsed immediately
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        {upload.error ? (
          <p className="mt-2 text-xs text-[var(--color-critical)]">
            {upload.error instanceof Error ? upload.error.message : String(upload.error)}
          </p>
        ) : null}
      </div>

      {detail.files.length === 0 ? (
        <EmptyState title="No registers uploaded yet">
          The pitch starts here: the FAR comes in, the audit comes out.
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-hairline)]">
          {detail.files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <FileSpreadsheet
                size={16}
                strokeWidth={1.8}
                className="shrink-0 text-[var(--color-ink-muted)]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.originalFilename}</p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {(file.byteSize / 1024).toFixed(0)} KB
                  {file.sheetSummaries
                    ? ` · ${file.sheetSummaries.length} ${plural(file.sheetSummaries.length, 'sheet')}`
                    : ''}
                  {file.assetCount > 0 ? ` · ${count(file.assetCount)} assets` : ''}
                </p>
                {file.error ? (
                  <p className="mt-0.5 text-xs text-[var(--color-critical)]">{file.error}</p>
                ) : null}
              </div>
              <FarFileStatusBadge status={file.status} />
              {file.status !== 'failed' && file.status !== 'uploaded' ? (
                <Link href={`/clients/${clientId}/engagements/${engagementId}/files/${file.id}`}>
                  <Button>
                    {file.status === 'normalized' ? 'Revisit mapping' : 'Review mapping'}
                  </Button>
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ASSET_FILTERS = [
  {
    value: 'warnings' as const,
    label: 'With warnings',
    description:
      'Rows that normalized with something soft — missing cost, no acquisition year, a negative value.',
  },
  {
    value: 'disposed' as const,
    label: 'Disposed',
    description:
      'Rows with a disposal date or a disposed-shaped status. If these still appear on the rendition, that is the ghost-asset lever.',
  },
];

function AssetsCard({ detail, engagementId }: { detail: EngagementDetail; engagementId: string }) {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [filters, setFilters] = useState<('warnings' | 'disposed')[]>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const sortBy = (sorting[0]?.id as AssetSortField | undefined) ?? 'sourceRow';
  const sortDir = sorting[0]?.desc ? ('desc' as const) : ('asc' as const);

  const query = {
    search: submittedSearch || undefined,
    warningsOnly: filters.includes('warnings') || undefined,
    disposedOnly: filters.includes('disposed') || undefined,
    sortBy,
    sortDir,
    limit,
    offset,
  };

  const { data, error } = useQuery({
    queryKey: ['engagement-assets', engagementId, query],
    queryFn: () => api.engagementAssets(engagementId, query),
    placeholderData: (previous) => previous,
  });

  const columns: ColumnDef<Asset, unknown>[] = [
    {
      id: 'sourceRow',
      header: 'Source',
      accessorFn: (row) => row.sourceRow,
      cell: ({ row }) => (
        <span className="text-xs text-[var(--color-ink-muted)]">
          {row.original.sourceSheet} · {row.original.sourceRow + 1}
        </span>
      ),
      meta: {
        help: 'Sheet and row in the uploaded workbook this asset came from — every number stays traceable to its cells.',
      },
    },
    {
      id: 'description',
      header: 'Description',
      accessorFn: (row) => row.description,
      cell: ({ row }) => (
        <div className="max-w-96">
          <p className="truncate">{row.original.description ?? '—'}</p>
          {row.original.warnings.length > 0 ? (
            <Tooltip
              title="Warnings"
              content={
                <ul className="list-disc pl-4">
                  {row.original.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            >
              <span className="cursor-help text-[11px] text-[var(--color-warning)]">
                {row.original.warnings.length} {plural(row.original.warnings.length, 'warning')}
              </span>
            </Tooltip>
          ) : null}
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      accessorFn: (row) => row.category,
      cell: ({ row }) => row.original.category ?? '—',
    },
    {
      id: 'acquisitionYear',
      header: 'Acquired',
      accessorFn: (row) => row.acquisitionYear,
      cell: ({ row }) => row.original.acquisitionDate ?? row.original.acquisitionYear ?? '—',
      meta: { align: 'right' as const },
    },
    {
      id: 'originalCost',
      header: 'Original cost',
      accessorFn: (row) => row.originalCost,
      cell: ({ row }) => moneyExact(row.original.originalCost),
      meta: { align: 'right' as const },
    },
    {
      id: 'disposed',
      header: 'Disposed',
      enableSorting: false,
      cell: ({ row }) => (row.original.isDisposed ? <Badge tone="critical">disposed</Badge> : null),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Assets"
        description="The canonical rows produced by the confirmed mappings, across every file in this engagement."
      />
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSubmittedSearch(search.trim());
          }}
        >
          <TextInput
            placeholder="Search description, tag, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
        </form>
        <ChipGroup
          options={ASSET_FILTERS}
          selected={filters}
          onToggle={(value) => {
            setOffset(0);
            setFilters((current) =>
              current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
            );
          }}
        />
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={(next) => {
            setOffset(0);
            setSorting(next);
          }}
          pagination={{ offset, limit, total: data?.total ?? detail.stats.assetCount }}
          onOffsetChange={setOffset}
          empty={{ title: 'Nothing matches these filters' }}
        />
      )}
    </Card>
  );
}
