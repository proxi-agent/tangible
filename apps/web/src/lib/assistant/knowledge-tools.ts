import 'server-only';
import { z } from 'zod';
import { KNOWLEDGE_JURISDICTIONS, KNOWLEDGE_TOPICS, searchKnowledge } from '@tangible/knowledge';
import { knowledgeCitation, tool, type AssistantTool } from './types';

/**
 * The statutory and product corpus, searched.
 *
 * One tool rather than several, because the corpus is small enough that a
 * topic filter is all the narrowing it needs, and because the alternative — a
 * tool per topic — would teach the model to pick a topic before it knows what
 * the question is about.
 *
 * The description is emphatic about this being the only source of statute on
 * purpose. A model asked about Tax Code 22.30 will happily answer from what it
 * remembers, and what it remembers is approximately right, which is the worst
 * possible failure mode for a deadline.
 *
 * The `jurisdiction` argument is the one piece of narrowing the model must not
 * skip. Since Florida entered the corpus there are two right answers to "when
 * is the return due" two weeks apart, and lexical retrieval cannot tell them
 * apart — "extension", "deadline" and "penalty" are the same words in both
 * states. Unset searches everything, which is correct for a general question
 * and dangerous inside an engagement, so the description tells the model where
 * to find the state before it asks: the site's `stateCode`, from the workspace
 * tools.
 *
 * The `method` topic is the newest and the one a model is least likely to
 * think of searching, because the questions that need it do not sound like
 * legal questions: what a ghost asset is, why a finding says low confidence,
 * why a screening question carries no dollar figure. Those have exact answers
 * in this repository — thresholds, signed weights, a base rate per detector —
 * and a model answering them from what it generally believes about fixed asset
 * audits will be fluent and wrong about its own product. The description says
 * so plainly rather than trusting the topic name to suggest it.
 */
export const knowledgeTools: AssistantTool[] = [
  tool({
    name: 'search_knowledge',
    source: 'knowledge',
    description: `Search Tangible's curated corpus on business personal property tax in Texas and Florida, on how this product works, and on how its analysis reads a register. This is the ONLY acceptable source for statutory rules, deadlines, penalties, exemptions, protest and correction procedure, for how the app's own screens behave, and for what any finding means — what a ghost asset is, what a detector claims, what a confidence tier licenses, what would settle a screening question. Search it before defining a term this product uses, even a familiar-sounding one: "ghost asset" here means a recorded disposal specifically, and the general industry usage is wider. Never state a rule or cite a Tax Code section you did not get from this tool. Search it whenever the question turns on what is required or permitted, even if you believe you know the answer. Returns whole articles with their authorities and the state each one states the law of; an empty result means the corpus does not cover the question, which is itself worth reporting. ALWAYS pass \`jurisdiction\` when you know which state the property is in — the two states' rules use the same words and different dates, and an unfiltered search can return Florida's answer to a Texas question. The site's stateCode from the workspace tools is where that comes from.`,
    args: z.object({
      query: z
        .string()
        .min(2)
        .describe(
          'What to look up, in the words of the question. Statute numbers work — "22.23(b)", "25.25(c-1)".',
        ),
      topics: z
        .array(z.enum(KNOWLEDGE_TOPICS))
        .nullable()
        .describe('Narrow to these topics, or null for the whole corpus.'),
      jurisdiction: z
        .enum(KNOWLEDGE_JURISDICTIONS)
        .nullable()
        .describe(
          'The state whose law is being asked about — "tx" or "fl". Null only when the question is about the product itself or is genuinely state-agnostic. Articles that are true everywhere are returned either way.',
        ),
      limit: z.number().int().min(1).max(8).nullable().describe('How many articles. Default 4.'),
    }),
    async run({ query, topics, jurisdiction, limit }) {
      const hits = searchKnowledge(query, {
        topics: topics ?? undefined,
        jurisdictions: jurisdiction ? [jurisdiction] : undefined,
        limit: limit ?? 4,
      });
      return {
        summary: hits.length
          ? `Knowledge: ${hits.length} article(s) for "${query}" — ${hits.map((hit) => hit.article.id).join(', ')}.`
          : `Knowledge: nothing in the corpus matches "${query}".`,
        data: hits.map((hit) => ({
          id: hit.article.id,
          title: hit.article.title,
          topics: hit.article.topics,
          // Absent means the article is true in every state — the product
          // ones, mostly. It never means the state is unknown.
          jurisdiction: hit.article.jurisdiction ?? null,
          // Empty for the product articles, and the composing prompt is told
          // what that means: it describes Tangible, not a state's law.
          authority: hit.article.authority,
          body: hit.article.body,
          related: hit.article.related ?? [],
        })),
        citations: hits.map((hit) =>
          knowledgeCitation(
            hit.article.id,
            hit.article.authority[0]
              ? `${hit.article.title} (${hit.article.authority[0]})`
              : hit.article.title,
          ),
        ),
      };
    },
  }),
];
