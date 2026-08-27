import 'server-only';
import { z } from 'zod';
import { KNOWLEDGE_TOPICS, searchKnowledge } from '@tangible/knowledge';
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
 */
export const knowledgeTools: AssistantTool[] = [
  tool({
    name: 'search_knowledge',
    source: 'knowledge',
    description: `Search Tangible's curated corpus on Texas business personal property tax and on how this product works. This is the ONLY acceptable source for statutory rules, deadlines, penalties, exemptions, protest and correction procedure, and for how the app's own screens behave. Never state a rule or cite a Tax Code section you did not get from this tool. Search it whenever the question turns on what is required or permitted, even if you believe you know the answer. Returns whole articles with their authorities; an empty result means the corpus does not cover the question, which is itself worth reporting.`,
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
      limit: z.number().int().min(1).max(8).nullable().describe('How many articles. Default 4.'),
    }),
    async run({ query, topics, limit }) {
      const hits = searchKnowledge(query, {
        topics: topics ?? undefined,
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
          // Empty for the product articles, and the composing prompt is told
          // what that means: it describes Tangible, not Texas law.
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
