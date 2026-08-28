'use client';

import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { FindingRowFacets, FindingRowFilters } from '@tangible/types';
import { count, money } from '@/lib/format';
import { Button, ChipGroup, TextInput, type ChipOption } from '@/components/ui/controls';

/**
 * The nine filters, over one finding.
 *
 * Every option here is drawn from the finding's own population — the sites that
 * actually appear on these rows, the cost centres the register actually
 * carries — so nothing on the bar can select nothing. And the facets come from
 * the whole finding rather than the current selection, which is why narrowing
 * to Houston does not make Dallas vanish from the bar.
 *
 * The counts beside each option are the population's, not the filtered set's.
 * They answer "how much is behind this option" rather than "how much would
 * survive if I ticked it as well", and the first is the question somebody
 * setting a filter is actually asking.
 */

export const EMPTY_FILTERS: FindingRowFilters = {
  confidence: [],
  locations: [],
  costCenters: [],
  categories: [],
  acquiredFrom: null,
  acquiredTo: null,
  costMin: null,
  costMax: null,
  evidence: 'any',
  dispositions: [],
  reviewers: [],
  query: '',
};

export function isFiltered(filters: FindingRowFilters): boolean {
  return (
    filters.confidence.length > 0 ||
    filters.locations.length > 0 ||
    filters.costCenters.length > 0 ||
    filters.categories.length > 0 ||
    filters.acquiredFrom !== null ||
    filters.acquiredTo !== null ||
    filters.costMin !== null ||
    filters.costMax !== null ||
    filters.evidence !== 'any' ||
    filters.dispositions.length > 0 ||
    filters.reviewers.length > 0 ||
    filters.query.trim() !== ''
  );
}

type Setter = (next: FindingRowFilters) => void;

export function FindingFilters({
  facets,
  filters,
  onChange,
}: {
  facets: FindingRowFacets;
  filters: FindingRowFilters;
  onChange: Setter;
}) {
  const set = <K extends keyof FindingRowFilters>(key: K, value: FindingRowFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const toggle = <
    K extends
      'confidence' | 'locations' | 'costCenters' | 'categories' | 'dispositions' | 'reviewers',
  >(
    key: K,
    value: string,
  ) => {
    const held = filters[key] as string[];
    const next = held.includes(value) ? held.filter((v) => v !== value) : [...held, value];
    onChange({ ...filters, [key]: next } as FindingRowFilters);
  };

  const confidenceOptions: ChipOption<'high' | 'medium' | 'low'>[] = [
    {
      value: 'high',
      label: `High · ${count(facets.confidence.high)}`,
      description: 'Everything the register said pointed the same way.',
      caveat: 'Still worth a look. High is a strong reading of your data, not a certainty.',
    },
    {
      value: 'medium',
      label: `Medium · ${count(facets.confidence.medium)}`,
      description: 'The signals mostly agree, with something missing or pulling the other way.',
    },
    {
      value: 'low',
      label: `Low · ${count(facets.confidence.low)}`,
      description: 'A lead rather than a position — usually because the register is thin here.',
      caveat: 'These are the rows most likely to need something only you can tell us.',
    },
  ];

  const dispositionOptions: ChipOption<'accepted' | 'rejected' | 'pending-client' | 'undecided'>[] =
    [
      {
        value: 'undecided',
        label: `Not decided · ${count(facets.dispositions.undecided)}`,
        description: 'Rows nobody has answered yet — the working queue.',
      },
      {
        value: 'accepted',
        label: `Accepted · ${count(facets.dispositions.accepted)}`,
        description: 'You agreed this comes off the return.',
      },
      {
        value: 'rejected',
        label: `Rejected · ${count(facets.dispositions.rejected)}`,
        description: 'You said no. It stays on the return.',
      },
      {
        value: 'pending-client',
        label: `Need info · ${count(facets.dispositions['pending-client'])}`,
        description: 'Parked until somebody checks something.',
      },
    ];

  const evidenceOptions: ChipOption<'present' | 'absent'>[] = [
    {
      value: 'present',
      label: 'Has something to check',
      description:
        'The register line carries a serial number, a vendor, a GL account or a disposal date — something you can tie to a document.',
    },
    {
      value: 'absent',
      label: 'Nothing to check',
      description: 'A description and a cost, and nothing else to corroborate it.',
    },
  ];

  const locationOptions = useMemo<ChipOption<string>[]>(
    () =>
      facets.locations.map((location) => ({
        value: location.id,
        label: `${location.label} · ${count(location.count)}`,
        description:
          location.id === 'unplaced'
            ? 'Rows we have not been able to put at one of your sites yet.'
            : undefined,
      })),
    [facets.locations],
  );

  const categoryOptions = useMemo<ChipOption<string>[]>(
    () =>
      facets.categories.map((category) => ({
        value: category.key,
        label: `${category.label} · ${count(category.count)}`,
      })),
    [facets.categories],
  );

  const costCenterOptions = useMemo<ChipOption<string>[]>(
    () =>
      facets.costCenters.map((centre) => ({
        value: centre.value,
        label: `${centre.value} · ${count(centre.count)}`,
      })),
    [facets.costCenters],
  );

  const reviewerOptions = useMemo<ChipOption<string>[]>(
    () =>
      facets.reviewers.map((reviewer) => ({
        value: reviewer.value,
        label: `${reviewer.value} · ${count(reviewer.count)}`,
      })),
    [facets.reviewers],
  );

  return (
    <div className="space-y-4 px-5 py-4">
      <Row label="Confidence">
        <ChipGroup
          options={confidenceOptions}
          selected={filters.confidence}
          onToggle={(v) => toggle('confidence', v)}
        />
      </Row>

      <Row label="Decision">
        <ChipGroup
          options={dispositionOptions}
          selected={filters.dispositions}
          onToggle={(v) => toggle('dispositions', v)}
        />
      </Row>

      {locationOptions.length > 1 ? (
        <Row label="Location">
          <ChipGroup
            options={locationOptions}
            selected={filters.locations}
            onToggle={(v) => toggle('locations', v)}
          />
        </Row>
      ) : null}

      {categoryOptions.length > 1 ? (
        <Row label="Asset class">
          <ChipGroup
            options={categoryOptions}
            selected={filters.categories}
            onToggle={(v) => toggle('categories', v)}
          />
        </Row>
      ) : null}

      {/* Both of these exist only when the register carried the column. A bar
          offering "Cost centre" over a register with no departments in it is a
          filter that can never do anything. */}
      {costCenterOptions.length > 1 ? (
        <Row label="Cost centre">
          <ChipGroup
            options={costCenterOptions}
            selected={filters.costCenters}
            onToggle={(v) => toggle('costCenters', v)}
          />
        </Row>
      ) : null}

      {reviewerOptions.length > 1 ? (
        <Row label="Decided by">
          <ChipGroup
            options={reviewerOptions}
            selected={filters.reviewers}
            onToggle={(v) => toggle('reviewers', v)}
          />
        </Row>
      ) : null}

      <Row label="Evidence">
        <ChipGroup
          options={evidenceOptions}
          selected={filters.evidence === 'any' ? [] : [filters.evidence]}
          // Single-choice by way of a chip group: ticking the other one
          // replaces rather than adds, because "has something" and "has
          // nothing" together select everything and would read as a bug.
          onToggle={(value) => set('evidence', filters.evidence === value ? 'any' : value)}
        />
      </Row>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Range
          label="Original cost"
          hint={facets.cost ? `${money(facets.cost.min)} – ${money(facets.cost.max)}` : null}
          from={filters.costMin}
          to={filters.costMax}
          onFrom={(v) => set('costMin', v)}
          onTo={(v) => set('costMax', v)}
        />
        <Range
          label="Acquired"
          hint={facets.acquired ? `${facets.acquired.min} – ${facets.acquired.max}` : null}
          from={filters.acquiredFrom}
          to={filters.acquiredTo}
          onFrom={(v) => set('acquiredFrom', v)}
          onTo={(v) => set('acquiredTo', v)}
          width="w-20"
        />
        <div>
          <p className="eyebrow mb-1.5">Search</p>
          <TextInput
            compact
            value={filters.query}
            placeholder="Tag, description or year"
            onChange={(event) => set('query', event.target.value)}
            className="w-56"
          />
        </div>
        {isFiltered(filters) ? (
          <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            <X size={13} className="mr-1" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <p className="eyebrow w-24 shrink-0">{label}</p>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Range({
  label,
  hint,
  from,
  to,
  onFrom,
  onTo,
  width = 'w-28',
}: {
  label: string;
  hint: string | null;
  from: number | null;
  to: number | null;
  onFrom: (value: number | null) => void;
  onTo: (value: number | null) => void;
  width?: string;
}) {
  // A blank box means "no bound", not zero — typing over a number and deleting
  // it has to widen the filter rather than clamp it to nothing.
  const read = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return (
    <div>
      <p className="eyebrow mb-1.5">
        {label}
        {hint ? <span className="ml-2 normal-case opacity-70">{hint}</span> : null}
      </p>
      <div className="flex items-center gap-1.5">
        <TextInput
          compact
          inputMode="numeric"
          value={from === null ? '' : String(from)}
          placeholder="From"
          onChange={(event) => onFrom(read(event.target.value))}
          className={width}
        />
        <span className="text-xs text-[var(--color-ink-muted)]">to</span>
        <TextInput
          compact
          inputMode="numeric"
          value={to === null ? '' : String(to)}
          placeholder="To"
          onChange={(event) => onTo(read(event.target.value))}
          className={width}
        />
      </div>
    </div>
  );
}
