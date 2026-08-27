'use client';

import { stateClassGroup } from '@tangible/types';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The state's class code, said in a word.
 *
 * The roll files this as L1, L2, S1, J6 — precise, and unreadable: a reader
 * scanning for the ordinary businesses among the pipelines had to hold a
 * five-way code table in their head to do it. The word is what the column is
 * actually for, and the code follows it into the tooltip for the reader who
 * works in the district's own vocabulary.
 *
 * Two screens print this — the roll table and one account's header — so the
 * vocabulary lives here rather than in either of them.
 */
export const CLASS_WORDS: Record<string, { word: string; meaning: string }> = {
  commercial: {
    word: 'Commercial',
    meaning:
      'Ordinary business equipment — the L1 class. This is the property a rendition covers, and the class this product serves.',
  },
  industrial: {
    word: 'Industrial',
    meaning:
      'Plant and heavy equipment — the L2 class. Rendered like commercial property, usually at much larger values.',
  },
  specialInventory: {
    word: 'Dealer',
    meaning:
      'Special inventory — car, boat and heavy-equipment dealers. Taxed through monthly declarations rather than an annual rendition, so a missed rendition means nothing here.',
  },
  utility: {
    word: 'Utility',
    meaning:
      'Utilities and pipelines — the J classes. Valued through a separate process, so the filing record on these accounts is not comparable to a business rendition.',
  },
  exempt: {
    word: 'Exempt',
    meaning:
      'Fully exempt — hospitals, charities and government. Owes no tax on the equipment, so there is no penalty to recover.',
  },
};

/** The word for a raw class code, or null where the code is one we cannot name. */
export function stateClassWord(stateClass: string | null | undefined) {
  if (!stateClass) return null;
  const group = stateClassGroup(stateClass);
  return group ? (CLASS_WORDS[group] ?? null) : null;
}

/** One table cell: the word, the code on hover, an em dash where there is neither. */
export function StateClassCell({ stateClass }: { stateClass: string | null }) {
  if (!stateClass) return <span className="text-[var(--color-ink-muted)]">—</span>;

  const label = stateClassWord(stateClass);
  if (!label) return <span className="text-[var(--color-ink-secondary)]">{stateClass}</span>;

  return (
    <Tooltip title={`${stateClass} · ${label.word}`} content={label.meaning}>
      <span className="text-[var(--color-ink-secondary)]">{label.word}</span>
    </Tooltip>
  );
}
