import 'server-only';
import { eq } from 'drizzle-orm';
import {
  BUNDLE_TERMS,
  isKnownClassification,
  reviewBundleVocabulary,
  type SettledDescription,
} from '@tangible/classification';
import type { BundleVocabularyBoard } from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The firm's settled classifications, read as a vocabulary lesson.
 *
 * `classification_memory` is the only place in this system where a human
 * judgement about *wording* is stored on its own — one row per distinct
 * description, holding what a reviewer decided that description was. It exists
 * so the fortieth "Dell Latitude 5420" is never asked about again. It is also,
 * unread until now, a labelled corpus: several thousand short phrases with a
 * person's answer attached, which is exactly what the bundle advisor's
 * hand-written term list has never had.
 *
 * Cross-client and cross-season, like the acceptance learner, and for the same
 * reason: no single register has enough settled wordings to say anything, and
 * the hundredth client benefits from the ninety-nine before it. Nothing
 * client-identifying is derived from it — what comes out is a phrase, a count
 * and an exclusion key. The sample descriptions are the exception and they are
 * a real one: they are a client's register text, so this board is firm-only,
 * on a route the portal's allowlist does not carry.
 */

/**
 * Two filters, both of which change what the numbers mean.
 *
 * **Conflicted rows are dropped.** A row two reviewers settled differently has
 * stopped asserting itself in the classification path, and letting it assert
 * itself here would be worse: the whole disagreement is about which wording
 * decides, which is the question this file is asking.
 *
 * **Only real classification keys.** One table holds two vocabularies —
 * asset descriptions settled to a category, and prior-return wordings settled
 * to a line-mapping key like `rendition:E:mach and equip`. The second set is
 * not asset text and its keys are not classifications, so `isKnownClassification`
 * is the same guard the classification path uses, asked here for the same
 * reason: a key from the other vocabulary would be counted as "not an
 * exclusion" and quietly deflate every base rate.
 */
export interface DatedDescription {
  settled: SettledDescription;
  /**
   * When the wording entered the corpus, not when it was last confirmed.
   *
   * The digest reconstructs an earlier reading by dropping rows that arrived
   * after its window opened, and this is the column that answers "arrived".
   * It is an approximation with a named edge: a row created in May whose
   * category a reviewer changed in August is reconstructed with its *August*
   * answer, because the table keeps one answer per wording and overwrites. So
   * the earlier reading is the corpus as it was *assembled*, not as it read at
   * the time. Getting the second would need an append-only history of
   * settlements, which is a table and a decision, and the digest does not need
   * it: what it measures is which phrases became sayable, and a phrase whose
   * answer was revised is one whose evidence changed either way.
   */
  createdAt: Date;
}

export async function datedDescriptions(): Promise<DatedDescription[]> {
  const db = requireDb();
  const rows = await db
    .select({
      sampleDescription: schema.classificationMemory.sampleDescription,
      categoryKey: schema.classificationMemory.categoryKey,
      createdAt: schema.classificationMemory.createdAt,
    })
    .from(schema.classificationMemory)
    .where(eq(schema.classificationMemory.conflicted, false));

  return rows
    .filter((row) => isKnownClassification(row.categoryKey))
    .map((row) => ({
      settled: { description: row.sampleDescription, categoryKey: row.categoryKey },
      createdAt: row.createdAt,
    }));
}

/** The corpus as it stands, for the board. The digest wants the dates too. */
export async function settledDescriptions(): Promise<SettledDescription[]> {
  return (await datedDescriptions()).map((row) => row.settled);
}

/**
 * What the record says the advisor's vocabulary should be.
 *
 * The whole review, proposals and challenges together, because they are one
 * answer to one question. A screen that showed only what to add would let the
 * list grow every season and never shrink, which is how hand-written
 * vocabularies go stale — quietly, one plausible entry at a time.
 */
export async function bundleVocabularyBoard(): Promise<BundleVocabularyBoard> {
  const review = reviewBundleVocabulary(await settledDescriptions());
  return {
    observations: review.observations,
    exclusionObservations: review.exclusionObservations,
    judgedPhrases: review.judgedPhrases,
    vocabularySize: BUNDLE_TERMS.length,
    proposals: review.proposals,
    challenges: review.challenges,
    withheld: review.withheld,
    unobserved: review.unobserved,
    baseRates: review.baseRates,
  };
}
