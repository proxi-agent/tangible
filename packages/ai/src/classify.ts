import { z } from 'zod';
import { CLASSIFICATION_KEYS, classificationOptions } from '@tangible/classification';
import { LIFE_CLASSES } from '@tangible/valuation';
import { parseStructured } from './structured.js';

/**
 * Classify asset descriptions into the district's schedule categories.
 *
 * The model gets the district's own category definitions, the register's words,
 * and nothing else — no cost-based hinting, no "most assets are machinery"
 * prior. It answers with a category, an honest confidence, and one sentence of
 * reasoning that a reviewer can disagree with.
 *
 * What it does not do is decide anything. Above the confidence bar its answer
 * stands until someone looks; below it, or for any exclusion, an asset waits in
 * the review queue. See `@tangible/classification` for where that line sits and
 * why.
 */

const LIFE_CLASS_VALUES = LIFE_CLASSES.map(String);

const AnswerSchema = z.object({
  /** Echoes the input ref so answers cannot be matched up by position alone. */
  ref: z.number().int(),
  categoryKey: z.enum(CLASSIFICATION_KEYS).nullable(),
  /**
   * A life in years, as a string so the enum stays closed. Non-null only where
   * the description names an equipment type whose life differs from the
   * category default — a SIC-driven machinery life, mostly.
   */
  lifeClassOverride: z.enum(LIFE_CLASS_VALUES as [string, ...string[]]).nullable(),
  confidence: z.number(),
  rationale: z.string(),
});

const BatchSchema = z.object({ answers: z.array(AnswerSchema) });

function systemPrompt(): string {
  const options = classificationOptions();
  const schedules = options.filter((o) => o.kind === 'schedule');
  const exclusions = options.filter((o) => o.kind === 'exclusion');

  return `You classify fixed-asset rows for a Texas business personal property rendition. Each row gets exactly one category, which decides the depreciation schedule the appraisal district values it on — so the category is worth real money and a plausible-but-wrong one is worse than an honest "unsure".

CATEGORIES (property that is rendered and valued on a schedule):
${schedules.map((o) => `- ${o.key} — ${o.label}: ${o.description}`).join('\n')}

EXCLUSIONS (property that does not belong on this rendition at all):
${exclusions.map((o) => `- ${o.key} — ${o.label}: ${o.description}`).join('\n')}

Rules that decide the cases registers actually get wrong:
- Servers, switches, routers, racks holding network gear, and phone-system hardware are telecom-8 — NOT computer-pc. computer-pc is desktops, laptops, monitors, keyboards, printers, scanners, and other input/output devices.
- Point-of-sale registers and mainframes are computer-mainframe. PBX systems, two-way radios, cell phones, and fax machines are specific-equipment.
- "Licensed vehicle" means it carries plates and drives on a road: cars, pickups, vans, road tractors, trailers. Forklifts, yard trucks, skid steers, and other off-road equipment are machinery-equipment.
- Tenant build-out — interior walls, flooring, ceilings, lighting, cabinetry installed in leased space — is leasehold-improvements, not furniture-fixtures and not real property.
- Anything held for sale or consumption (finished goods, raw materials, shop supplies, consumables) is inventory, valued at full cost with no depreciation.
- Reach for an exclusion when the row is not the client's tangible personal property: a building or its structural systems, a software licence or capitalized implementation labour, or equipment leased in from a lessor. These are the findings that matter most, so state the basis plainly in the rationale.
- When the register's own category or GL account contradicts the description, say so in the rationale and lower the confidence. The description usually wins, but not silently.

lifeClassOverride: leave it null unless the description names equipment whose life clearly differs from the category default. Do not use it to express uncertainty about the category.

confidence: your honest probability (0 to 1) that a Texas BPP specialist reviewing this row would agree. A generic description ("Equipment", "Misc", "Project 4412"), a conflict between the description and the register's category, or a choice you would want a second opinion on belongs below 0.85. Do not inflate: everything below that bar goes to a human, which is a cheap outcome, while a wrong confident answer reaches a signed form.

Answer for every ref you are given, exactly once.`;
}

export interface ClassificationRequest {
  ref: number;
  description: string | null;
  registerCategory: string | null;
  glAccount: string | null;
  usefulLife: string | null;
  /** Included only as context for what kind of thing this is, never as a basis. */
  acquisitionYear: number | null;
}

export interface ClassificationAnswer {
  ref: number;
  categoryKey: string | null;
  lifeClassOverride: number | null;
  confidence: number;
  rationale: string;
}

function renderRow(row: ClassificationRequest): string {
  const parts = [`ref=${row.ref}`, `description=${JSON.stringify(row.description ?? '')}`];
  if (row.registerCategory) parts.push(`register_category=${JSON.stringify(row.registerCategory)}`);
  if (row.glAccount) parts.push(`gl_account=${JSON.stringify(row.glAccount)}`);
  if (row.usefulLife) parts.push(`book_life=${JSON.stringify(row.usefulLife)}`);
  if (row.acquisitionYear !== null) parts.push(`acquired=${row.acquisitionYear}`);
  return parts.join('  ');
}

export interface ClassificationBatchResult {
  answers: ClassificationAnswer[];
  model: string;
}

/**
 * Classify one batch of distinct asset descriptions.
 *
 * Callers deduplicate first — a register with 400 identical office chairs is
 * one question, not 400 — and match answers back by `ref`. An answer for a ref
 * that was not asked about is dropped; a ref that comes back twice keeps the
 * first. A ref with no answer is simply absent, and the caller queues it rather
 * than inventing one.
 */
export async function classifyBatch(
  rows: ClassificationRequest[],
): Promise<ClassificationBatchResult> {
  const { parsed, model } = await parseStructured({
    system: systemPrompt(),
    user: `Classify these ${rows.length} asset rows:\n\n${rows.map(renderRow).join('\n')}`,
    schema: BatchSchema,
    schemaName: 'asset_classifications',
    maxTokens: 16000,
    task: 'classification',
  });

  const asked = new Set(rows.map((row) => row.ref));
  const seen = new Set<number>();
  const answers: ClassificationAnswer[] = [];
  for (const answer of parsed.answers) {
    if (!asked.has(answer.ref) || seen.has(answer.ref)) continue;
    seen.add(answer.ref);
    answers.push({
      ref: answer.ref,
      categoryKey: answer.categoryKey,
      lifeClassOverride:
        answer.lifeClassOverride === null ? null : Number(answer.lifeClassOverride),
      confidence: answer.confidence,
      rationale: answer.rationale,
    });
  }

  return { answers, model };
}

/**
 * How many rows go in one call. Small enough that a failed batch loses little
 * and the model keeps every row in view; large enough that a 2,000-line
 * register is a handful of calls rather than hundreds.
 */
export const CLASSIFY_BATCH_SIZE = 40;
