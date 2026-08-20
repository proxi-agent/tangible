import { CATEGORY_BY_KEY, HCAD_CATEGORIES, HCAD_CATEGORY_KEYS } from '@tangible/valuation';

/**
 * The full set of answers a classification can give.
 *
 * A district's category table only covers property the district values. But a
 * fixed asset register is a *book* record, kept for depreciation, and it carries
 * things that are not business personal property at all: the building the
 * company owns, the software licences it capitalized, the copier it leases from
 * a lessor who renders it themselves. Those rows get rendered anyway, every
 * year, because nobody went through the register line by line.
 *
 * That is the largest single lever in this product, and a vocabulary made only
 * of schedule rows cannot express it — every one of those assets would be
 * forced into some category and then valued. So the answer set is the district's
 * categories plus a short list of exclusions, and an exclusion is a finding:
 * cost that comes off the rendition entirely rather than being depreciated more
 * favourably.
 *
 * Every exclusion is a claim that has to survive a district's questions, so each
 * one names its basis and none of them is applied without a person.
 */

export interface ExclusionRule {
  key: string;
  label: string;
  /** What belongs here — written for both the review UI and the model prompt. */
  description: string;
}

export const EXCLUSION_CATEGORIES: readonly ExclusionRule[] = [
  {
    key: 'excluded-real-property',
    label: 'Real property, not BPP',
    description:
      'Land, buildings, and structural components carried on the register — roofs, HVAC serving the structure, permanent electrical and plumbing, parking. These are appraised as real property and taxed there; rendering them again on the personal property account taxes the same thing twice. Tenant build-out is the near case and belongs in leasehold improvements instead, where Tax Code 23.24 governs.',
  },
  {
    key: 'excluded-intangible',
    label: 'Intangible or non-property cost',
    description:
      'Software licences, capitalized implementation and training labour, goodwill, patents, franchise fees, and capitalized interest. Texas ad valorem tax reaches tangible personal property (Tax Code 11.02); these are not it. The exception worth checking: software bundled into the purchase price of a machine that cannot run without it is usually part of that machine’s value.',
  },
  {
    key: 'excluded-leased-in',
    label: 'Leased in — owned by someone else',
    description:
      'Equipment the client leases or rents rather than owns: copiers, postage meters, coffee equipment, leased forklifts. The owner renders it, and Form 50-144 asks for it separately rather than in the client’s own schedule. Common in registers because the book entry looks identical to an owned asset.',
  },
];

export const EXCLUSION_KEYS = [
  'excluded-real-property',
  'excluded-intangible',
  'excluded-leased-in',
] as const;

export type ExclusionKey = (typeof EXCLUSION_KEYS)[number];

/**
 * Every key a classification may carry, as a literal tuple — structured outputs
 * need a closed enum, and this is the closed set.
 */
export const CLASSIFICATION_KEYS = [...HCAD_CATEGORY_KEYS, ...EXCLUSION_KEYS] as const;

export type ClassificationKey = (typeof CLASSIFICATION_KEYS)[number];

const EXCLUSION_BY_KEY: Readonly<Record<string, ExclusionRule>> = Object.fromEntries(
  EXCLUSION_CATEGORIES.map((rule) => [rule.key, rule]),
);

export function isExclusion(key: string | null | undefined): boolean {
  return key !== null && key !== undefined && key in EXCLUSION_BY_KEY;
}

export function isKnownClassification(key: string | null | undefined): key is string {
  return key !== null && key !== undefined && (key in CATEGORY_BY_KEY || key in EXCLUSION_BY_KEY);
}

export function classificationLabel(key: string): string {
  return CATEGORY_BY_KEY[key]?.label ?? EXCLUSION_BY_KEY[key]?.label ?? key;
}

/** Label plus definition, for the review dropdown and the model prompt alike. */
export interface ClassificationOption {
  key: string;
  label: string;
  description: string;
  /** Exclusions come off the rendition; categories get valued on a schedule. */
  kind: 'schedule' | 'exclusion';
}

export function classificationOptions(): ClassificationOption[] {
  return [
    ...HCAD_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      description: category.description,
      kind: 'schedule' as const,
    })),
    ...EXCLUSION_CATEGORIES.map((rule) => ({
      key: rule.key,
      label: rule.label,
      description: rule.description,
      kind: 'exclusion' as const,
    })),
  ];
}
