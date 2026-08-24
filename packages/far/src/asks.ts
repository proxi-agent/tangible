import type { MappingAsk } from '@tangible/types';

/**
 * Identity for an ask across re-proposals.
 *
 * The model rewords. "Are the year-only acquisition dates fiscal years?" comes
 * back next round as "Do the acquisition years refer to fiscal or calendar
 * years?", and an answer recorded against the first must attach to the second
 * — losing it would make the reviewer answer the same question twice, which is
 * the failure this whole table exists to prevent.
 *
 * Two prints, same idea as the findings fingerprints: the strict one includes
 * the question's normalized words and identifies an ask exactly; the loose one
 * is just (field, sheetName) and exists so a reworded question about the same
 * field can inherit the answer already collected. Loose matching is only
 * trusted when the ask names a field — two free-text questions about nothing
 * in particular are not the same question just because both name no sheet.
 */

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function askFingerprint(ask: MappingAsk): string {
  return `${ask.field ?? '-'}|${ask.sheetName ?? '-'}|${normalize(ask.question)}`;
}

export function askLooseFingerprint(ask: { field: string | null; sheetName: string | null }): string | null {
  return ask.field === null ? null : `${ask.field}|${ask.sheetName ?? '-'}`;
}

export interface ExistingAsk {
  id: string;
  fingerprint: string;
  field: string | null;
  sheetName: string | null;
  status: string;
  answer: string | null;
}

export interface AskSyncPlan {
  /** Brand-new questions: insert as open rows. */
  insert: { ask: MappingAsk; fingerprint: string }[];
  /** Reworded questions that keep their row (and answer): update wording and fingerprint. */
  update: { id: string; ask: MappingAsk; fingerprint: string }[];
}

/**
 * Decide what the latest proposal's asks do to the rows on file. Pure.
 *
 * Rows the proposal no longer asks about are deliberately left alone: an
 * answered ask is a record of something learned from the client, and a
 * dismissed one is a decision somebody made. Neither un-happens because the
 * model stopped asking.
 */
export function planAskSync(existing: ExistingAsk[], incoming: MappingAsk[]): AskSyncPlan {
  const byStrict = new Map(existing.map((row) => [row.fingerprint, row]));
  const byLoose = new Map<string, ExistingAsk>();
  for (const row of existing) {
    const loose = askLooseFingerprint({ field: row.field, sheetName: row.sheetName });
    // First wins — with two rows about one field, inheriting into the older
    // (first-created) one is at least deterministic.
    if (loose !== null && !byLoose.has(loose)) byLoose.set(loose, row);
  }

  const plan: AskSyncPlan = { insert: [], update: [] };
  const claimed = new Set<string>();

  for (const ask of incoming) {
    const strict = askFingerprint(ask);
    if (byStrict.has(strict)) {
      claimed.add(byStrict.get(strict)!.id);
      continue; // Same question, already on file — nothing to do.
    }
    const looseKey = askLooseFingerprint(ask);
    const inherited = looseKey !== null ? byLoose.get(looseKey) : undefined;
    if (inherited && !claimed.has(inherited.id)) {
      claimed.add(inherited.id);
      plan.update.push({ id: inherited.id, ask, fingerprint: strict });
      continue;
    }
    plan.insert.push({ ask, fingerprint: strict });
  }
  return plan;
}
