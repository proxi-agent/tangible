import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * One place decides whether AI features exist in this deployment, and which
 * model provider serves them.
 *
 * Everything that calls a model checks `isAiConfigured()` first and degrades to
 * the manual path when it is false — the same optional-dependency posture the
 * app takes with Supabase. A missing key must never take a screen down; it only
 * removes the proposal step and sends the work to a human instead.
 *
 * Two providers are supported because the key you have and the key you want are
 * not always the same one. The seam is here rather than at each call site, so
 * swapping is configuration: set the other key and restart. Everything
 * downstream — prompts, schemas, the confidence bar, the review queue — is
 * provider-agnostic and does not change.
 */

export type AiProvider = 'anthropic' | 'openai';

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY);
const hasOpenai = () => Boolean(process.env.OPENAI_API_KEY);

/**
 * Which provider answers, or null when neither is configured.
 *
 * `AI_PROVIDER` forces one — useful for comparing the two on the same register
 * without moving keys around. Otherwise Anthropic wins when both are present:
 * the prompts in this package were written and tuned against Claude, so it is
 * the known quantity, and a deployment that has just added its Anthropic key
 * should start using it without also having to remove the old one.
 */
export function activeProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === 'anthropic') return hasAnthropic() ? 'anthropic' : null;
  if (forced === 'openai') return hasOpenai() ? 'openai' : null;
  if (hasAnthropic()) return 'anthropic';
  if (hasOpenai()) return 'openai';
  return null;
}

export function isAiConfigured(): boolean {
  return activeProvider() !== null;
}

/**
 * Why AI is unavailable, in words a person can act on. Centralized because it
 * surfaces in three places — the propose route, the classification rationale,
 * and the run summary — and they must not drift into naming different keys.
 */
export function aiUnavailableReason(): string {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === 'anthropic' && !hasAnthropic()) {
    return 'AI_PROVIDER is set to anthropic but ANTHROPIC_API_KEY is not set.';
  }
  if (forced === 'openai' && !hasOpenai()) {
    return 'AI_PROVIDER is set to openai but OPENAI_API_KEY is not set.';
  }
  return 'Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set in this deployment.';
}

export function getAnthropic(): Anthropic {
  if (!hasAnthropic()) throw new Error(aiUnavailableReason());
  anthropicClient ??= new Anthropic();
  return anthropicClient;
}

export function getOpenAI(): OpenAI {
  if (!hasOpenai()) throw new Error(aiUnavailableReason());
  openaiClient ??= new OpenAI();
  return openaiClient;
}

/**
 * The two model calls in this product, which have very different economics.
 *
 * `mapping` runs **once per uploaded file** — a handful of calls a season, and
 * the one place a mistake is unrecoverable: a cost column mapped to net book
 * value poisons every number downstream and no later review looks at it again.
 * `classification` runs once per distinct asset description and is what scales
 * with register size, so it is where spend actually accumulates — and it is
 * also the call the review queue backstops, because anything the model is
 * unsure about goes to a person instead of being applied.
 *
 * `extraction` reads a filed rendition or an assessment notice — usually a
 * scan, often a bad one. It runs once per document and shares mapping's
 * economics exactly: a handful of calls a season, and a misread figure becomes
 * the baseline every later finding is measured against. It gets the strong tier
 * for that reason, and unlike the other two it is checked afterwards — the
 * schedules have to foot, so a weak model is caught rather than believed.
 *
 * They therefore get separate knobs. Running classification cheap and mapping
 * careful is a sensible place to land, and neither choice is buried in code.
 */
export type AiTask = 'mapping' | 'classification' | 'extraction';

/**
 * Model defaults, cheapest-tier first.
 *
 * The low tier is safe here specifically because of the confidence bar: a
 * weaker model that knows it is unsure costs review time, not wrong numbers.
 * What it must not be is *confidently* wrong, so measure calibration before
 * trusting a tier rather than assuming it — see the README.
 */
const OPENAI_DEFAULT = 'gpt-5.4-nano';
const ANTHROPIC_DEFAULT = 'claude-haiku-4-5';

/** The strong model for the once-per-file call, where being wrong is permanent. */
const OPENAI_MAPPING_DEFAULT = 'gpt-5.5';
const ANTHROPIC_MAPPING_DEFAULT = 'claude-opus-5';

/** Reading a scanned form is vision work on a document nobody will re-read. */
const OPENAI_EXTRACTION_DEFAULT = 'gpt-5.5';
const ANTHROPIC_EXTRACTION_DEFAULT = 'claude-opus-5';

export function defaultModel(
  provider: AiProvider = activeProvider() ?? 'anthropic',
  task: AiTask = 'classification',
): string {
  if (provider === 'anthropic') {
    if (task === 'extraction') {
      return (
        process.env.ANTHROPIC_EXTRACTION_MODEL ??
        process.env.ANTHROPIC_MODEL ??
        ANTHROPIC_EXTRACTION_DEFAULT
      );
    }
    if (task === 'mapping') {
      return (
        process.env.ANTHROPIC_MAPPING_MODEL ??
        process.env.ANTHROPIC_MODEL ??
        ANTHROPIC_MAPPING_DEFAULT
      );
    }
    return process.env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT;
  }
  if (task === 'extraction') {
    return (
      process.env.OPENAI_EXTRACTION_MODEL ?? process.env.OPENAI_MODEL ?? OPENAI_EXTRACTION_DEFAULT
    );
  }
  if (task === 'mapping') {
    return process.env.OPENAI_MAPPING_MODEL ?? process.env.OPENAI_MODEL ?? OPENAI_MAPPING_DEFAULT;
  }
  return process.env.OPENAI_MODEL ?? OPENAI_DEFAULT;
}
