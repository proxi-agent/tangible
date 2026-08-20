import type { AssetDraft } from '@tangible/far';

/**
 * What makes two rows, in two different uploads, the same asset.
 *
 * This is the question the whole graph rests on, and getting it wrong is
 * expensive in both directions. Too loose and one client's forklift absorbs
 * another asset's history, so a cost restatement looks like a disposal and a
 * finding gets attached to the wrong row. Too tight and every upload discovers
 * an entirely new register, which is exactly the behaviour we are replacing.
 *
 * Two keys, in order of authority.
 *
 * **The register's own tag**, when it has one. Fixed asset systems assign these
 * precisely so a row can be followed across years, and they are the answer
 * whenever they exist. Sage splits an asset into .001/.002 extensions, which are
 * different assets with different costs and lives, so the extension is part of
 * the key rather than something to strip.
 *
 * **A fingerprint of description, cost and acquisition**, when it does not. Three
 * facts that a register does not change year to year unless something really
 * changed, and distinctive enough for anything that is not mass-purchased.
 *
 * Neither key is hashed. A key you can read is a key you can audit when a match
 * turns out to be wrong, and these are stored in a private table on a few
 * thousand rows per client — there is nothing to be gained by making them
 * opaque.
 */

/** Punctuation and case are decoration in a tag; "A-1042" and "a1042" are one asset. */
function foldTag(tag: string): string {
  return tag
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/^0+(?=\d)/, '');
}

/**
 * Descriptions vary in whitespace and case between exports of the same register.
 * Nothing else is dropped: unlike the classification fingerprint, this key is
 * not trying to decide that two *different* assets are the same kind of thing.
 * It is trying to decide they are the same object, so a model number is signal.
 */
function foldDescription(description: string): string {
  return description
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Money to cents. A register that re-exports $1,200 as 1200.0000001 is the same asset. */
function foldMoney(value: number | null): string {
  return value === null ? '~' : String(Math.round(value * 100));
}

export type NaturalKeyBasis = 'asset-tag' | 'fingerprint';

export interface NaturalKey {
  key: string;
  basis: NaturalKeyBasis;
}

/**
 * The key for one row. Always returns something: a row with no tag, no
 * description, no cost and no year still needs an identity, and the empty
 * fingerprint plus an ordinal gives it a stable one rather than making it
 * un-trackable. Such a row is a data problem, and normalization has already
 * attached a warning saying so.
 */
export function naturalKeyFor(draft: AssetDraft): NaturalKey {
  const tag = draft.assetTag?.trim();
  if (tag) {
    const folded = foldTag(tag);
    if (folded) return { key: `tag:${folded}`, basis: 'asset-tag' };
  }

  const description = draft.description?.trim();
  const acquisition = draft.acquisitionDate ?? draft.acquisitionYear?.toString() ?? '~';
  const parts = [
    description ? foldDescription(description) : '~',
    foldMoney(draft.originalCost),
    acquisition,
  ];
  return { key: `fp:${parts.join('|')}`, basis: 'fingerprint' };
}

/**
 * Assign ordinals within one upload.
 *
 * Ten identical desks on one purchase order share a fingerprint and have to stay
 * ten assets. They are numbered in the order the workbook lists them, which is
 * the only ordering the register itself supplies and the one that stays put
 * between exports of the same system.
 *
 * The ordinal is honest about what it can and cannot do. Next year's export of
 * the same ten desks lines up one for one. If two of them are scrapped, the
 * eight that remain take ordinals 0–7 and the two highest-numbered assets go
 * absent — which is right in every way that matters, because the desks are
 * fungible and carry identical tax treatment, and wrong only about which two
 * physical desks left the building. Nothing in a fixed asset register can answer
 * that, so nothing here pretends to.
 */
export interface KeyedDraft {
  draft: AssetDraft;
  key: string;
  basis: NaturalKeyBasis;
  ordinal: number;
  /** True when the key covers more than one row in this upload. */
  ambiguous: boolean;
}

export function keyDrafts(drafts: readonly AssetDraft[]): KeyedDraft[] {
  const keyed = drafts.map((draft) => ({ draft, ...naturalKeyFor(draft) }));

  const total = new Map<string, number>();
  for (const entry of keyed) total.set(entry.key, (total.get(entry.key) ?? 0) + 1);

  const seen = new Map<string, number>();
  return keyed.map((entry) => {
    const ordinal = seen.get(entry.key) ?? 0;
    seen.set(entry.key, ordinal + 1);
    return { ...entry, ordinal, ambiguous: (total.get(entry.key) ?? 0) > 1 };
  });
}

/**
 * How a row was matched, for the record.
 *
 * A tag match and a fingerprint match are different kinds of claim, and an
 * ordinal match is a weaker claim than either — it says "one of these", not
 * "this one". A reviewer reading a disposal needs to be able to tell those
 * apart, so the distinction is stored rather than inferred later.
 */
export function matchMethodFor(entry: KeyedDraft, matched: boolean): string {
  if (!matched) return 'new';
  if (entry.basis === 'asset-tag') return 'asset-tag';
  return entry.ambiguous ? 'fingerprint-ordinal' : 'fingerprint';
}
