import type { EvidenceSourceKind } from './sources.js';

/**
 * Reading an external export's header row without asking a model.
 *
 * The register gets an AI mapping proposal because a fixed asset register is an
 * arbitrary artifact — every ERP names its columns differently, half of them
 * are in a language the accounting team invented, and the cost of getting one
 * wrong is a whole season's numbers. None of that is true here. An evidence
 * export has at most six fields, they are the same six fields in every
 * maintenance system ever shipped, and a wrong guess produces a match that a
 * reviewer sees spelled out ("serial ABC123 = ABC123") before it counts for
 * anything.
 *
 * So this is a lookup table, and being a lookup table is the feature: it costs
 * nothing, it runs offline, it is the same answer twice, and a firm uploading a
 * CMMS export at 11pm does not wait on an API. Where it cannot tell, it says so
 * and the human picks the column — which is the same ending the model would
 * have had, reached faster.
 */

export type EvidenceField =
  'assetTag' | 'serial' | 'model' | 'description' | 'amount' | 'lastSeenOn';

export const EVIDENCE_FIELDS: readonly EvidenceField[] = [
  'assetTag',
  'serial',
  'model',
  'description',
  'amount',
  'lastSeenOn',
];

/** A column index per field, or null where the export does not carry one. */
export type EvidenceColumnMap = Readonly<Record<EvidenceField, number | null>>;

export const EMPTY_COLUMN_MAP: EvidenceColumnMap = {
  assetTag: null,
  serial: null,
  model: null,
  description: null,
  amount: null,
  lastSeenOn: null,
};

/**
 * Header phrases, strongest first within each field.
 *
 * Matched against the header normalized to lowercase words. The order inside a
 * field is what breaks a tie between two plausible columns: a CMMS export that
 * carries both "Asset ID" and "Equipment ID" should take the first, and a list
 * that carries "Serial Number" and "Model Number" must not read the second as a
 * serial just because both end in "number" — which is why every phrase here is
 * the whole phrase and not a fragment.
 */
const PHRASES: Readonly<Record<EvidenceField, readonly string[]>> = {
  assetTag: [
    'asset tag',
    'tag number',
    'tag no',
    'property tag',
    'barcode',
    'asset id',
    'asset number',
    'equipment id',
    'equipment number',
    'device id',
    'tag',
  ],
  serial: ['serial number', 'serial no', 'serial', 'sn', 'vin', 'imei', 'service tag'],
  model: ['model number', 'model name', 'model', 'part number', 'catalog number'],
  description: [
    'description',
    'asset description',
    'equipment description',
    'item description',
    'asset name',
    'equipment name',
    'device name',
    'name',
    'item',
  ],
  amount: [
    'insured value',
    'replacement cost',
    'value',
    'amount',
    'cost',
    'original cost',
    'acquisition cost',
    'purchase price',
  ],
  lastSeenOn: [
    'last check in',
    'last checkin',
    'last seen',
    'last contact',
    'last inventory',
    'last service',
    'last work order',
    'completed on',
    'completed date',
    'work order date',
    'service date',
    'last activity',
    'last updated',
  ],
};

const words = (header: unknown): string =>
  String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Where a header sits on a phrase list, or -1.
 *
 * An exact header wins over a header that merely contains the phrase, which is
 * what keeps a column literally called "Serial" ahead of one called "Serial
 * number of the parent assembly" without needing a second table of exceptions.
 */
function rank(header: string, field: EvidenceField): number {
  const list = PHRASES[field];
  for (let i = 0; i < list.length; i++) {
    if (header === list[i]) return i;
  }
  for (let i = 0; i < list.length; i++) {
    const phrase = list[i]!;
    if (header.includes(phrase)) return list.length + i;
  }
  return -1;
}

/**
 * The best column for each field, with no column claimed twice.
 *
 * Assignment is greedy over the strongest (field, column) pair remaining, not
 * field by field in declaration order. Field-by-field would let `assetTag` —
 * whose list ends in the bare word "tag" — take a column called "Service tag"
 * before `serial` ever looked at it, and a Dell service tag is a serial number.
 * Resolving globally means the pair that agrees most strongly is settled first
 * whichever field it belongs to.
 */
export function proposeColumns(headers: readonly unknown[]): EvidenceColumnMap {
  const normalized = headers.map(words);
  const candidates: Array<{ field: EvidenceField; column: number; rank: number }> = [];
  for (const field of EVIDENCE_FIELDS) {
    normalized.forEach((header, column) => {
      if (header === '') return;
      const r = rank(header, field);
      if (r >= 0) candidates.push({ field, column, rank: r });
    });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.column - b.column);

  const map: Record<EvidenceField, number | null> = { ...EMPTY_COLUMN_MAP };
  const taken = new Set<number>();
  for (const candidate of candidates) {
    if (map[candidate.field] !== null || taken.has(candidate.column)) continue;
    map[candidate.field] = candidate.column;
    taken.add(candidate.column);
  }
  return map;
}

/**
 * Whether a mapping can produce records worth matching against.
 *
 * One identifier or a description is the whole bar. A source that carries
 * neither has nothing a register row could ever be compared to, and importing
 * it would create an export whose only effect is to make every covered asset
 * look searched-and-not-found — a manufactured negative over a file that never
 * had the information. That is the single most damaging thing this feature
 * could do, so it is refused at the door rather than caveated later.
 */
export function mappingIsUsable(map: EvidenceColumnMap): boolean {
  return (
    map.assetTag !== null || map.serial !== null || map.model !== null || map.description !== null
  );
}

/**
 * What each source is usually keyed on, shown as the hint next to the mapping.
 *
 * Not enforced — a CMMS export with no serial column is perfectly normal and
 * matching falls back to description. It exists so the person mapping the file
 * knows which column is worth hunting for before they settle for the weak one.
 */
export const KEYED_ON: Readonly<Record<EvidenceSourceKind, EvidenceField>> = {
  cmms: 'assetTag',
  itam: 'serial',
  'insurance-sov': 'description',
  'real-property': 'description',
  'lease-subledger': 'description',
  'physical-inventory': 'assetTag',
};
