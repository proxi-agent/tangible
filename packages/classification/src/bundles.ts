import { EXCLUSION_CATEGORIES, type ExclusionKey } from './vocabulary.js';

/**
 * Reading a purchase description for the costs that are riding along inside it.
 *
 * A finding on a register is an argument about a line that was booked years
 * ago. This is the same argument made before the booking, where it is both
 * cheaper and easier to win: "POS system implementation — $180,000" is one line
 * in the ledger and at least three things in the world, and only one of them is
 * tangible personal property. Once it is capitalized as a single number, the
 * split has to be reconstructed from invoices somebody has to go and find. At
 * the point of coding it, the split is sitting on the invoice.
 *
 * These are signals, never decisions. The detector reads words, and words are
 * exactly what it is entitled to: it says "this description mentions training,
 * and training is not property" and stops there. What proportion of the invoice
 * training was, and whether the client wants to split the line at all, are
 * questions for the person reading it. Nothing here changes a classification.
 *
 * The second list matters as much as the first. Freight and installation *look*
 * like the same kind of lever and are not — they are part of what the property
 * cost to put in service, and a client who strips them out has understated a
 * rendition rather than found a saving. The advisor names them so that the
 * person coding the invoice hears it from us before they hear it from an
 * auditor.
 */

export interface BundleSignal {
  /** The wording that raised it, as it appears in the description. */
  phrase: string;
  /** Where this cost would land if it were split onto its own line. */
  exclusionKey: ExclusionKey;
  label: string;
  /** Why it is not taxable property, in the words the exclusion itself uses. */
  basis: string;
}

/** A cost people expect to be able to strip out, and cannot. */
export interface IncludedSignal {
  phrase: string;
  note: string;
}

interface Term {
  /** Matched case-insensitively on a word boundary. */
  match: string;
  exclusionKey: ExclusionKey;
}

const TERMS: readonly Term[] = [
  { match: 'software', exclusionKey: 'excluded-intangible' },
  { match: 'licence', exclusionKey: 'excluded-intangible' },
  { match: 'license', exclusionKey: 'excluded-intangible' },
  { match: 'licensing', exclusionKey: 'excluded-intangible' },
  { match: 'subscription', exclusionKey: 'excluded-intangible' },
  { match: 'saas', exclusionKey: 'excluded-intangible' },
  { match: 'implementation', exclusionKey: 'excluded-intangible' },
  { match: 'configuration', exclusionKey: 'excluded-intangible' },
  { match: 'training', exclusionKey: 'excluded-intangible' },
  { match: 'consulting', exclusionKey: 'excluded-intangible' },
  { match: 'data migration', exclusionKey: 'excluded-intangible' },
  { match: 'goodwill', exclusionKey: 'excluded-intangible' },
  { match: 'capitalized interest', exclusionKey: 'excluded-intangible' },
  { match: 'franchise fee', exclusionKey: 'excluded-intangible' },

  { match: 'roof', exclusionKey: 'excluded-real-property' },
  { match: 'hvac', exclusionKey: 'excluded-real-property' },
  { match: 'foundation', exclusionKey: 'excluded-real-property' },
  { match: 'slab', exclusionKey: 'excluded-real-property' },
  { match: 'paving', exclusionKey: 'excluded-real-property' },
  { match: 'parking lot', exclusionKey: 'excluded-real-property' },
  { match: 'landscaping', exclusionKey: 'excluded-real-property' },
  { match: 'structural', exclusionKey: 'excluded-real-property' },
  { match: 'fire sprinkler', exclusionKey: 'excluded-real-property' },
  { match: 'elevator', exclusionKey: 'excluded-real-property' },

  { match: 'lease', exclusionKey: 'excluded-leased-in' },
  { match: 'leased', exclusionKey: 'excluded-leased-in' },
  { match: 'rental', exclusionKey: 'excluded-leased-in' },
];

const INCLUDED: readonly { match: string; note: string }[] = [
  {
    match: 'freight',
    note: 'Freight is part of what the property cost to get in place, and stays in the reported cost.',
  },
  {
    match: 'shipping',
    note: 'Shipping is part of what the property cost to get in place, and stays in the reported cost.',
  },
  {
    match: 'delivery',
    note: 'Delivery is part of what the property cost to get in place, and stays in the reported cost.',
  },
  {
    match: 'installation',
    note: 'Installation of tangible property is part of putting it in service, and stays in the reported cost. Labour that installs something which is not property — a software rollout — is a different question and shows above.',
  },
  {
    match: 'sales tax',
    note: 'Sales tax paid on the purchase is part of the historical cost when new. Stripping it out understates the rendition.',
  },
];

const boundary = (term: string) =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');

const LABELS = new Map(EXCLUSION_CATEGORIES.map((rule) => [rule.key, rule]));

/**
 * The non-property costs this description mentions.
 *
 * At most one signal per exclusion: three intangible words in one description
 * are one argument, not three, and a list that repeated itself would read as a
 * stronger case than it is.
 */
export function bundledComponents(description: string | null | undefined): BundleSignal[] {
  if (!description) return [];
  const seen = new Set<ExclusionKey>();
  const signals: BundleSignal[] = [];
  for (const term of TERMS) {
    if (seen.has(term.exclusionKey)) continue;
    if (!boundary(term.match).test(description)) continue;
    const rule = LABELS.get(term.exclusionKey);
    if (!rule) continue;
    seen.add(term.exclusionKey);
    signals.push({
      phrase: term.match,
      exclusionKey: term.exclusionKey,
      label: rule.label,
      basis: rule.description,
    });
  }
  return signals;
}

/** The costs in this description that belong in the reported cost and stay there. */
export function includedComponents(description: string | null | undefined): IncludedSignal[] {
  if (!description) return [];
  const seen = new Set<string>();
  const signals: IncludedSignal[] = [];
  for (const term of INCLUDED) {
    if (seen.has(term.note)) continue;
    if (!boundary(term.match).test(description)) continue;
    seen.add(term.note);
    signals.push({ phrase: term.match, note: term.note });
  }
  return signals;
}
