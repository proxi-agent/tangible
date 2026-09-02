import { buildIndex, scoreIndex, type Bm25Index } from './bm25.js';
import { KNOWLEDGE } from './corpus/index.js';
import type {
  KnowledgeArticle,
  KnowledgeHit,
  KnowledgeJurisdiction,
  KnowledgeTopic,
} from './types.js';
import { knowledgeJurisdictionLabel } from './types.js';

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
 * The corpus now holds more than one state, and the `jurisdictions` filter is
 * the reason that is safe. Filtering is the caller's job rather than the
 * scorer's: BM25 has no idea that "April 1" and "April 15" answer the same
 * question differently depending on where the account is, and a Florida
 * article can outscore the Texas one on a Texas question purely on wording.
 * A caller who knows the state should always say so.
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
   * Narrow to these states. An article with no `jurisdiction` is true
   * everywhere and passes every filter, so this narrows rather than excludes.
   *
   * Empty or omitted returns every state, which is the right default for a
   * question asked outside an engagement and the wrong one inside it. Where
   * the account's state is known, pass it: the failure this prevents is not a
   * missing answer but a confident wrong one.
   */
  jurisdictions?: readonly KnowledgeJurisdiction[];
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
  const states = options.jurisdictions?.length ? new Set(options.jurisdictions) : null;

  const where =
    topics || states
      ? (id: string) => {
          const article = byId.get(id);
          if (!article) return false;
          if (topics && !article.topics.some((topic) => topics.has(topic))) return false;
          // An untagged article is jurisdiction-neutral, not unknown.
          if (states && article.jurisdiction && !states.has(article.jurisdiction)) return false;
          return true;
        }
      : undefined;

  return scoreIndex(bm25, query, {
    limit: options.limit,
    minScore: options.minScore,
    where,
  }).map((hit) => ({
    article: byId.get(hit.id)!,
    score: hit.score,
    matched: hit.matched,
  }));
}

export function getArticle(id: string): KnowledgeArticle | null {
  return getIndex().byId.get(id) ?? null;
}

export function listArticles(
  topics?: readonly KnowledgeTopic[],
  jurisdictions?: readonly KnowledgeJurisdiction[],
): KnowledgeArticle[] {
  const wanted = topics?.length ? new Set(topics) : null;
  const states = jurisdictions?.length ? new Set(jurisdictions) : null;
  if (!wanted && !states) return [...KNOWLEDGE];
  return KNOWLEDGE.filter((article) => {
    if (wanted && !article.topics.some((topic) => wanted.has(topic))) return false;
    if (states && article.jurisdiction && !states.has(article.jurisdiction)) return false;
    return true;
  });
}

/**
 * Hits rendered for a prompt.
 *
 * The authority line comes first inside each article because that is what the
 * answer is meant to cite — the assistant should be printing "Tax Code
 * 22.23(b)", never "knowledge article extensions-what-a-request-buys". The id
 * is still included so a caller can validate a citation afterwards, the same
 * way the engagement ask validates its references.
 *
 * The state is printed on its own line rather than left to be inferred from
 * the authority strings. "s. 193.063, F.S." and "Tax Code 22.23(b)" are both
 * extension statutes, and a model reading two of them in one prompt with
 * nothing else to separate them will eventually blend the two deadlines.
 */
export function renderKnowledge(hits: readonly KnowledgeHit[]): string {
  if (hits.length === 0) return '';
  return hits
    .map((hit) => {
      const { article } = hit;
      const authority = article.authority.length
        ? `Authority: ${article.authority.join('; ')}`
        : 'Authority: none — this describes how Tangible works, not what a state requires.';
      const scope = article.jurisdiction
        ? `State: ${knowledgeJurisdictionLabel(article.jurisdiction)}`
        : 'State: applies regardless of state.';
      return [`[${article.id}] ${article.title}`, authority, scope, article.body].join('\n');
    })
    .join('\n\n---\n\n');
}
