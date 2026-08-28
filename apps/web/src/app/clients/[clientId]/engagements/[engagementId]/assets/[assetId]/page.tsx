'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { AssetAppraisalState, AssetEvent, AssetProfile } from '@tangible/types';
import { api } from '@/lib/api';
import { moneyExact, percent } from '@/lib/format';
import {
  Badge,
  BackLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat as SharedStat,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { InfoTip } from '@/components/ui/tooltip';

/** How the import matcher recognized this row, said as a person would. */
const MATCH_METHOD_LABEL: Record<string, string> = {
  'asset-tag': 'matched by asset tag',
  fingerprint: 'matched by fingerprint',
  'fingerprint-ordinal': 'matched by fingerprint and position',
  new: 'first seen in the latest import',
};

const MATCH_METHOD_WHY: Record<string, string> = {
  'asset-tag':
    'The register carries a stable asset tag, so re-imports recognize this row by the tag alone — the strongest identity a register can give.',
  fingerprint:
    'No stable tag, so identity is a fingerprint of the fields that rarely change: description, cost, and acquisition date. Unique in this register, so the match is unambiguous.',
  'fingerprint-ordinal':
    'Several rows share the same fingerprint — identical descriptions and costs — so identity falls back to position among the duplicates. The weakest match: a reordered register could swap two twins.',
  new: 'No earlier import had a row this one could be matched to, so a fresh durable asset was created for it.',
};

/** "Mar 4, 2026" — timestamps on this page are moments, not statutory dates. */
function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AssetProfilePage() {
  const { clientId, engagementId, assetId } = useParams<{
    clientId: string;
    engagementId: string;
    assetId: string;
  }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['asset-profile', engagementId, assetId],
    queryFn: () => api.assetProfile(engagementId, assetId),
  });

  const backHref = `/clients/${clientId}/engagements/${engagementId}?tab=assets`;

  if (error) return <ErrorState error={error} />;
  // Back link, hero block, then the card stack it becomes.
  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-3.5 w-full max-w-lg" />
        </div>
        <Card>
          <div className="space-y-3 p-5">
            <Skeleton className="h-4 w-44" />
            <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((card) => (
            <Card key={card}>
              <div className="space-y-2 p-5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-full max-w-sm" />
                <Skeleton className="h-3.5 w-56" />
              </div>
            </Card>
          ))}
        </div>
        <Card>
          <div className="space-y-2 p-5">
            <Skeleton className="h-4 w-48" />
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full max-w-md" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeroCard profile={data} back={<BackLink href={backHref}>Back to the register</BackLink>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ClassificationCard profile={data} />
        <PlacementCard profile={data} />
      </div>

      <AppraisalCard profile={data} />

      <div className="grid gap-5 lg:grid-cols-2">
        <FilingsCard profile={data} />
        <FindingsCard profile={data} />
      </div>

      {data.evidence ? <EvidenceCard evidence={data.evidence} /> : null}

      <HistoryCard events={data.events} />
      <VersionsCard profile={data} />
      <RawCard raw={data.raw} sheet={data.asset.sourceSheet} row={data.asset.sourceRow} />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <SharedStat label={label} value={children} size="sm" />;
}

function dash(value: string | number | null | undefined): ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function HeroCard({ profile, back }: { profile: AssetProfile; back: ReactNode }) {
  const { asset } = profile;
  const methodLabel = MATCH_METHOD_LABEL[profile.matchMethod] ?? profile.matchMethod;
  const methodWhy = MATCH_METHOD_WHY[profile.matchMethod];

  return (
    <>
      {/* The asset's name is the page's name, at page level like every other
          screen's — it had been the first line inside the first card, which
          made the page open on a card rather than on a title, and put the back
          link and the heading in two different places. */}
      <PageHeader
        back={back}
        title={asset.description ?? 'Untitled asset'}
        meta={
          <>
            {asset.isDisposed ? <Badge tone="critical">Disposed</Badge> : null}
            {profile.isAbsent ? (
              <Badge tone="warning">
                Not in latest import
                <InfoTip
                  content="Present in an earlier register, missing from the newest one. Absence is not a disposal — the client may simply have exported a narrower file — so it stays on the books until someone says otherwise."
                  size={12}
                  className="ml-1 align-text-bottom"
                />
              </Badge>
            ) : null}
          </>
        }
        description={
          <>
            {asset.assetTag ? <>Tag {asset.assetTag} · </> : null}
            {methodLabel}
            {methodWhy ? (
              <InfoTip content={methodWhy} size={12} className="ml-1 align-text-bottom" />
            ) : null}
            {/* When it arrived, not which file it arrived in. The file names
                had been printed here in full — twice, since a re-import of the
                same workbook still counts as a later batch — which wrapped the
                title's subtitle onto three lines to say something the
                Snapshots card below already says per import, with the exact
                file beside each one. */}
            {profile.firstSeen?.appliedAt ? (
              <> · on the register since {when(profile.firstSeen.appliedAt)}</>
            ) : null}
            {profile.lastSeen?.appliedAt &&
            profile.lastSeen.batchId !== profile.firstSeen?.batchId &&
            // A re-import on the same day is a second batch but not a second
            // date, and printing it says "since 20 Aug, last read 20 Aug".
            when(profile.lastSeen.appliedAt) !== when(profile.firstSeen?.appliedAt ?? '') ? (
              <>, last read {when(profile.lastSeen.appliedAt)}</>
            ) : null}
          </>
        }
      />
      <RegisterCard asset={asset} />
    </>
  );
}

/**
 * The register row, with the blanks moved out of the way.
 *
 * Sixteen fields in a fixed grid meant a page that opened on twelve em-dashes:
 * a register that carries a cost, a date and a location was rendered as a wall
 * of nothing with four facts hidden in it. What the client left blank is still
 * worth knowing — it is why half this page has to be inferred — so it is named
 * in full underneath rather than dropped. It is just no longer the first thing
 * the eye lands on.
 */
function RegisterCard({ asset }: { asset: AssetProfile['asset'] }) {
  const fields: { label: string; value: string }[] = [
    { label: 'Original cost', value: moneyExact(asset.originalCost) },
    { label: 'Accum. depreciation', value: moneyExact(asset.accumulatedDepreciation) },
    { label: 'Net book value', value: moneyExact(asset.netBookValue) },
    { label: 'Acquired', value: asset.acquisitionDate ?? String(dash(asset.acquisitionYear)) },
    { label: 'In service', value: String(dash(asset.inServiceDate)) },
    { label: 'Register category', value: String(dash(asset.category)) },
    { label: 'GL account', value: String(dash(asset.glAccount)) },
    { label: 'Quantity', value: String(dash(asset.quantity)) },
    { label: 'Serial number', value: String(dash(asset.serialNumber)) },
    { label: 'Entity', value: String(dash(asset.entity)) },
    { label: 'Department', value: String(dash(asset.department)) },
    { label: 'Vendor', value: String(dash(asset.vendor)) },
    { label: 'Useful life', value: String(dash(asset.usefulLife)) },
    { label: 'Depreciation method', value: String(dash(asset.depreciationMethod)) },
    { label: 'Register location', value: String(dash(asset.location)) },
    { label: 'Disposal date', value: String(dash(asset.disposalDate)) },
  ];
  const carried = fields.filter((field) => field.value !== '—');
  const blank = fields.filter((field) => field.value === '—');

  return (
    <Card>
      <CardHeader
        title="What the register says"
        description="The row as the client's own fixed asset register carries it."
      />
      {carried.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 sm:grid-cols-4">
          {carried.map((field) => (
            <Stat key={field.label} label={field.label}>
              {field.value}
            </Stat>
          ))}
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-[var(--color-ink-secondary)]">
          The register carries nothing on this row but a description.
        </p>
      )}
      {blank.length > 0 ? (
        <p className="border-t border-[var(--color-hairline)] px-5 py-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          <span className="font-medium">Left blank in the register:</span>{' '}
          {blank.map((field) => field.label.toLowerCase()).join(', ')}.
        </p>
      ) : null}
    </Card>
  );
}

const CLASSIFICATION_SOURCE_LABEL: Record<string, string> = {
  memory: 'remembered from an earlier confirmed answer',
  ai: 'decided by the model',
  human: 'decided by a person here',
};

function ClassificationCard({ profile }: { profile: AssetProfile }) {
  const c = profile.classification;
  return (
    <Card>
      <CardHeader
        title="Classification"
        description="What kind of property this is, and which authority decided."
        help="The category picks the depreciation schedule the district applies, so the decision — and who made it — is the foundation every value on this page stands on."
      />
      {!c ? (
        <EmptyState title="Not yet classified">
          Run classification from the register to give this asset a category.
        </EmptyState>
      ) : (
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{c.label ?? 'No category'}</span>
            <Badge
              tone={
                c.status === 'confirmed'
                  ? 'good'
                  : c.status === 'needs-review'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {c.status === 'auto-accepted' ? 'Auto-accepted' : null}
              {c.status === 'needs-review' ? 'Needs review' : null}
              {c.status === 'confirmed' ? 'Confirmed' : null}
            </Badge>
            <span className="text-xs text-[var(--color-ink-secondary)] tabular-nums">
              {percent(c.confidence, 0)} confident
            </span>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {CLASSIFICATION_SOURCE_LABEL[c.source] ?? c.source}
            {c.model ? ` (${c.model})` : ''}
            {c.reviewedBy && c.reviewedAt
              ? ` · reviewed by ${c.reviewedBy} on ${when(c.reviewedAt)}`
              : ''}
            {c.lifeClassOverride ? ` · life overridden to ${c.lifeClassOverride} years` : ''}
          </p>
          {c.rationale ? (
            <p className="rounded border border-[var(--color-hairline)] bg-[var(--color-plane)] px-3 py-2 text-xs leading-relaxed">
              {c.rationale}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function PlacementCard({ profile }: { profile: AssetProfile }) {
  const p = profile.placement;
  return (
    <Card>
      <CardHeader
        title="Placement"
        description="The site this asset renders from, once an operator has placed it."
        help="Renditions file per account, and the account belongs to the site — so where an asset sits decides which sworn document it appears on and which district's schedule values it."
      />
      {!p ? (
        <EmptyState title="Not placed at a site">
          Place it from the Sites tab; until then it renders with the engagement's default
          jurisdiction.
        </EmptyState>
      ) : (
        <div className="space-y-3 p-5">
          <div className="text-sm font-medium">{p.label}</div>
          <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {[p.addressLine1, p.city, p.stateCode].filter(Boolean).join(', ') ||
              'No address on file'}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Appraisal district">{dash(p.jurisdictionName ?? p.jurisdictionId)}</Stat>
            <Stat label="Account">{dash(p.accountId)}</Stat>
          </div>
        </div>
      )}
    </Card>
  );
}

/** One step of the district's arithmetic, shown as the calc guide prints it. */
function CalcStep({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <div className="text-xs text-[var(--color-ink-secondary)]">
        {label}
        {note ? <span className="ml-1.5 text-xs opacity-80">{note}</span> : null}
      </div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

const APPRAISAL_STATE_COPY: Partial<
  Record<AssetAppraisalState['state'], { title: string; body: string }>
> = {
  disposed: {
    title: 'Not appraised — disposed',
    body: 'Disposed assets carry no value into the rendition; the disposal itself is what the return reports.',
  },
  unclassified: {
    title: 'Not appraised — unclassified',
    body: 'No category yet, so no schedule applies. Run classification to value this asset.',
  },
  'needs-review': {
    title: 'Not appraised — awaiting review',
    body: 'The classification is not yet trusted, so the appraisal holds until a person confirms or corrects it.',
  },
};

function AppraisalCard({ profile }: { profile: AssetProfile }) {
  const a = profile.appraisal;
  return (
    <Card>
      <CardHeader
        title="This season's appraisal"
        description="The district's own arithmetic applied to this asset, step by step."
        help="Cost times the index factor rebuilds replacement cost new; percent good depreciates it to market value. The same tables HCAD's calc guide publishes — so the number here is the number the district would compute."
      />
      {a.state === 'valued' ? (
        <>
          <div className="divide-y divide-[var(--color-hairline)]">
            <CalcStep label="Original cost" value={moneyExact(profile.asset.originalCost)} />
            <CalcStep
              label="× Index factor"
              note={`acquired ${profile.asset.acquisitionYear ?? '—'}`}
              value={a.indexFactor.toFixed(2)}
            />
            <CalcStep label="= Replacement cost new" value={moneyExact(a.replacementCostNew)} />
            <CalcStep
              label="× Percent good"
              note={
                typeof a.schedule === 'number'
                  ? `${a.schedule}-year life, from ${
                      a.lifeSource === 'override'
                        ? 'a per-asset override'
                        : a.lifeSource === 'sic'
                          ? `SIC ${a.sic?.code ?? ''}`.trim()
                          : 'the category default'
                    }`
                  : `${a.schedule} schedule`
              }
              value={`${a.percentGood}%`}
            />
            <CalcStep
              label="= Market value"
              note={a.atFloor ? 'held at the schedule floor' : undefined}
              value={moneyExact(a.marketValue)}
            />
            <CalcStep
              label={`× Blended rate (${percent(a.taxRate, 2)})`}
              value={moneyExact(a.estimatedTax)}
              note="estimated annual tax, not the bill"
            />
          </div>
          {a.sic ? (
            <p className="border-t border-[var(--color-hairline)] px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
              Business SIC {a.sic.code} — {a.sic.description} (default life {a.sic.life} years).
            </p>
          ) : null}
        </>
      ) : a.state === 'excluded' ? (
        <EmptyState title={`Not taxable — ${a.label}`}>
          This category is excluded from the rendition, so it carries no appraised value.
        </EmptyState>
      ) : a.state === 'no-schedule' ? (
        <EmptyState title="No schedule to apply">{a.detail}</EmptyState>
      ) : a.state === 'gap' ? (
        <EmptyState title="Cannot be valued yet">{a.detail}</EmptyState>
      ) : (
        <EmptyState title={APPRAISAL_STATE_COPY[a.state]?.title ?? 'Not appraised'}>
          {APPRAISAL_STATE_COPY[a.state]?.body}
        </EmptyState>
      )}
    </Card>
  );
}

function FilingsCard({ profile }: { profile: AssetProfile }) {
  return (
    <Card>
      <CardHeader
        title="On the return"
        description="Every filed rendition that carried this asset."
        help="Read off the filing record's own frozen asset list, not reconstructed — so this stays true even after the register changes."
      />
      {profile.filings.length === 0 ? (
        <EmptyState title="Not on any filed return">
          It appears here once a rendition that includes it is recorded as filed.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {profile.filings.map((f) => (
            <li key={f.filingId} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {f.taxYear} · {f.locationLabel}
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
                  {f.jurisdictionName ?? f.jurisdictionId ?? 'No district'} · recorded{' '}
                  {when(f.recordedAt)} · schedule total {moneyExact(f.scheduleValue)}
                </div>
              </div>
              <Badge
                tone={f.status === 'filed' ? 'good' : f.status === 'void' ? 'critical' : 'neutral'}
              >
                {f.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FindingsCard({ profile }: { profile: AssetProfile }) {
  return (
    <Card>
      <CardHeader
        title="Findings naming this asset"
        description="Committed findings whose evidence points at this row."
        help="Drawn from each analysis's latest committed set — the versions the findings tab is actually working, not every run ever made."
      />
      {profile.findings.length === 0 ? (
        <EmptyState title="No findings name this asset">
          Nothing committed by the diagnostics singles this row out.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {profile.findings.map((f) => (
            <li key={`${f.setId}-${f.key}`} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{f.title}</span>
                <Badge
                  tone={f.kind === 'saving' ? 'good' : f.kind === 'risk' ? 'warning' : 'neutral'}
                >
                  {f.kind}
                </Badge>
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
                {f.source} · committed {when(f.committedAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * What the systems outside the register say about this one asset.
 *
 * Three lists, and keeping them apart is the whole design. A match is a system
 * saying it has this asset. A negative is a system that covers this kind of
 * property saying it does not — which is evidence, and is what a ghost finding
 * rests on. Silence is a system that was never going to know either way, and it
 * appears here for exactly one reason: so an empty row is not read as a search
 * that came back empty. The card is absent entirely when nothing has been
 * imported, because "no evidence" and "no sources" are different claims.
 */
function EvidenceCard({ evidence }: { evidence: NonNullable<AssetProfile['evidence']> }) {
  return (
    <Card>
      <CardHeader
        title="Outside the register"
        description="What the client's other systems have to say about this asset."
        help="Each source is authoritative over its own slice of the register and silent everywhere else. A maintenance system with no work order against a chiller is evidence the chiller is gone; the same system saying nothing about a desk is evidence of nothing, because desks were never in its scope."
      />
      <div className="divide-y divide-[var(--color-hairline)]">
        {evidence.matches.map((match) => (
          <div key={`${match.source}-${match.on}`} className="space-y-1 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="good">found</Badge>
              <span className="text-sm font-medium">{match.sourceLabel}</span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                matched on {match.method} · {percent(match.score)} confident
                {match.lastSeenOn ? ` · last seen ${match.lastSeenOn}` : ''}
              </span>
            </div>
            <p className="text-sm text-[var(--color-ink-secondary)]">{match.affirms}</p>
            {match.filename ? (
              <p className="text-xs text-[var(--color-ink-muted)]">{match.filename}</p>
            ) : null}
          </div>
        ))}
        {evidence.negatives.map((negative) => (
          <div key={negative.source} className="space-y-1 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">searched, not found</Badge>
              <span className="text-sm font-medium">{negative.sourceLabel}</span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {negative.searched.toLocaleString()} records searched
              </span>
            </div>
            <p className="text-sm text-[var(--color-ink-secondary)]">{negative.statement}</p>
          </div>
        ))}
        {evidence.silent.map((silent) => (
          <div key={silent.source} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">not in scope</Badge>
              <span className="text-xs text-[var(--color-ink-muted)]">{silent.note}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HistoryCard({ events }: { events: AssetEvent[] }) {
  const [showRoutine, setShowRoutine] = useState(false);
  const routineCount = events.filter((e) => e.significance === 'routine').length;
  const shown = showRoutine ? events : events.filter((e) => e.significance === 'material');

  return (
    <Card>
      <CardHeader
        title="History"
        description="Everything the imports have recorded about this asset, newest first."
        help="Material events are the ones that change what the return says — cost moves, disposals, reclassifications. Routine ones are bookkeeping drift like another year of book depreciation."
        action={
          routineCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setShowRoutine((v) => !v)}>
              {showRoutine ? 'Hide' : 'Show'} {routineCount} routine
            </Button>
          ) : undefined
        }
      />
      {shown.length === 0 ? (
        <EmptyState title="No material changes yet">
          {routineCount > 0
            ? 'Only routine bookkeeping drift has been recorded.'
            : 'Its history starts with the next import that touches it.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm">{e.summary}</div>
                <div className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
                  {when(e.occurredAt)}
                  {e.actor ? ` · ${e.actor}` : ''}
                </div>
              </div>
              {e.significance === 'material' ? (
                <Badge tone="accent">material</Badge>
              ) : (
                <Badge tone="neutral">routine</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function VersionsCard({ profile }: { profile: AssetProfile }) {
  return (
    <Card>
      <CardHeader
        title="Snapshots"
        description="This asset as each confirmed import read it."
        help="One row per import batch that carried it. The current row is what the engagement works from; older rows are the audit trail a value dispute reaches back into."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-2xs border-b border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
              <th className="px-5 py-2.5">Import</th>
              <th className="px-3 py-2.5">Cell</th>
              <th className="px-3 py-2.5 text-right">Cost</th>
              <th className="px-3 py-2.5 text-right">Accum. dep.</th>
              <th className="px-3 py-2.5 text-right">NBV</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-5 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-hairline)]">
            {profile.versions.map((v) => (
              <tr key={v.versionId} className={v.isCurrent ? 'bg-[var(--color-plane)]' : undefined}>
                <td className="max-w-56 truncate px-5 py-2.5" title={v.fileName ?? v.batchId}>
                  {v.fileName ?? 'Unnamed import'}
                  <span className="ml-1.5 text-xs text-[var(--color-ink-secondary)]">
                    {when(v.createdAt)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap text-[var(--color-ink-secondary)]">
                  {v.sourceSheet} · row {v.sourceRow + 1}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyExact(v.originalCost)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyExact(v.accumulatedDepreciation)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyExact(v.netBookValue)}
                </td>
                <td className="max-w-40 truncate px-3 py-2.5">{dash(v.category)}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">
                  {v.isCurrent ? (
                    <Badge tone="accent">current</Badge>
                  ) : v.batchStatus === 'superseded' ? (
                    <Badge tone="neutral">superseded</Badge>
                  ) : (
                    <Badge tone="neutral">{v.isDisposed ? 'disposed' : v.batchStatus}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RawCard({
  raw,
  sheet,
  row,
}: {
  raw: Record<string, unknown> | null;
  sheet: string;
  row: number;
}) {
  const entries = raw ? Object.entries(raw).filter(([, v]) => v !== null && v !== '') : [];
  if (entries.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Source cells"
        description={`The row exactly as the client's file spelled it — ${sheet}, row ${row + 1}.`}
        help="Every canonical field above was mapped from these cells. When a number looks wrong, this is where to check whether the file said it or the mapping did."
      />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-3 border-b border-dotted border-[var(--color-hairline)] pb-1"
          >
            <dt className="truncate text-xs text-[var(--color-ink-secondary)]" title={key}>
              {/^\d+$/.test(key) ? `Column ${Number(key) + 1}` : key}
            </dt>
            <dd className="truncate text-xs tabular-nums" title={String(value)}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
