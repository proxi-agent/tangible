import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import {
  headerFingerprints,
  headerHints,
  headersFromSummaries,
  type HeaderDecision,
  type HeaderMemoryRecord,
} from '@tangible/far';
import type { FarFileRow } from '@tangible/db';
import {
  CANONICAL_ASSET_FIELDS,
  type CanonicalAssetField,
  type FarMapping,
  type MappingMemoryHint,
  type SheetSummary,
} from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The rows behind the header memory. The rules are in `@tangible/far`; this is
 * the read and the write.
 *
 * Deliberately the same shape as {@link rememberDecision} for classifications,
 * because it is the same bargain: a person settled something, and nobody at
 * this firm should be asked about it again. Agreement raises the count,
 * disagreement keeps the newer answer and stops the row asserting itself, and
 * a silent overwrite — which is what "just update it" means — would push one
 * reviewer's misread of a cost column onto every register that follows.
 */

const KNOWN = new Set<string>(CANONICAL_ASSET_FIELDS);

/**
 * A stored field that the canonical vocabulary no longer contains is dropped
 * rather than surfaced. Extending `CANONICAL_ASSET_FIELDS` is a schema change
 * everywhere at once; removing one should not leave hints pointing at a field
 * the dropdown cannot offer.
 */
const known = (field: string): field is CanonicalAssetField => KNOWN.has(field);

export interface RememberHeadersInput {
  decisions: readonly HeaderDecision[];
  farFileId: string;
  reviewer: string | null;
  now: Date;
}

export interface RememberHeadersResult {
  /** Headers written — new rows plus agreements. */
  remembered: number;
  /** Headers where this file disagreed with what was already on file. */
  conflicts: number;
}

export async function rememberHeaderDecisions(
  input: RememberHeadersInput,
): Promise<RememberHeadersResult> {
  if (input.decisions.length === 0) return { remembered: 0, conflicts: 0 };

  const db = requireDb();
  let remembered = 0;
  let conflicts = 0;

  await db.transaction(async (tx) => {
    for (const decision of input.decisions) {
      const [prior] = await tx
        .select()
        .from(schema.mappingMemory)
        .where(eq(schema.mappingMemory.fingerprint, decision.fingerprint))
        .for('update');

      if (!prior) {
        await tx.insert(schema.mappingMemory).values({
          fingerprint: decision.fingerprint,
          sampleHeader: decision.sampleHeader,
          field: decision.field,
          confirmations: 1,
          sourceFarFileId: input.farFileId,
          lastConfirmedBy: input.reviewer,
          lastConfirmedAt: input.now,
        });
        remembered += 1;
        continue;
      }

      if (prior.field === decision.field) {
        // Agreement. A second reviewer landing on the same field also settles a
        // row that had been contested, and it starts asserting itself again.
        await tx
          .update(schema.mappingMemory)
          .set({
            confirmations: prior.confirmations + 1,
            conflicted: false,
            conflictingField: null,
            lastConfirmedBy: input.reviewer,
            lastConfirmedAt: input.now,
          })
          .where(eq(schema.mappingMemory.id, prior.id));
        remembered += 1;
        continue;
      }

      await tx
        .update(schema.mappingMemory)
        .set({
          field: decision.field,
          sampleHeader: decision.sampleHeader,
          // The count describes the answer now stored, which is new.
          confirmations: 1,
          conflicted: true,
          conflictingField: prior.field,
          lastConfirmedBy: input.reviewer,
          lastConfirmedAt: input.now,
        })
        .where(eq(schema.mappingMemory.id, prior.id));
      remembered += 1;
      conflicts += 1;
    }
  });

  return { remembered, conflicts };
}

/** Everything the firm has settled about this set of folded headers. */
export async function headerMemoryFor(
  fingerprints: readonly string[],
): Promise<HeaderMemoryRecord[]> {
  if (fingerprints.length === 0) return [];

  const rows = await requireDb()
    .select()
    .from(schema.mappingMemory)
    .where(inArray(schema.mappingMemory.fingerprint, [...fingerprints]));

  return rows
    .filter((row) => known(row.field))
    .map((row) => ({
      fingerprint: row.fingerprint,
      sampleHeader: row.sampleHeader,
      field: row.field as CanonicalAssetField,
      confirmations: row.confirmations,
      conflicted: row.conflicted,
      conflictingField:
        row.conflictingField !== null && known(row.conflictingField)
          ? row.conflictingField
          : null,
    }));
}

/**
 * What memory has to say about one file's headers.
 *
 * The header row is whichever the file has most recently been understood to
 * have — confirmed beats proposed beats the parser's guess — because a hint
 * pinned to the wrong row is a hint about the wrong words. It reads the stored
 * preview rather than the workbook: the columns past the preview's fortieth
 * are not on the review screen either, so a hint about one could not be seen
 * or acted on. Confirm reads the whole file, and learns from all of them.
 */
export async function hintsForFile(row: FarFileRow): Promise<MappingMemoryHint[]> {
  const summaries = row.sheetSummaries as SheetSummary[] | null;
  if (!summaries) return [];

  const mapping = (row.confirmedMapping ?? row.proposal) as FarMapping | null;
  const sheets = headersFromSummaries(summaries, mapping);
  const memory = await headerMemoryFor(headerFingerprints(sheets));
  return headerHints(sheets, memory);
}
