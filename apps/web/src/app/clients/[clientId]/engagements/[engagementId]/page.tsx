'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  FileCheck,
  FileSpreadsheet,
  FileText,
  MessageCircleQuestion,
  UploadCloud,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { Asset, AssetSortField, Engagement, EngagementDetail, FarFile } from '@tangible/types';
import { FAR_UPLOAD_EXTENSIONS } from '@tangible/types';
import { lookupSicProfile, scheduledJurisdictions, TX_HARRIS_2026 } from '@tangible/valuation';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, plural } from '@/lib/format';
import { FarFileStatusBadge } from '@/components/workspace/badges';
import { CarryForwardCard } from '@/components/workspace/carry-forward-card';
import { DownloadButton } from '@/components/workspace/download-button';
import { EngagementPipeline } from '@/components/workspace/engagement-pipeline';
import { ClassificationCard } from '@/components/workspace/classification-card';
import { FindingsCard } from '@/components/workspace/findings-card';
import { OpenYearsCard } from '@/components/workspace/open-years-card';
import { PriorsCard } from '@/components/workspace/priors-card';
import { ResultCard } from '@/components/workspace/result-card';
import { ReturnsBoard } from '@/components/workspace/returns-board';
import { SitesCard } from '@/components/workspace/sites-card';
import { IntakeCard } from '@/components/workspace/intake-card';
import { ValuationCard } from '@/components/workspace/valuation-card';
import { Button, ChipGroup, Select, TextInput } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/data-table';
import {
  BackLink,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The engagement's sections, in the order the work happens.
 *
 * One page used to hold all of this at once — fifteen cards deep, with the
 * result letter rendering above the upload dropzones that start the work.
 * The tabs mirror the pipeline instead, and the overview carries the two
 * things somebody opening a live engagement actually asks: what is next, and
 * what still has to go out.
 */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'intake', label: 'Intake' },
  { id: 'assets', label: 'Assets' },
  { id: 'value', label: 'Value' },
  { id: 'sites', label: 'Sites' },
  { id: 'findings', label: 'Findings' },
  { id: 'results', label: 'Results' },
  { id: 'priors', label: 'Prior years' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function EngagementPage() {
  const { clientId, engagementId } = useParams<{ clientId: string; engagementId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asked = searchParams.get('tab');
  const tab: TabId = TABS.some((entry) => entry.id === asked) ? (asked as TabId) : 'overview';
  const tabHref = (id: string) => (id === 'overview' ? pathname : `${pathname}?tab=${id}`);

  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => api.engagement(engagementId),
  });
  // The overview's returns board and pipeline both read this key, but they
  // mount only after the detail query above resolves — which turns two
  // independent fetches into a waterfall and doubles the skeleton time.
  // Asking here starts both in parallel; the board finds its data warm.
  useQuery({
    queryKey: ['engagement-season', engagementId],
    queryFn: () => api.season(engagementId),
    enabled: tab === 'overview',
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data)
    return (
      // Shaped like the page it becomes — header line, tab bar, then the two
      // overview cards — so the load reads as the page forming, not a slab.
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-56" />
        </div>
        <Skeleton className="h-8 w-full max-w-xl" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink href={`/clients/${clientId}`}>{data.client.name}</BackLink>}
        title={`Tax year ${data.engagement.taxYear}`}
        meta={
          <>
            <JurisdictionPicker engagement={data.engagement} />
            <SicField engagement={data.engagement} />
          </>
        }
        actions={
          <>
            {/*
          Ungated on purpose: asking an empty record is a fair thing to do, and
          it answers that the record is empty rather than hiding the door.
        */}
            <Link href={`/clients/${clientId}/engagements/${engagementId}/ask`}>
              <Button>
                <MessageCircleQuestion size={14} strokeWidth={2} />
                Ask the record
              </Button>
            </Link>
            {data.classification.classifiedCount > 0 ? (
              <Link href={`/clients/${clientId}/engagements/${engagementId}/report`}>
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
            {data.classification.classifiedCount > 0 ? (
              <DownloadButton href={`/api/engagements/${engagementId}/export`}>
                <FileSpreadsheet size={14} strokeWidth={2} />
                Excel
              </DownloadButton>
            ) : null}
          </>
        }
      />

      <TabNav tab={tab} tabHref={tabHref} />
      <TabBody
        tab={tab}
        detail={data}
        clientId={clientId}
        engagementId={engagementId}
        tabHref={tabHref}
      />
    </div>
  );
}

function TabNav({ tab, tabHref }: { tab: TabId; tabHref: (id: string) => string }) {
  return (
    <nav
      className="flex flex-wrap gap-1 border-b border-[var(--color-hairline)] pb-px"
      aria-label="Engagement sections"
    >
      {TABS.map((entry) => (
        <Link
          key={entry.id}
          href={tabHref(entry.id)}
          scroll={false}
          aria-current={entry.id === tab ? 'page' : undefined}
          className={cn(
            '-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium',
            entry.id === tab
              ? 'border-[var(--color-ink)] text-[var(--color-ink)]'
              : 'border-transparent text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]',
          )}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}

function TabBody({
  tab,
  detail,
  clientId,
  engagementId,
  tabHref,
}: {
  tab: TabId;
  detail: EngagementDetail;
  clientId: string;
  engagementId: string;
  tabHref: (id: string) => string;
}) {
  const hasAssets = detail.stats.assetCount > 0;
  const intake = (
    <>
      No assets yet — the register is what everything downstream is built from. Upload it under{' '}
      <Link href={tabHref('intake')} scroll={false} className="font-medium hover:underline">
        Intake
      </Link>
      .
    </>
  );

  switch (tab) {
    case 'overview':
      // What is next, then what still has to go out — the two questions
      // somebody opening a live engagement is actually holding.
      return (
        <>
          <EngagementPipeline
            detail={detail}
            tabHref={tabHref}
            filingHref={`/clients/${clientId}/engagements/${engagementId}/filing`}
          />
          <ReturnsBoard clientId={clientId} engagementId={engagementId} />
        </>
      );
    case 'intake':
      // Both halves of the intake together: the register says what the client
      // owns, the prior filing says what they told the district.
      return (
        <>
          <IntakeCard clientId={clientId} engagementId={engagementId} />
          <FilesCard detail={detail} clientId={clientId} engagementId={engagementId} />
          <PriorsCard clientId={clientId} engagementId={engagementId} />
        </>
      );
    case 'assets':
      if (!hasAssets) {
        return (
          <Card>
            <EmptyState title="No assets yet">{intake}</EmptyState>
          </Card>
        );
      }
      return (
        <>
          <StatsRow detail={detail} />
          <AssetsCard detail={detail} clientId={clientId} engagementId={engagementId} />
        </>
      );
    case 'value':
      if (!hasAssets) {
        return (
          <Card>
            <EmptyState title="Nothing to value yet">{intake}</EmptyState>
          </Card>
        );
      }
      // Value before inventory: the point of the register is what it is
      // worth, and classification is the decision that number turns on.
      return (
        <>
          {detail.classification.classifiedCount > 0 ? (
            <ValuationCard engagementId={engagementId} />
          ) : null}
          <ClassificationCard engagementId={engagementId} stats={detail.classification} />
        </>
      );
    case 'sites':
      if (!hasAssets) {
        return (
          <Card>
            <EmptyState title="Nothing to place yet">{intake}</EmptyState>
          </Card>
        );
      }
      return <SitesCard clientId={clientId} engagementId={engagementId} />;
    case 'findings':
      // The comparison feeds the findings, so it reads first — and stays
      // deliberately absent on a first season, where there is nothing to
      // compare against.
      return (
        <>
          {hasAssets ? <CarryForwardCard engagementId={engagementId} /> : null}
          <FindingsCard
            clientId={clientId}
            engagementId={engagementId}
            empty={
              <Card>
                <EmptyState title="Nothing committed yet">
                  Findings appear here once a savings report or a comparison against a prior return
                  is committed — dated records of the figures that went out, with what was decided
                  about every line.
                </EmptyState>
              </Card>
            }
          />
        </>
      );
    case 'results':
      return (
        <ResultCard
          engagementId={engagementId}
          empty={
            <Card>
              <EmptyState title="No returns out yet">
                The scoreboard starts once a return has gone out — what was rendered, what the
                district noticed, and where the value stands.
              </EmptyState>
            </Card>
          }
        />
      );
    case 'priors':
      return (
        <OpenYearsCard
          clientId={clientId}
          engagementId={engagementId}
          empty={
            <Card>
              <EmptyState title="No prior years on file">
                Upload a prior rendition or notice under{' '}
                <Link
                  href={tabHref('intake')}
                  scroll={false}
                  className="font-medium hover:underline"
                >
                  Intake
                </Link>{' '}
                and this becomes the back catalogue: which closed years Tax Code 25.25 can still
                reach, and the motions that reach them.
              </EmptyState>
            </Card>
          }
        />
      );
  }
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
        compact
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
          <span className="cursor-help text-xs text-[var(--color-warning)]">needed to value</span>
        </Tooltip>
      ) : null}
    </div>
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
  const fieldId = useId();
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
      {/* A filled field shows a bare four-digit number and nothing else — the
          placeholder that explained it is gone the moment it is answered. The
          label stays. */}
      <label htmlFor={fieldId} className="eyebrow cursor-pointer">
        SIC
      </label>
      <TextInput
        id={fieldId}
        placeholder="0000"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== (engagement.sicCode ?? '')) update.mutate(value.trim());
        }}
        className="tabular h-8 w-20 text-xs"
      />
      {profile ? (
        <Tooltip
          title={`SIC ${profile.sic}`}
          content={`${profile.profile.description} — machinery depreciates on a ${profile.profile.machineryLife}-year life in this district.`}
        >
          <span className="max-w-40 cursor-help truncate text-xs text-[var(--color-ink-muted)]">
            {profile.profile.machineryLife}yr · {profile.profile.description.toLowerCase()}
          </span>
        </Tooltip>
      ) : value.trim() ? (
        <span className="text-xs text-[var(--color-warning)]">not in the guide</span>
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
          <Stat label={tile.label} value={tile.value} />
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
        description="Every register on this engagement — most arrive through the client drop above."
        help="Parsing never guesses: the AI proposes a column mapping and a person confirms it before any assets exist."
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
            // Compact on purpose: the client drop above is the front door, and
            // two hero-sized dropzones ask a first-time user to pick a pipeline.
            // This strip is the shortcut for a file already known to be a register.
            'flex w-full cursor-pointer flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-4 py-2.5 text-xs transition-colors outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
            dragging
              ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-accent)_45%,transparent)] hover:bg-[var(--color-plane)]',
          )}
        >
          <UploadCloud size={14} strokeWidth={1.8} className="text-[var(--color-ink-muted)]" />
          {upload.isPending ? (
            <span>Uploading and reading sheets…</span>
          ) : (
            <>
              <span className="font-medium">
                Already know it&rsquo;s a register? Drop it here to skip triage
              </span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {FAR_UPLOAD_EXTENSIONS.join(' · ')}
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

function AssetsCard({
  detail,
  clientId,
  engagementId,
}: {
  detail: EngagementDetail;
  clientId: string;
  engagementId: string;
}) {
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

  const { data, error, isPending } = useQuery({
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
      meta: {
        help: 'Click a description to open the asset’s full profile — identity, classification, appraisal arithmetic, filings, and history.',
      },
      cell: ({ row }) => (
        <div className="max-w-96">
          <Link
            href={`/clients/${clientId}/engagements/${engagementId}/assets/${row.original.id}`}
            className="block truncate hover:text-[var(--color-accent)] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            title={row.original.description ?? undefined}
          >
            {row.original.description ?? '—'}
          </Link>
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
              <span className="cursor-help text-xs text-[var(--color-warning)]">
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
          maxHeight="max(26rem, calc(100vh - 20rem))"
          pagination={{ offset, limit, total: data?.total ?? detail.stats.assetCount }}
          onOffsetChange={setOffset}
          loading={isPending}
          empty={{ title: 'Nothing matches these filters' }}
        />
      )}
    </Card>
  );
}
