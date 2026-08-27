'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Play, Sparkles } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { IngestRun, JurisdictionSummary } from '@tangible/types';
import {
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { Button, Field, TextInput } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/tooltip';
import { stateName, useJurisdictions } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count } from '@/lib/format';

const DEFAULT_YEARS = '2021,2022,2023,2024,2025,2026';

export default function DataPage() {
  return (
    <Suspense
      // The jurisdictions card over the runs card — the page's settled shape.
      fallback={
        <div className="space-y-4">
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3.5 w-full max-w-lg" />
            </div>
            <div className="space-y-2 px-5 pb-5">
              {[0, 1].map((row) => (
                <Skeleton key={row} className="h-16 w-full" />
              ))}
            </div>
          </Card>
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="px-5 pb-5">
              <Skeleton className="h-24 w-full" />
            </div>
          </Card>
        </div>
      }
    >
      <DataSources />
    </Suspense>
  );
}

function DataSources() {
  const queryClient = useQueryClient();
  const jurisdictions = useJurisdictions();
  const [years, setYears] = useState(DEFAULT_YEARS);
  /**
   * Seventy-one counties in one list runs to eight thousand pixels, and the
   * only order it has is biggest-first inside each state — so finding Tarrant
   * meant scrolling past forty Florida counties, and finding Osceola meant
   * knowing it was small. One box is the whole fix.
   */
  const [find, setFind] = useState('');

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

  // Name or CAD code, because half the reason to come here is to check whether
  // "TAD" has anything in it.
  const needle = find.trim().toLowerCase();
  const matches = (jurisdictions.data ?? []).filter(
    (j) =>
      !needle || j.name.toLowerCase().includes(needle) || j.cadCode.toLowerCase().includes(needle),
  );

  const seedDemo = useMutation({
    mutationFn: () => api.seedDemo(25_000),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data sources"
        description="Where the county files come from and what has been loaded. Each connector knows one appraisal district's file layout, so adding a county means writing a connector for its published files — not migrating the warehouse."
      />

      <Card>
        <CardHeader
          title="Jurisdictions"
          help="Everything downstream of ingest is jurisdiction-agnostic: a county that loads here behaves like every other county on every other screen."
        />

        <div className="border-b border-[var(--color-hairline)] p-5">
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <div>
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
              {/* Kept inside the years column. Spanning the row under both
                  boxes, it read as a note about the search beside it. */}
              <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">
                Multiple years are what make the analysis work — a single year cannot tell a chronic
                non-filer from someone who missed once.
              </p>
            </div>
            <Field
              label="Find a county"
              help="Matches the county name or its appraisal-district code. Narrows the list below only — it changes nothing about what a download would fetch."
            >
              <TextInput
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="e.g. tarrant, or TAD"
              />
            </Field>
          </div>
        </div>

        {jurisdictions.error ? (
          <ErrorState error={jurisdictions.error} />
        ) : jurisdictions.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : /* Grouped by state, because the flat list had nowhere to read one
             off: a row carries a county and a CAD code, and only the code
             hints at which state it is in. Thirty-odd counties down a page
             that way is a list you scan rather than one you navigate. */
        matches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-secondary)]">
            No county here matches “{find}”. A county missing from this list is missing because
            nobody has written a connector for it — the coverage guide in the header says which
            states publish the file at all.
          </p>
        ) : (
          byState(matches).map(([state, group]) => (
            <section key={state}>
              <h3 className="eyebrow border-b border-[var(--color-hairline)] bg-[var(--color-sunken)] px-5 py-2">
                {stateName(state)} · {group.length === 1 ? '1 county' : `${group.length} counties`}
              </h3>
              <ul>
                {group.map((jurisdiction) => (
                  <JurisdictionRow
                    key={jurisdiction.id}
                    jurisdiction={jurisdiction}
                    onIngest={() => startIngest.mutate(jurisdiction.id)}
                    isStarting={startIngest.isPending && startIngest.variables === jurisdiction.id}
                  />
                ))}
              </ul>
            </section>
          ))
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
        ) : runs.error ? (
          // An outage is not an empty history — without this branch a 503
          // fell through to "No ingest runs yet", which reads as data loss.
          <ErrorState error={runs.error} />
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

/**
 * The counties grouped by state, in the order the list already had them.
 *
 * Not alphabetically: the list arrives biggest county first, so first
 * appearance puts the state with the most to work with at the top. Sorting the
 * groups by name instead buried Texas — the only state here with years of
 * history — under sixty-seven Florida counties holding one year each.
 */
function byState(jurisdictions: readonly JurisdictionSummary[]): [string, JurisdictionSummary[]][] {
  const groups = new Map<string, JurisdictionSummary[]>();
  for (const jurisdiction of jurisdictions) {
    const group = groups.get(jurisdiction.state);
    if (group) group.push(jurisdiction);
    else groups.set(jurisdiction.state, [jurisdiction]);
  }
  return [...groups];
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
            // Standalone rather than inside a sentence, so it owes a real touch
            // target: 20px of text grows into 32px of box on a coarse pointer.
            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] pointer-coarse:min-h-8"
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
          {/* Secondary, not primary. Every row on this list carries the same
              action, and twenty saturated blue blocks down a page make a wall
              the eye cannot read the county names through — none of them is
              "the" action, so none of them should wear the accent. */}
          <Button variant="secondary" onClick={onIngest} disabled={isStarting}>
            {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {isStarting ? 'Starting…' : 'Download data'}
          </Button>
        </Tooltip>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: IngestRun['status'] }) {
  const tone = status === 'completed' ? 'good' : status === 'failed' ? 'critical' : 'accent';
  return <Badge tone={tone}>{status}</Badge>;
}
