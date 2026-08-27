/**
 * The shape of a thing the assistant is allowed to know without being told.
 *
 * Everything else the assistant answers from is *this firm's record* — a
 * register, a filing, a notice — fetched at question time and true only of one
 * client. This corpus is the other half: what is true of Texas business
 * personal property regardless of whose engagement is open. Statutory
 * deadlines, what a penalty is charged on, which correction route survives a
 * protest, how a district's schedules arrive at a value.
 *
 * It is committed data rather than a retrieved document set, and that is a
 * deliberate trade. A curated corpus is reviewable in a diff, cannot drift
 * from the code that implements the same rule, and answers the same way twice.
 * A vector store over uploaded PDFs would recall more paraphrases and would
 * also let an unreviewed sentence about a deadline reach a preparer. When the
 * firm has documents worth retrieving, they belong beside this — not instead
 * of it.
 *
 * Every article carries its `authority`. An answer that cites an article is
 * citing the statute through it, and the assistant is instructed to print that
 * authority rather than the article's id, so a reader can go check.
 */

/** Which part of the practice an article speaks to. Used to narrow retrieval. */
export const KNOWLEDGE_TOPICS = [
  /** What must be rendered, when, and by whom. */
  'rendition',
  /** The statutory calendar and how dates are observed. */
  'deadlines',
  /** 22.28's 10%, 22.29's 50%, and the waiver window. */
  'penalties',
  /** 22.23(b) and what a request actually moves. */
  'extensions',
  /** Chapter 41: the notice, the window, the hearing, the endings. */
  'protest',
  /** 25.25: what is left after the protest window shuts. */
  'corrections',
  /** Cost, index factor, percent good — how a value is arrived at. */
  'valuation',
  /** Freeport, interstate allocation, the $125,000 exemption. */
  'exemptions',
  /** Reading a register: what is BPP, what is real property, what is nothing. */
  'classification',
  /** Form 50-162, Tax Code 1.111, who may sign what. */
  'agents',
  /** Confidentiality, and what the district may and may not show. */
  'confidentiality',
  /** The public appraisal roll: what the county files hold and omit. */
  'county-data',
  /** How this product works — what a screen means, what a status implies. */
  'product',
] as const;

export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

export interface KnowledgeArticle {
  /** Stable, human-readable, and cited by the assistant. Never renumber one. */
  id: string;
  title: string;
  topics: readonly KnowledgeTopic[];
  /**
   * The statute, form, or published source this rests on, written the way it
   * should appear in an answer: "Tax Code 22.23(b)", "Form 50-144", "HCAD
   * 2026 Personal Property Valuation Guide".
   *
   * Empty only for `product` articles, which rest on this repo instead.
   */
  authority: readonly string[];
  /**
   * Words a preparer would use that the body may not contain. Retrieval is
   * term-based, so this is where "ghost assets", "double-taxed", "penalty
   * waiver" earn their way to the right article.
   */
  keywords: readonly string[];
  /** The article itself. Plain prose — no markdown, because it is prompt text. */
  body: string;
  /** Other article ids worth reading with it. Rendered as follow-ups. */
  related?: readonly string[];
}

/** One article, with the score that selected it and why it matched. */
export interface KnowledgeHit {
  article: KnowledgeArticle;
  score: number;
  /** The query terms that actually hit. Shown when explaining a retrieval. */
  matched: readonly string[];
}
