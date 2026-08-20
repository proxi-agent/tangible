import type { AssetDraft } from '@tangible/far';
import {
  significanceOf,
  TRACKED_ASSET_FIELDS,
  type AssetEventKind,
  type ChangeSignificance,
  type TrackedAssetField,
} from '@tangible/types';
import { keyDrafts, matchMethodFor, type KeyedDraft } from './identity.js';

/**
 * Compare an upload against what the client's graph already holds.
 *
 * Pure: prior state and drafts in, a plan out. No database, no clock, no ids
 * minted here — the caller supplies `occurredAt` and assigns identifiers when it
 * writes. That is the same discipline the savings engine runs on, and for the
 * same reason: this decides what an asset's history says, and a history has to
 * be reproducible from its inputs and testable without standing anything up.
 *
 * The one judgement worth arguing with is what an *absence* means, and the
 * answer here is: nothing, on its own. A row that was in last year's register
 * and is not in this year's might be an asset that was scrapped without an
 * entry — the ghost-asset case in reverse, and worth real money. It might
 * equally be an export someone ran with a filter on, or a divested site whose
 * rows were dropped, or a register rebuilt in a new system. Those are
 * indistinguishable from the file, so the event says `absent` and stops there.
 * Calling it a disposal would put a number on a guess, and putting numbers on
 * guesses is the failure mode this whole product is built against.
 */

/** What the graph already knows about one asset, as the caller loads it. */
export interface PriorAsset {
  id: string;
  naturalKey: string;
  ordinal: number;
  isAbsent: boolean;
  isDisposed: boolean;
  /** The current version's tracked field values. */
  values: Partial<Record<TrackedAssetField, unknown>>;
}

export interface AssetEventDraft {
  /** Null for a discovery, where the caller mints the id as it inserts. */
  assetId: string | null;
  /** Set instead of assetId when the event belongs to a newly discovered asset. */
  draftIndex: number | null;
  kind: AssetEventKind;
  field: TrackedAssetField | null;
  previousValue: string | null;
  value: string | null;
  significance: ChangeSignificance;
  summary: string;
}

export interface Resolution {
  /** Index into the drafts array this resolution is for. */
  draftIndex: number;
  draft: AssetDraft;
  naturalKey: string;
  ordinal: number;
  matchMethod: string;
  /** Null when this row is a newly discovered asset. */
  assetId: string | null;
}

export interface ReconcilePlan {
  resolutions: Resolution[];
  /** Assets the graph holds that this upload did not mention. */
  absent: PriorAsset[];
  events: AssetEventDraft[];
  counts: {
    total: number;
    new: number;
    matched: number;
    absent: number;
    changed: number;
  };
}

export interface ReconcileInput {
  priorAssets: readonly PriorAsset[];
  drafts: readonly AssetDraft[];
}

/**
 * Render a value for the event log.
 *
 * Stored as text on purpose. The column has to hold a cost, a date, a
 * description and a GL account, and a reviewer reads them all the same way. `—`
 * rather than an empty string for a missing value, so "went from nothing to
 * $4,000" and "went from an empty string to $4,000" do not look identical in the
 * history.
 */
function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Whether two readings of the same field disagree.
 *
 * Money is compared at cents. A register re-exported from the same system
 * routinely returns 1200 as 1199.9999999998, and an event log that reports that
 * as a cost change is a log people learn to ignore.
 */
const MONEY_FIELDS = new Set<TrackedAssetField>([
  'originalCost',
  'accumulatedDepreciation',
  'netBookValue',
]);

function differs(field: TrackedAssetField, before: unknown, after: unknown): boolean {
  const a = before ?? null;
  const b = after ?? null;
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;

  if (MONEY_FIELDS.has(field) && typeof a === 'number' && typeof b === 'number') {
    return Math.round(a * 100) !== Math.round(b * 100);
  }
  if (typeof a === 'number' && typeof b === 'number') return a !== b;
  return String(a).trim() !== String(b).trim();
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function changeSummary(
  field: TrackedAssetField,
  before: unknown,
  after: unknown,
  label: string,
): string {
  if (MONEY_FIELDS.has(field) && typeof before === 'number' && typeof after === 'number') {
    const direction = after > before ? 'up' : 'down';
    return `${label} ${direction} from ${money(before)} to ${money(after)}`;
  }
  const from = display(before) ?? 'nothing';
  const to = display(after) ?? 'nothing';
  return `${label} changed from ${from} to ${to}`;
}

/** Field labels for the history, in the words a reviewer would use. */
const FIELD_LABELS: Record<TrackedAssetField, string> = {
  description: 'Description',
  category: 'Register category',
  glAccount: 'GL account',
  entity: 'Entity',
  location: 'Location',
  department: 'Department',
  serialNumber: 'Serial number',
  originalCost: 'Original cost',
  quantity: 'Quantity',
  acquisitionDate: 'Acquisition date',
  acquisitionYear: 'Acquisition year',
  inServiceDate: 'In-service date',
  usefulLife: 'Useful life',
  depreciationMethod: 'Depreciation method',
  accumulatedDepreciation: 'Accumulated depreciation',
  netBookValue: 'Net book value',
};

function draftValue(draft: AssetDraft, field: TrackedAssetField): unknown {
  return (draft as unknown as Record<string, unknown>)[field] ?? null;
}

function describe(draft: AssetDraft): string {
  return draft.description?.trim() || draft.assetTag?.trim() || 'an unnamed row';
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const keyed: KeyedDraft[] = keyDrafts(input.drafts);

  const priorByIdentity = new Map<string, PriorAsset>();
  for (const prior of input.priorAssets) {
    priorByIdentity.set(`${prior.naturalKey}#${prior.ordinal}`, prior);
  }

  const resolutions: Resolution[] = [];
  const events: AssetEventDraft[] = [];
  const claimed = new Set<string>();
  let changed = 0;
  let created = 0;

  keyed.forEach((entry, draftIndex) => {
    const identity = `${entry.key}#${entry.ordinal}`;
    const prior = priorByIdentity.get(identity);
    const matchMethod = matchMethodFor(entry, prior !== undefined);

    resolutions.push({
      draftIndex,
      draft: entry.draft,
      naturalKey: entry.key,
      ordinal: entry.ordinal,
      matchMethod,
      assetId: prior?.id ?? null,
    });

    if (!prior) {
      created += 1;
      events.push({
        assetId: null,
        draftIndex,
        kind: 'discovered',
        field: null,
        previousValue: null,
        value: null,
        significance: 'material',
        summary: `First seen on the register: ${describe(entry.draft)}`,
      });
      return;
    }

    claimed.add(identity);

    // An asset that had gone missing and is back. Worth its own event rather
    // than silence, because the gap is the thing a reviewer needs to ask about.
    if (prior.isAbsent) {
      events.push({
        assetId: prior.id,
        draftIndex,
        kind: 'reappeared',
        field: null,
        previousValue: null,
        value: null,
        significance: 'material',
        summary: `Back on the register after being absent from an earlier upload`,
      });
    }

    let assetChanged = false;
    for (const field of TRACKED_ASSET_FIELDS) {
      const before = prior.values[field] ?? null;
      const after = draftValue(entry.draft, field);
      if (!differs(field, before, after)) continue;

      const significance = significanceOf(field);
      if (significance === 'material') assetChanged = true;

      events.push({
        assetId: prior.id,
        draftIndex,
        kind: 'field-changed',
        field,
        previousValue: display(before),
        value: display(after),
        significance,
        summary: changeSummary(field, before, after, FIELD_LABELS[field]),
      });
    }
    if (assetChanged) changed += 1;

    if (entry.draft.isDisposed !== prior.isDisposed) {
      events.push({
        assetId: prior.id,
        draftIndex,
        kind: entry.draft.isDisposed ? 'disposed' : 'undisposed',
        field: null,
        previousValue: null,
        value: entry.draft.disposalDate ?? entry.draft.disposalIndicator ?? null,
        significance: 'material',
        summary: entry.draft.isDisposed
          ? `Marked disposed on the register${entry.draft.disposalDate ? ` (${entry.draft.disposalDate})` : ''}`
          : `Disposal mark removed — back on the rendition unless something else says otherwise`,
      });
    }
  });

  // Anything the graph holds that this upload never mentioned. Only newly
  // absent assets get an event: an asset missing from five uploads in a row is
  // one open question, not five.
  const absent: PriorAsset[] = [];
  for (const prior of input.priorAssets) {
    const identity = `${prior.naturalKey}#${prior.ordinal}`;
    if (claimed.has(identity)) continue;
    absent.push(prior);
    if (prior.isAbsent) continue;
    events.push({
      assetId: prior.id,
      draftIndex: null,
      kind: 'absent',
      field: null,
      previousValue: null,
      value: null,
      significance: 'material',
      summary: prior.isDisposed
        ? 'No longer listed. It was already marked disposed, so this is the register catching up.'
        : 'No longer listed, and never marked disposed. Either it left without an entry or this export did not cover it.',
    });
  }

  return {
    resolutions,
    absent,
    events,
    counts: {
      total: input.drafts.length,
      new: created,
      matched: input.drafts.length - created,
      absent: absent.length,
      changed,
    },
  };
}
