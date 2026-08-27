import 'server-only';
import type { z } from 'zod';
import type { AssistantCitation } from '@tangible/types';

/**
 * What a tool is on this surface.
 *
 * Every one of them reads. There is no write path here and there is not meant
 * to be one: the assistant explains the record and points into it, and a
 * person still records the filing, decides the finding, and sends the letter.
 * That is not timidity about model reliability — it is that every one of those
 * actions already has a screen with a gate in front of it, and a second way in
 * that skips the gate is how a season gets a rendition nobody chose to file.
 *
 * `args` is a Zod schema and it does two jobs: it becomes the JSON Schema the
 * model is shown, and it validates what comes back before the executor runs.
 * The model is a caller like any other and gets no more trust than one.
 *
 * `citations` is the tool's own account of what its result can back. The
 * composing model may only cite refs that appeared here, and code drops the
 * rest — the same discipline ask-the-graph applies to references, which is
 * what keeps an answer's links from pointing at screens that do not exist.
 */
export interface AssistantToolResult {
  /** One line, shown in the transcript. What was looked up and what came back. */
  summary: string;
  /** The result itself. Serialized for the model, frozen on the turn. */
  data: unknown;
  citations?: AssistantCitation[];
  /** Clients whose record this result exposed. Drives the deletion sweep. */
  clientIds?: string[];
}

export interface AssistantTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Model-visible, and the only thing it knows about the tool. Say when to use it. */
  description: string;
  args: S;
  /** Which of the three sources this reads. Shown in the transcript. */
  source: 'workspace' | 'market' | 'knowledge';
  run(args: z.infer<S>): Promise<AssistantToolResult>;
}

/** Narrowing helper so a registry of differently-typed tools stays one array. */
export function tool<S extends z.ZodType>(definition: AssistantTool<S>): AssistantTool {
  return definition as AssistantTool;
}

export const workspaceCitation = (ref: string, label: string): AssistantCitation => ({
  kind: 'workspace',
  ref,
  label,
  href: ref,
});

export const marketCitation = (ref: string, label: string): AssistantCitation => ({
  kind: 'market',
  ref,
  label,
  href: ref,
});

/** Knowledge has no screen to link to; the ref is the article id. */
export const knowledgeCitation = (ref: string, label: string): AssistantCitation => ({
  kind: 'knowledge',
  ref,
  label,
  href: null,
});
