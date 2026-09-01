import { buildIndex, scoreIndex, type Bm25Index } from './bm25.js';
import { KNOWLEDGE } from './corpus/index.js';
import type { KnowledgeArticle, KnowledgeHit, KnowledgeTopic } from './types.js';

/**
 * Retrieval over the curated corpus, done arithmetically rather than by a
 * model. The scoring lives in `bm25.ts`; what is here is the corpus's own
 * shape — which fields exist and what a match in each is worth.
 *
 * Why not embeddings. This corpus is a few dozen curated articles, not a
 * document set — at that size lexical retrieval with a hand-written keyword
 * field beats a vector index on the queries that matter, and it beats it
 * decisively on the ones that name a statute. It also costs no API call, adds
 * no extension to the database, and returns the same articles for the same
 * question every time, which is the property that makes an answer checkable.
 *
 * The firm's own prior work is now that second retriever, in `precedent.ts`.
 * It shares this arithmetic and shares nothing else: this corpus is authority
 * and that one is history, and an answer that confused the two would cite a
 * brief as though it were a statute.
 *
 * The one thing this must never do is return nothing quietly. A query that
 * clears no article is a real answer — the corpus does not cover it — and the
 * caller is expected to say so rather than let the model fill the gap.
 */

/** Field weights. A term in the title is worth five body occurrences. */
const FIELD_WEIGHTS = { title: 5, keywords: 4, authority: 3, topics: 2, body: 1 } as const;

/**
 * Built once per process. The corpus is a module constant, so there is nothing
 * to invalidate — a deployment that changes an article ships a new process.
 * The precedent retriever cannot do this, which is the other reason the two
 * are separate files rather than one parameterised one.
 */
interface Index {
  bm25: Bm25Index;
  byId: Map<string, KnowledgeArticle>;
}

let index: Index | null = null;

function getIndex(): Index {
  if (index) return index;
  index = {
    bm25: buildIndex(
      KNOWLEDGE.map((article) => ({
        id: article.id,
        fields: [
          { text: article.title, weight: FIELD_WEIGHTS.title },
          { text: article.keywords.join(' '), weight: FIELD_WEIGHTS.keywords },
          { text: article.authority.join(' '), weight: FIELD_WEIGHTS.authority },
          { text: article.topics.join(' '), weight: FIELD_WEIGHTS.topics },
          { text: article.body, weight: FIELD_WEIGHTS.body },
        ],
      })),
    ),
    byId: new Map(KNOWLEDGE.map((article) => [article.id, article])),
  };
  return index;
}

export interface KnowledgeSearchOptions {
  /** How many articles to return. Retrieval is cheap; prompts are not. */
  limit?: number;
  /** Narrow to these topics. Empty or omitted searches the whole corpus. */
  topics?: readonly KnowledgeTopic[];
  /**
   * Score a hit must clear. Tuned so an unrelated question — "what's the
   * weather" — returns nothing rather than the least-bad article, which is the
   * behaviour that lets the caller honestly say the corpus is silent.
   */
  minScore?: number;
}

export function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeHit[] {
  const { bm25, byId } = getIndex();
  const topics = options.topics?.length ? new Set(options.topics) : null;

  return scoreIndex(bm25, query, {
    limit: options.limit,
    minScore: options.minScore,
    where: topics
      ? (id) => byId.get(id)?.topics.some((topic) => topics.has(topic)) ?? false
      : undefined,
  }).map((hit) => ({
    article: byId.get(hit.id)!,
    score: hit.score,
    matched: hit.matched,
  }));
}

export function getArticle(id: string): KnowledgeArticle | null {
  return getIndex().byId.get(id) ?? null;
}

export function listArticles(topics?: readonly KnowledgeTopic[]): KnowledgeArticle[] {
  if (!topics?.length) return [...KNOWLEDGE];
  const wanted = new Set(topics);
  return KNOWLEDGE.filter((article) => article.topics.some((topic) => wanted.has(topic)));
}

/**
 * Hits rendered for a prompt.
 *
 * The authority line comes first inside each article because that is what the
 * answer is meant to cite — the assistant should be printing "Tax Code
 * 22.23(b)", never "knowledge article extensions-what-a-request-buys". The id
 * is still included so a caller can validate a citation afterwards, the same
 * way the engagement ask validates its references.
 */
export function renderKnowledge(hits: readonly KnowledgeHit[]): string {
  if (hits.length === 0) return '';
  return hits
    .map((hit) => {
      const { article } = hit;
      const authority = article.authority.length
        ? `Authority: ${article.authority.join('; ')}`
        : 'Authority: none — this describes how Tangible works, not what Texas requires.';
      return [`[${article.id}] ${article.title}`, authority, article.body].join('\n');
    })
    .join('\n\n---\n\n');
}
