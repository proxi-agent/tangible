import 'server-only';
import { eq } from 'drizzle-orm';
import type { Database } from '@tangible/db';
import { schema } from '@/lib/workspace-db';

/**
 * Writing a reviewer's decision back to memory.
 *
 * One table holds two vocabularies. Asset descriptions fold to keys like
 * `dell latitude laptop`; prior-return wordings fold to keys like
 * `rendition:E:mach and equip`. They cannot collide — the fold maps everything
 * outside `[a-z0-9]` to a space, so no asset description produces a colon — and
 * they share the conflict rule below because the rule is about *reviewers
 * disagreeing*, which has nothing to do with which vocabulary they disagreed in.
 *
 * The rule, in one line: agreement raises the count and clears a flag,
 * disagreement keeps the newer answer but stops the row applying itself. A
 * silent overwrite would push one reviewer's mistake onto every future client.
 */

/** The transaction handle, as drizzle hands it to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface RememberInput {
  fingerprint: string;
  /** Something a person can read back — the original description or wording. */
  sampleDescription: string;
  categoryKey: string;
  lifeClassOverride: number | null;
  engagementId: string | null;
  reviewer: string | null;
  now: Date;
}

export interface RememberResult {
  remembered: boolean;
  /** A previous reviewer had settled this text the other way. */
  conflict: boolean;
}

export async function rememberDecision(tx: Tx, input: RememberInput): Promise<RememberResult> {
  const [prior] = await tx
    .select()
    .from(schema.classificationMemory)
    .where(eq(schema.classificationMemory.fingerprint, input.fingerprint))
    .for('update');

  if (!prior) {
    await tx.insert(schema.classificationMemory).values({
      fingerprint: input.fingerprint,
      sampleDescription: input.sampleDescription,
      categoryKey: input.categoryKey,
      lifeClassOverride: input.lifeClassOverride,
      confirmations: 1,
      sourceEngagementId: input.engagementId,
      lastConfirmedBy: input.reviewer,
      lastConfirmedAt: input.now,
    });
    return { remembered: true, conflict: false };
  }

  if (prior.categoryKey === input.categoryKey) {
    // Agreement. A second reviewer landing on the same answer also settles a
    // row that had been flagged as contested, and it starts applying again.
    await tx
      .update(schema.classificationMemory)
      .set({
        lifeClassOverride: input.lifeClassOverride,
        confirmations: prior.confirmations + 1,
        conflicted: false,
        lastConfirmedBy: input.reviewer,
        lastConfirmedAt: input.now,
      })
      .where(eq(schema.classificationMemory.id, prior.id));
    return { remembered: true, conflict: false };
  }

  // Disagreement. The newer answer is kept, but the row stops applying itself
  // until someone agrees with one of the two.
  await tx
    .update(schema.classificationMemory)
    .set({
      categoryKey: input.categoryKey,
      lifeClassOverride: input.lifeClassOverride,
      // The count describes the answer now stored, which is new.
      confirmations: 1,
      conflicted: true,
      conflictingCategoryKey: prior.categoryKey,
      lastConfirmedBy: input.reviewer,
      lastConfirmedAt: input.now,
    })
    .where(eq(schema.classificationMemory.id, prior.id));
  return { remembered: true, conflict: true };
}
