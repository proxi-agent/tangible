import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { activeProvider, defaultModel, getAnthropic, getOpenAI, type AiTask } from './client.js';

/**
 * One structured-output call, whichever provider is configured.
 *
 * Both features in this package want the same thing: a system prompt, some
 * text, and a Zod schema the answer must satisfy. Both providers can do exactly
 * that — Anthropic through `messages.parse` with `zodOutputFormat`, OpenAI
 * through `responses.parse` with `zodTextFormat` — and both enforce the schema
 * at the decode step rather than hoping the model returns valid JSON.
 *
 * Keeping the difference in this one file is what makes the provider a
 * configuration detail. The prompts, the schemas, the confidence bar and the
 * review queue are all written once and do not know which model answered.
 *
 * The schemas that reach here must use `.nullable()` rather than `.optional()`.
 * Both providers' strict modes require every property to be present, so an
 * optional field is rejected outright — null is how "no answer" is spelled.
 *
 * A request may also carry a **document**. Renditions and assessment notices
 * arrive as PDFs and, more often, as photographs of paper, and both providers
 * read those natively — PDF pages and images alike. That is why there is no OCR
 * step and no PDF text-extraction dependency anywhere in this repo: a scanned
 * form with a coffee ring on it is exactly the case a text extractor fails at
 * and a vision model does not.
 */

/** A file for the model to read: a filed form, a notice, a photograph of one. */
export interface StructuredDocument {
  /** Shown to the model, and worth being real — filenames carry the year and the form number. */
  filename: string;
  /** `application/pdf`, `image/png`, `image/jpeg`. */
  mediaType: string;
  /** Base64, without a data: prefix. */
  data: string;
}

export interface StructuredResult<T> {
  parsed: T;
  /**
   * The model that answered, recorded on the row it produced. Bare model ids
   * already name their provider unambiguously (`gpt-5.5` vs `claude-opus-5`),
   * so a classification stays attributable after a provider switch.
   */
  model: string;
}

/**
 * OpenAI's reasoning models spend output tokens on reasoning before they emit a
 * single visible character, and `max_output_tokens` covers both. A ceiling
 * sized for the answer alone gets a long batch truncated mid-JSON, which the
 * parser then reports as an unparseable response rather than as what it is.
 */
const REASONING_HEADROOM = 24_000;

export async function parseStructured<S extends z.ZodType>(request: {
  system: string;
  user: string;
  schema: S;
  /** Model-visible name for the schema. OpenAI requires one; Anthropic ignores it. */
  schemaName: string;
  maxTokens: number;
  /** Which call this is — decides the model tier. See `AiTask`. */
  task: AiTask;
  /** A file to read alongside the prompt. */
  document?: StructuredDocument;
}): Promise<StructuredResult<z.infer<S>>> {
  const provider = activeProvider();
  if (!provider) {
    // Callers are expected to check `isAiConfigured()` and take the manual
    // path; reaching here is a bug rather than a configuration state.
    throw new Error('No AI provider is configured.');
  }
  const model = defaultModel(provider, request.task);

  if (provider === 'anthropic') {
    const doc = request.document;
    // The document goes *before* the instructions. Both providers attend better
    // to a long instruction that follows the material it is about, and a form
    // this dense needs the reading task framed after the page, not before it.
    const content = doc
      ? [
          doc.mediaType === 'application/pdf'
            ? {
                type: 'document' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'application/pdf' as const,
                  data: doc.data,
                },
              }
            : {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: doc.mediaType as 'image/png' | 'image/jpeg',
                  data: doc.data,
                },
              },
          { type: 'text' as const, text: request.user },
        ]
      : request.user;

    const response = await getAnthropic().messages.parse({
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(request.schema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('The model returned no parseable structured output.');
    return { parsed: parsed as z.infer<S>, model };
  }

  const doc = request.document;
  const input = doc
    ? [
        {
          role: 'user' as const,
          content: [
            doc.mediaType === 'application/pdf'
              ? {
                  type: 'input_file' as const,
                  filename: doc.filename,
                  file_data: `data:${doc.mediaType};base64,${doc.data}`,
                }
              : {
                  type: 'input_image' as const,
                  image_url: `data:${doc.mediaType};base64,${doc.data}`,
                  detail: 'high' as const,
                },
            { type: 'input_text' as const, text: request.user },
          ],
        },
      ]
    : request.user;

  const response = await getOpenAI().responses.parse({
    model,
    instructions: request.system,
    input,
    max_output_tokens: request.maxTokens + REASONING_HEADROOM,
    text: { format: zodTextFormat(request.schema, request.schemaName) },
  });
  const parsed = response.output_parsed;
  if (!parsed) {
    // `incomplete` almost always means the ceiling above was still too low, and
    // saying so beats a bare "no output" that sends someone prompt-hunting.
    const detail =
      response.status === 'incomplete'
        ? ` The response was cut short (${response.incomplete_details?.reason ?? 'unknown reason'}).`
        : '';
    throw new Error(`The model returned no parseable structured output.${detail}`);
  }
  return { parsed: parsed as z.infer<S>, model };
}
