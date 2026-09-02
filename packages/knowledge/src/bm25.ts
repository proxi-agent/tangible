/**
 * The scoring, separated from the thing being scored.
 *
 * There are two corpora in this product and they have almost nothing in
 * common. One is a few dozen curated articles about what Texas requires,
 * committed to the repository and identical for every firm. The other is a
 * firm's own prior work — briefs it filed, motions it brought, notes a
 * preparer left on a finding — which arrives from the database, changes every
 * week, and is true of nobody else. What they share is the retrieval: a
 * preparer types a phrase, and something has to decide which documents are
 * about it.
 *
 * So the arithmetic lives here and the corpora live elsewhere. This is BM25
 * with weighted fields: term frequency that saturates rather than growing
 * linearly, inverse document frequency so a term in every document counts for
 * less than a rare one, and length normalization so a long document does not
 * out-rank a short exact one on volume alone. A term in a title is worth
 * several occurrences in a body, which is the caller's decision to make —
 * fields arrive already weighted.
 *
 * Nothing here calls a model, and that is not a placeholder. Lexical retrieval
 * costs no API call, adds no extension to the database, and returns the same
 * documents for the same question every time. The last of those is what makes
 * an answer checkable: a preparer who disagrees with a citation can rerun the
 * search and see what the model saw.
 */

/**
 * Words that would otherwise dominate a practice-domain query. Deliberately
 * short: "property", "tax" and "value" are *not* here, because although they
 * appear everywhere, IDF already discounts them, and dropping them outright
 * would break a query that is genuinely about one of them.
 *
 * "get" is the one light verb on the list, and it is here because IDF works
 * against us on it: it is rare enough in a corpus written in statutory prose
 * to score like a real term, so "how do we get an extension" ranked an article
 * that happened to contain "does not get in through this door" above the
 * extension article itself. Rare and meaningless is the worst combination a
 * term can have.
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
  'get',
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
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.-]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** A piece of a document and how much a match in it is worth. */
export interface WeightedField {
  text: string;
  weight: number;
}

/** Anything searchable: an id to hand back, and text the caller has weighted. */
export interface Retrievable {
  id: string;
  fields: readonly WeightedField[];
}

const K1 = 1.2;
const B = 0.6;

interface Indexed {
  id: string;
  /** Weighted term frequencies, summed across fields. */
  frequencies: Map<string, number>;
  /** Weighted length, for the length-normalization term. */
  length: number;
}

export interface Bm25Index {
  documents: Indexed[];
  /** term -> how many documents contain it. */
  documentFrequency: Map<string, number>;
  averageLength: number;
}

export function buildIndex(items: readonly Retrievable[]): Bm25Index {
  const documents = items.map((item) => {
    const frequencies = new Map<string, number>();
    let length = 0;
    for (const field of item.fields) {
      for (const token of tokenize(field.text)) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + field.weight);
        length += field.weight;
      }
    }
    return { id: item.id, frequencies, length };
  });

  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    documents,
    documentFrequency,
    averageLength:
      documents.reduce((total, document) => total + document.length, 0) / (documents.length || 1),
  };
}

export interface ScoredHit {
  id: string;
  score: number;
  /** The query terms that actually hit. Shown when explaining a retrieval. */
  matched: string[];
}

export interface ScoreOptions {
  limit?: number;
  /**
   * Score a hit must clear. Tuned so an unrelated question — "what's the
   * weather" — returns nothing rather than the least-bad document, which is
   * the behaviour that lets the caller honestly say the corpus is silent.
   */
  minScore?: number;
  /**
   * Narrowing, applied per document before it is scored.
   *
   * It deliberately does *not* rebuild the index over the subset. IDF is a
   * statement about the corpus, not about the filtered slice, and recomputing
   * it after a narrowing would rescale every score — a term common in the
   * whole corpus but rare among, say, the correction motions would suddenly
   * look precise, and `minScore` would mean something different for every
   * filter. So the same document scores the same number whether it was
   * reached through a filter or not.
   */
  where?: (id: string) => boolean;
}

const DEFAULT_LIMIT = 4;
const DEFAULT_MIN_SCORE = 0.75;

export function scoreIndex(
  index: Bm25Index,
  query: string,
  options: ScoreOptions = {},
): ScoredHit[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const total = index.documents.length;
  const hits: ScoredHit[] = [];

  for (const document of index.documents) {
    if (options.where && !options.where(document.id)) continue;

    let score = 0;
    const matched: string[] = [];

    for (const term of terms) {
      const frequency = document.frequencies.get(term);
      if (!frequency) continue;
      matched.push(term);
      const containing = index.documentFrequency.get(term) ?? 0;
      // The +0.5/+0.5 form keeps IDF positive even for a term every document
      // holds, so a common term still contributes rather than subtracting.
      const idf = Math.log(1 + (total - containing + 0.5) / (containing + 0.5));
      const normalized =
        frequency / (frequency + K1 * (1 - B + (B * document.length) / index.averageLength));
      score += idf * normalized;
    }

    if (matched.length === 0) continue;

    // A query whose terms nearly all land in one document is about that
    // document. Without this a long multi-topic question spreads its score
    // evenly and the most on-point piece does not surface first.
    score *= 1 + 0.4 * (matched.length / terms.size);

    if (score < minScore) continue;
    hits.push({ id: document.id, score, matched });
  }

  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}
