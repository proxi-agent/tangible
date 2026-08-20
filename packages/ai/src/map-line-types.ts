import { z } from 'zod';
import { LINE_MAPPING_KEYS, classificationOptions } from '@tangible/classification';
import { MIXED_LINE_KEY } from '@tangible/types';
import type { RenditionScheduleKey } from '@tangible/types';
import { parseStructured } from './structured.js';

/**
 * Read the filer's schedule wording into our category vocabulary.
 *
 * Narrower than asset classification and harder in a different way. There is no
 * description to work from — just a few words a controller typed into a box,
 * often abbreviated past the point of grammar ("Mach & Equip", "F F & E", "Tele
 * /Ntwk"). What replaces the missing detail is context the asset classifier
 * never has: the schedule the line sits on, the years it was filed under, the
 * amount it carries, and — most usefully — *the other lines on the same return*.
 * A return that already breaks out "Furniture & Fixtures" and "Computers"
 * separately has told you what its third line called "Equipment" is not.
 *
 * The one answer this prompt works hardest to make available is `mixed`. A model
 * asked to pick a category will pick one, and a lumped line forced into a
 * category produces a comparison that looks precise and is fiction.
 */

const AnswerSchema = z.object({
  ref: z.number().int(),
  categoryKey: z.enum(LINE_MAPPING_KEYS).nullable(),
  confidence: z.number(),
  rationale: z.string(),
});

const BatchSchema = z.object({ answers: z.array(AnswerSchema) });

function systemPrompt(): string {
  const options = classificationOptions();
  const schedules = options.filter((o) => o.kind === 'schedule');
  const exclusions = options.filter((o) => o.kind === 'exclusion');

  return `You read the property-type wording off a filed Texas business personal property rendition (Comptroller Form 50-144) and say which category of ours it refers to.

Each line you are given is a row the taxpayer filed: a few words they wrote, a schedule letter, the years it covers, and the cost reported under it. Your job is to say what those words mean — nothing else. You are not judging whether they filed correctly; a later step compares your reading against the client's actual asset register and that comparison is where errors surface. Reading "Mach & Equip" as machinery is right even if it turns out half of it was computers.

CATEGORIES (property valued on a depreciation schedule):
${schedules.map((o) => `- ${o.key} — ${o.label}: ${o.description}`).join('\n')}

EXCLUSIONS (property that should not have been on this return at all):
${exclusions.map((o) => `- ${o.key} — ${o.label}: ${o.description}`).join('\n')}

BLENDED:
- ${MIXED_LINE_KEY} — the wording covers more than one category above and the form printed it as a single number, so it cannot be split. "Furniture, Fixtures & Equipment", "Office Equipment & Computers", "Machinery, Tools and Shop Equipment" are blended. So is a bare "Equipment", "Assets", "Personal Property", or "Misc" on a schedule that could hold several categories.

Choosing ${MIXED_LINE_KEY} is a real answer and often the correct one. A single category picked out of genuinely blended wording produces a false comparison that reads as precise, which is worse than saying the line cannot be placed. Do not reach for it to express uncertainty about wording you could resolve — reach for it when the words honestly span categories.

How to read them:
- Use the other lines on the same return. If a return separately lists "Furniture & Fixtures" and "Computers", then a third line saying "Equipment" is neither of those and is likely machinery. If a return has only one line, its wording carries all the weight and blending is more likely.
- Schedule E holds furniture, fixtures, machinery, equipment and computers. A Schedule E line naming inventory, supplies or a licensed vehicle is a misfiled line — map it to what the words say, not to what Schedule E usually holds, and note the discrepancy in the rationale.
- Schedule A is a lump for accounts under $20,000 and is usually blended unless the filer wrote one specific type.
- Servers, switches, routers, network and phone-system hardware read as telecom-8. Desktops, laptops, monitors and printers read as computer-pc. A line saying just "Computers" or "Computer Equipment" is computer-pc; a line saying "Computer & Network Equipment" is blended.
- "Leasehold improvements", "tenant improvements", "build-out" read as leasehold-improvements.
- Reach for an exclusion when the words plainly name something that is not the client's tangible personal property: capitalized software, a licence, leased or rented equipment, a building or its structural systems. These are the highest-value readings and every one of them goes to a person, so state the basis plainly.

confidence: your honest probability (0 to 1) that a Texas BPP specialist reading the same words would agree. Abbreviations you are inferring, wording that could plausibly be blended, and anything a second opinion would help with belong below 0.85 — those go to a reviewer, which is cheap. A confident wrong reading is not: it becomes the baseline a dollar-figure finding is measured against.

Answer for every ref you are given, exactly once.`;
}

export interface LineTypeRequest {
  ref: number;
  schedule: RenditionScheduleKey;
  /** The filer's wording, verbatim. */
  type: string;
  /** Years this wording was filed under, so a 1998 line reads differently from a 2025 one. */
  years: number[];
  /** Total cost reported under this wording, as scale. */
  reportedTotal: number | null;
}

export interface LineTypeAnswer {
  ref: number;
  categoryKey: string | null;
  confidence: number;
  rationale: string;
}

export interface LineTypeBatchResult {
  answers: LineTypeAnswer[];
  model: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function renderRow(row: LineTypeRequest): string {
  const parts = [
    `ref=${row.ref}`,
    `schedule=${row.schedule}`,
    `type=${JSON.stringify(row.type)}`,
  ];
  if (row.years.length > 0) {
    const sorted = [...new Set(row.years)].sort((a, b) => a - b);
    parts.push(
      `years=${sorted.length === 1 ? sorted[0] : `${sorted[0]}-${sorted[sorted.length - 1]} (${sorted.length} lines)`}`,
    );
  }
  if (row.reportedTotal !== null) parts.push(`reported=${money(row.reportedTotal)}`);
  return parts.join('  ');
}

/**
 * Map one return's distinct wordings in a single call.
 *
 * The whole return goes in one batch on purpose. Every row is context for every
 * other row — what a return breaks out separately is the strongest signal
 * available about what its vaguer lines mean — and splitting the batch would
 * throw that away. Returns carry a few dozen distinct types at most, even the
 * ones with a detail schedule attached, so this fits comfortably in one call.
 */
export async function mapLineTypes(
  rows: LineTypeRequest[],
  context: { businessDescription?: string | null; taxYear?: number | null } = {},
): Promise<LineTypeBatchResult> {
  const preamble: string[] = [];
  if (context.businessDescription) {
    preamble.push(
      `The filer's business: ${context.businessDescription}. Use this only to disambiguate wording — it does not decide a category on its own.`,
    );
  }
  if (context.taxYear) preamble.push(`This is the ${context.taxYear} return.`);

  const { parsed, model } = await parseStructured({
    system: systemPrompt(),
    user: [
      ...preamble,
      `These are all ${rows.length} distinct property-type wordings on one return. Read each one, using the others as context:`,
      rows.map(renderRow).join('\n'),
    ].join('\n\n'),
    schema: BatchSchema,
    schemaName: 'rendition_line_types',
    maxTokens: 8000,
    task: 'classification',
  });

  const asked = new Set(rows.map((row) => row.ref));
  const seen = new Set<number>();
  const answers: LineTypeAnswer[] = [];
  for (const answer of parsed.answers) {
    if (!asked.has(answer.ref) || seen.has(answer.ref)) continue;
    seen.add(answer.ref);
    answers.push({
      ref: answer.ref,
      categoryKey: answer.categoryKey,
      confidence: answer.confidence,
      rationale: answer.rationale,
    });
  }

  return { answers, model };
}

/**
 * A ceiling on one call. A return with more distinct wordings than this has an
 * asset-level detail schedule attached, and asking about every row of it in one
 * breath would be both worse and slower than chunking.
 */
export const LINE_TYPE_BATCH_SIZE = 60;
