import 'server-only';
import { z } from 'zod';
import {
  PRECEDENT_KINDS,
  precedentKindLabel,
  searchPrecedent,
  tallyPrecedent,
} from '@tangible/knowledge';
import { precedentCorpus } from '@/lib/precedent';
import { precedentCitation, tool, type AssistantTool } from './types';

/**
 * The firm's own prior work, searchable.
 *
 * The second retriever. `search_knowledge` answers "what does Texas require";
 * this answers "what have we argued, and what came of it" — and the two must
 * not be confused, so the description below spends most of its words on the
 * line between them. A model that cited a brief as though it were a statute
 * would be citing the firm's own guess back at itself with a confidence
 * neither of them earned.
 *
 * Why it is worth having at all: the acceptance model already learns from
 * outcomes, but it learns a *number* — the share of a claim a district
 * allowed. It cannot tell a preparer how the winning brief was worded, which
 * evidence the district refused to look at, or that this exact argument has
 * been tried twice in Dallas and lost both times. That is in the prose, and
 * until now the prose was written once and never read again.
 */

/** How much of one document's body the model is shown. */
const BODY_CHARS = 1_200;

/**
 * The runner clamps a whole tool result at six thousand characters. Four
 * briefs at full length would blow past that and the clamp would take the last
 * hits with it — silently, and in the order the retriever thought was worst.
 * So each body is cut here, where the cut can say it happened.
 */
function excerpt(body: string): string {
  return body.length <= BODY_CHARS ? body : `${body.slice(0, BODY_CHARS)}… (document continues)`;
}

export const precedentTools: AssistantTool[] = [
  tool({
    name: 'search_precedent',
    source: 'workspace',
    description: `Search the firm's own prior work: protest briefs it filed, 25.25 correction motions it brought, and the notes preparers left explaining why they took or left a finding — each joined to what became of it. Use this for "have we argued this before", "how did we word it", "what did the district say last time", and before drafting anything that resembles an argument the firm has made before. This is HISTORY, NOT AUTHORITY: never state a legal rule, deadline, or Tax Code requirement from a document this returns — those come only from search_knowledge. A brief in here may have been wrong, and losses are returned alongside wins on purpose, because an argument a district has already refused is the most useful thing this corpus holds. Always report the outcome beside anything you quote from it.`,
    args: z.object({
      query: z
        .string()
        .min(2)
        .describe(
          'What to look for, in the words a preparer would use — "idle equipment obsolescence", "freeport 175 days", "leasehold improvements".',
        ),
      kinds: z
        .array(z.enum(PRECEDENT_KINDS))
        .nullable()
        .describe('Narrow to these kinds of document, or null for all of them.'),
      district: z
        .string()
        .nullable()
        .describe(
          'Narrow to one appraisal district, matched on the name the documents carry. Null searches every district.',
        ),
      limit: z.number().int().min(1).max(8).nullable().describe('How many documents. Default 4.'),
    }),
    async run({ query, kinds, district, limit }) {
      const corpus = await precedentCorpus();

      // An empty corpus and an empty result mean completely different things —
      // "the firm has never written anything" versus "the firm has never
      // written about this" — and a model given only a zero-length array will
      // report the first when the truth is the second.
      if (corpus.documents.length === 0) {
        return {
          summary: 'Precedent: the firm has no briefs, motions or finding notes on file yet.',
          data: {
            documents: [],
            corpusSize: 0,
            note: 'Nothing has been drafted or decided yet, so there is no prior work to search. This is not evidence that the firm has never argued the point.',
          },
        };
      }

      const hits = searchPrecedent(corpus.documents, query, {
        kinds: kinds ?? undefined,
        district: district ?? undefined,
        limit: limit ?? 4,
      });
      const tally = tallyPrecedent(hits);

      const partial = corpus.truncated.length
        ? `Only the most recent documents of each kind were searched (${corpus.truncated.map(precedentKindLabel).join(', ')} hit the read limit), so an older document could exist and not be here.`
        : null;

      return {
        summary: hits.length
          ? `Precedent: ${hits.length} of ${corpus.documents.length} documents match "${query}" — ${tally.favorable} went the firm's way, ${tally.unfavorable} did not, ${tally.unresolved} were never answered.`
          : `Precedent: none of the firm's ${corpus.documents.length} documents match "${query}".`,
        data: {
          corpusSize: corpus.documents.length,
          tally,
          partial,
          documents: hits.map((hit) => ({
            id: hit.document.id,
            kind: hit.document.kind,
            kindLabel: precedentKindLabel(hit.document.kind),
            title: hit.document.title,
            client: hit.document.clientName,
            district: hit.document.district,
            taxYear: hit.document.taxYear,
            writtenOn: hit.document.writtenOn,
            outcome: hit.document.outcome,
            body: excerpt(hit.document.body),
            caution: 'The firm’s own prior work. Do not state a rule from it.',
          })),
        },
        citations: hits.map((hit) =>
          precedentCitation(
            hit.document.id,
            `${precedentKindLabel(hit.document.kind)}: ${hit.document.title}`,
            hit.document.href,
          ),
        ),
        // Every hit exposed one client's file, and the deletion sweep needs to
        // know which — a conversation that quoted a brief is a conversation
        // that holds that client's words.
        clientIds: [...new Set(hits.map((hit) => hit.document.clientId))],
      };
    },
  }),
];
