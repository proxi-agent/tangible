export type {
  KnowledgeArticle,
  KnowledgeHit,
  KnowledgeJurisdiction,
  KnowledgeTopic,
} from './types.js';
export {
  KNOWLEDGE_JURISDICTIONS,
  KNOWLEDGE_TOPICS,
  knowledgeJurisdictionLabel,
} from './types.js';

export {
  KNOWLEDGE,
  FILING_ARTICLES,
  DISPUTE_ARTICLES,
  VALUE_ARTICLES,
  PRACTICE_ARTICLES,
  FLORIDA_ARTICLES,
  METHOD_ARTICLES,
} from './corpus/index.js';

export type { KnowledgeSearchOptions } from './search.js';
export { searchKnowledge, getArticle, listArticles, renderKnowledge } from './search.js';

/**
 * The second retriever: the firm's own prior work, which arrives from the
 * database rather than from this package. Kept beside the curated corpus and
 * never merged with it — one is authority, the other is history.
 */
export type {
  PrecedentDocument,
  PrecedentHit,
  PrecedentKind,
  PrecedentOutcome,
  PrecedentSearchOptions,
  PrecedentTally,
} from './precedent.js';
export {
  PRECEDENT_KINDS,
  precedentKindLabel,
  renderPrecedent,
  searchPrecedent,
  tallyPrecedent,
} from './precedent.js';
