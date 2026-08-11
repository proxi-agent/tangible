'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Play, Sparkles } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { IngestRun, JurisdictionSummary } from '@tangible/types';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Button, Field, TextInput } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/tooltip';
import { useJurisdictions } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count } from '@/lib/format';

const DEFAULT_YEARS = '2021,2022,2023,2024,2025,2026';

export default function DataPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <DataSources />
    </Suspense>
  );
}

function DataSources() {
  const queryClient = useQueryClient();
  const jurisdictions = useJurisdictions();
  const [years, setYears] = useState(DEFAULT_YEARS);

  const runs = useQuery({
    queryKey: ['ingest-runs'],
    queryFn: api.ingestRuns,
    // Poll while anything is mid-flight; a county archive takes minutes.
    refetchInterval: (query) => {
      const data = query.state.data as IngestRun[] | undefined;
      const busy = data?.some((r) => r.status !== 'completed' && r.status !== 'failed');
      return busy ? 2000 : false;
    },
  });

  const startIngest = useMutation({
    mutationFn: (jurisdictionId: string) =>
      api.startIngest({
        jurisdictionId,
        taxYears: years
          .split(',')
          .map((y) => Number(y.trim()))
          .filter(Number.isInteger),
        force: false,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ingest-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jurisdictions'] });
    },
  });

  const seedDemo = useMutation({
    mutationFn: () => api.seedDemo(25_000),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Jurisdictions"
          description="Each connector knows one appraisal district's file layout. Everything downstream is jurisdiction-agnostic, so adding a county is a connector, not a migration."
        />

        <div className="border-b border-[var(--color-hairline)] p-5">
          <div className="max-w-xs">
            <Field
              label="Tax years to download"
              help="A comma-separated list of years. Each one is a separate file from the county, and downloading more of them is what makes the history in this app possible."
            >
              <TextInput
                value={years}
                onChange={(e) => setYears(e.target.value)}
                placeholder={DEFAULT_YEARS}
                className="tabular"
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">
            Multiple years are what make the analysis work — a single year cannot tell a chronic
            non-filer from someone who missed once.
          </p>
        </div>

        {jurisdictions.error ? (
          <ErrorState error={jurisdictions.error} />
        ) : jurisdictions.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ul>
            {jurisdictions.data.map((jurisdiction) => (
              <JurisdictionRow
                key={jurisdiction.id}
                jurisdiction={jurisdiction}
                onIngest={() => startIngest.mutate(jurisdiction.id)}
                isStarting={startIngest.isPending && startIngest.variables === jurisdiction.id}
              />
            ))}
          </ul>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-hairline)] px-5 py-4">
          <div>
            <p className="text-sm font-medium">No data on hand?</p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
              Generate a synthetic county with the same shape as a real roll. Clearly labelled
              throughout — it proves the analysis works, not anything about a real place.
            </p>
          </div>
          <Tooltip
            title="Seed demo county"
            content="Creates 25,000 made-up accounts that behave like a real roll, so every page has something to show. Nothing about a real place — it is labelled synthetic wherever it appears."
          >
            <Button
              variant="secondary"
              onClick={() => seedDemo.mutate()}
              disabled={seedDemo.isPending}
            >
              {seedDemo.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Seed demo county
            </Button>
          </Tooltip>
        </footer>
      </Card>

      <Card>
        <CardHeader
          title="Ingest runs"
          description="Downloads are staged to disk and loaded straight into DuckDB — a county archive never passes through JavaScript."
        />

        {runs.isPending ? (
          <Skeleton className="m-5 h-24" />
        ) : runs.data && runs.data.length > 0 ? (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {runs.data.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <StatusBadge status={run.status} />
                <span className="text-sm font-medium">{run.jurisdictionId}</span>
                <span className="tabular text-xs text-[var(--color-ink-secondary)]">
                  {run.taxYears.join(', ')}
                </span>
                <span className="tabular text-xs text-[var(--color-ink-secondary)]">
                  {count(run.rowsLoaded)} rows
                </span>
                <span className="min-w-0 flex-[1_1_0%] truncate text-xs text-[var(--color-ink-muted)]">
                  {run.error ?? run.message ?? ''}
                </span>
                <time
                  dateTime={run.startedAt}
                  className="tabular text-xs text-[var(--color-ink-muted)]"
                >
                  {new Date(run.startedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-secondary)]">
            No ingest runs yet.
          </p>
        )}
      </Card>
    </div>
  );
}

function JurisdictionRow({
  jurisdiction,
  onIngest,
  isStarting,
}: {
  jurisdiction: JurisdictionSummary;
  onIngest: () => void;
  isStarting: boolean;
}) {
  const isSynthetic = jurisdiction.connectorId === 'fixture';

  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-[var(--color-hairline)] px-5 py-4 last:border-0">
      <div className="min-w-0 flex-[1_1_0%]">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{jurisdiction.name}</h3>
          <Badge>{jurisdiction.cadCode}</Badge>
          {isSynthetic ? <Badge tone="warning">Synthetic</Badge> : null}
          {jurisdiction.accountCount === 0 ? <Badge>No data</Badge> : null}
        </div>
        <p className="tabular mt-1 text-xs text-[var(--color-ink-secondary)]">
          {jurisdiction.accountCount > 0
            ? `${count(jurisdiction.accountCount)} accounts · years ${jurisdiction.availableYears.join(', ')}`
            : 'Nothing loaded yet'}
        </p>
        {jurisdiction.dataPortalUrl ? (
          <a
            href={jurisdiction.dataPortalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-series-1)]"
          >
            Data portal <ExternalLink size={11} />
          </a>
        ) : null}
      </div>

      {isSynthetic ? null : (
        <Tooltip
          title="Download this county"
          content={`Pulls ${jurisdiction.name}'s published files for the years listed above and loads them. A county archive is large, so this takes minutes, and progress appears below.`}
        >
          <Button variant="primary" onClick={onIngest} disabled={isStarting}>
            {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {isStarting ? 'Starting…' : 'Download data'}
          </Button>
        </Tooltip>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: IngestRun['status'] }) {
  const tone =
    status === 'completed' ? 'good' : status === 'failed' ? 'critical' : 'accent';
  return <Badge tone={tone}>{status}</Badge>;
}
