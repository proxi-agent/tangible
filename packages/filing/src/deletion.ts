import type { DeletionCounts } from '@tangible/types';

/**
 * What the operator should weigh before deleting a client.
 *
 * These are consequences, not obstacles. Nothing here blocks the deletion —
 * the client asked, and the firm's convenience is not a reason to refuse — but
 * a filed rendition and a learned classification are losses of different kinds,
 * and neither is obvious from a row count alone.
 */
export function deletionWarnings(counts: DeletionCounts): string[] {
  const warnings: string[] = [];

  if (counts.filedRenditions > 0) {
    warnings.push(
      `${plural(counts.filedRenditions, 'filed rendition')} on record will go. The district keeps its own copy of what was filed; this removes the firm's.`,
    );
  }
  if (counts.protests > 0 || counts.correctionMotions > 0) {
    const parts = [
      counts.protests > 0 ? plural(counts.protests, 'protest') : null,
      counts.correctionMotions > 0 ? plural(counts.correctionMotions, '25.25 motion') : null,
    ].filter(Boolean);
    warnings.push(
      `${parts.join(' and ')} will go with it, including any deadline still running. Check nothing is live before you confirm.`,
    );
  }
  if (counts.memoryRows > 0) {
    warnings.push(
      `${plural(counts.memoryRows, 'learned classification')} drawn from this client's register will be removed — they hold the client's own description text. Other clients lose the benefit of those confirmations.`,
    );
  }
  if (counts.assistantTurns > 0) {
    warnings.push(
      `${plural(counts.assistantTurns, 'assistant answer')} that named this client will be removed, and any thread left with nothing in it goes too. Answers quote the record, so they carry the same confidentiality as the record does.`,
    );
  }
  if (counts.storageObjects > 0) {
    warnings.push(
      `${plural(counts.storageObjects, 'uploaded file')} will be removed from the private bucket after the rows are gone. A file the bucket refuses is named on the receipt rather than assumed gone.`,
    );
  }

  return warnings;
}

function plural(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}
