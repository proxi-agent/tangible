import { KNOWLEDGE } from './corpus/index.js';
import type { KnowledgeArticle, KnowledgeHit, KnowledgeTopic } from './types.js';

/**
 * Retrieval over the corpus, done arithmetically rather than by a model.
 *
 * The scoring is a small BM25: term frequency saturating rather than growing
 * linearly, inverse document frequency so "rendition" — which is in most
 * articles — counts for less than "freeport", and length normalization so a
 * long article does not out-rank a short exact one on volume alone. Fields are
 * weighted, because a term in a title or a keyword is a much stronger signal
 * of aboutness than the same term buried in a body paragraph.
 *
 * Why not embeddings. This corpus is a few dozen curated articles, not a
 * document set — at that size lexical retrieval with a hand-written keyword
 * field beats a vector index on the queries that matter, and it beats it
 * decisively on the ones that name a statute. It also costs no API call, adds
 * no extension to the database, and returns the same articles for the same
 * question every time, which is the property that makes an answer checkable.
 * When the firm has a real document set worth searching, that is a second
 * retriever alongside this one rather than a replacement for it.
 *
 * The one thing this must never do is return nothing quietly. A query that
 * clears no article is a real answer — the corpus does not cover it — and the
 * caller is expected to say so rather than let the model fill the gap.
 */

/**
 * Words that would otherwise dominate a practice-domain query. Deliberately
 * short: "property", "tax" and "value" are *not* here, because although they
 * appear everywhere, IDF already discounts them, and dropping them outright
 * would break a query that is genuinely about one of them.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'should',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

/**
 * Split on everything but letters, digits, dots and hyphens, then trim the
 * punctuation off the ends.
 *
 * Keeping dots and hyphens inside a token is the whole point: a preparer types
 * "22.23(b)" or "25.25(c-1)", and a tokenizer that split on the dot would turn
 * the single most precise term in the query into two useless numbers.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.\-]+/)
    .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Field weights. A term in the title is worth five body occurrences. */
const FIELD_WEIGHTS = { title: 5, keywords: 4, authority: 3, topics: 2, body: 1 } as const;

const K1 = 1.2;
const B = 0.6;

interface Indexed {
  article: KnowledgeArticle;
  /** Weighted term frequencies, summed across fields. */
  frequencies: Map<string, number>;
  /** Weighted length, for the length-normalization term. */
  length: number;
}

function indexArticle(article: KnowledgeArticle): Indexed {
  const frequencies = new Map<string, number>();
  let length = 0;

  const add = (text: string, weight: number) => {
    for (const token of tokenize(text)) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + weight);
      length += weight;
    }
  };

  add(article.title, FIELD_WEIGHTS.title);
  add(article.keywords.join(' '), FIELD_WEIGHTS.keywords);
  add(article.authority.join(' '), FIELD_WEIGHTS.authority);
  add(article.topics.join(' '), FIELD_WEIGHTS.topics);
  add(article.body, FIELD_WEIGHTS.body);

  return { article, frequencies, length };
}

/**
 * Built once per process. The corpus is a module constant, so there is nothing
 * to invalidate — a deployment that changes an article ships a new process.
 */
interface Index {
  documents: Indexed[];
  /** term -> how many articles contain it. */
  documentFrequency: Map<string, number>;
  averageLength: number;
  byId: Map<string, KnowledgeArticle>;
}

let index: Index | null = null;

function getIndex(): Index {
  if (index) return index;
  const documents = KNOWLEDGE.map(indexArticle);
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / (documents.length || 1);
  index = {
    documents,
    documentFrequency,
    averageLength,
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

const DEFAULT_LIMIT = 4;
const DEFAULT_MIN_SCORE = 0.75;

export function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const { documents, documentFrequency, averageLength } = getIndex();
  const topics = options.topics?.length ? new Set(options.topics) : null;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const total = documents.length;

  const hits: KnowledgeHit[] = [];

  for (const document of documents) {
    if (topics && !document.article.topics.some((topic) => topics.has(topic))) continue;

    let score = 0;
    const matched: string[] = [];

    for (const term of new Set(terms)) {
      const frequency = document.frequencies.get(term);
      if (!frequency) continue;
      matched.push(term);
      const containing = documentFrequency.get(term) ?? 0;
      // The +0.5/+0.5 form keeps IDF positive even for a term every article
      // holds, so a common term still contributes rather than subtracting.
      const idf = Math.log(1 + (total - containing + 0.5) / (containing + 0.5));
      const normalized =
        frequency / (frequency + K1 * (1 - B + (B * document.length) / averageLength));
      score += idf * normalized;
    }

    if (matched.length === 0) continue;

    // A query whose terms nearly all land in one article is about that
    // article. Without this a long multi-topic question spreads its score
    // evenly and the most on-point piece does not surface first.
    score *= 1 + 0.4 * (matched.length / new Set(terms).size);

    if (score < minScore) continue;
    hits.push({ article: document.article, score, matched });
  }

  hits.sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id));
  return hits.slice(0, limit);
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
