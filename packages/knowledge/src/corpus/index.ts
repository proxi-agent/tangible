import type { KnowledgeArticle } from '../types.js';
import { FILING_ARTICLES } from './filing.js';
import { DISPUTE_ARTICLES } from './disputes.js';
import { VALUE_ARTICLES } from './value.js';
import { PRACTICE_ARTICLES } from './practice.js';
import { FLORIDA_ARTICLES } from './florida.js';

/**
 * The whole corpus: Texas in the order a season runs — file the return, argue
 * the value it produced, then the years the argument window already closed on,
 * then the practice around all of it — and then Florida, in its own season
 * order.
 *
 * Grouping by state rather than interleaving by topic is deliberate. A reader
 * scrolling the corpus is nearly always working one state, and two calendars
 * alternating down a page invite exactly the confusion the `jurisdiction` tag
 * exists to prevent. Retrieval does not care about this order; people do.
 *
 * Ordering is not cosmetic for the rest either. Retrieval breaks ties by
 * article id, but the listing and the topic filter both walk this array, so a
 * screen that shows the corpus shows it in the order the work happens rather
 * than alphabetically.
 */
export const KNOWLEDGE: readonly KnowledgeArticle[] = [
  ...FILING_ARTICLES,
  ...VALUE_ARTICLES,
  ...DISPUTE_ARTICLES,
  ...PRACTICE_ARTICLES,
  ...FLORIDA_ARTICLES,
];

export {
  FILING_ARTICLES,
  DISPUTE_ARTICLES,
  VALUE_ARTICLES,
  PRACTICE_ARTICLES,
  FLORIDA_ARTICLES,
};
