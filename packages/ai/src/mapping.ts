import { z } from 'zod';
import {
  CANONICAL_ASSET_FIELDS,
  CANONICAL_FIELD_INFO,
  type FarMappingProposal,
  type MappingVerification,
  type SheetSummary,
} from '@tangible/types';
import { verifyMapping, type ParsedWorkbook, type VerifyResult } from '@tangible/far';
import { parseStructured } from './structured.js';

/**
 * Propose a column mapping for an uploaded fixed asset register.
 *
 * The model sees exactly the preview a human reviewer sees — same rows, same
 * strings — and returns a structured proposal validated against the Zod schema.
 * The proposal is advice: nothing is normalized until a person confirms it, and
 * the sanitize pass below keeps a hallucinated sheet name or column index from
 * ever reaching the review screen as if it were real.
 */

// Mirrors FarMappingProposalSchema, but with `nullable` in place of `optional`:
// structured outputs want every field present, and null is an honest "no note".
const ProposalOutputSchema = z.object({
  sheets: z.array(
    z.object({
      sheetName: z.string(),
      include: z.boolean(),
      headerRow: z.number().int().nullable(),
      columns: z.array(
        z.object({
          index: z.number().int(),
          field: z.enum(CANONICAL_ASSET_FIELDS).nullable(),
          note: z.string().nullable(),
        }),
      ),
      categoryFromBands: z.boolean(),
    }),
  ),
  confidence: z.number(),
  rationale: z.string(),
});

const SYSTEM = `You map fixed asset register (FAR) spreadsheets onto a canonical asset schema for business personal property tax analysis. You see each sheet's first rows exactly as uploaded.

The canonical fields:
${CANONICAL_ASSET_FIELDS.map((f) => `- ${f}: ${CANONICAL_FIELD_INFO[f].description}`).join('\n')}

Rules, learned from how these files actually go wrong:
- Map original/historical/acquired cost to originalCost. NEVER map net book value, market value, or basis-after-writedowns there — a wrong cost column poisons every downstream number. When only NBV exists, map it to netBookValue and leave originalCost unmapped.
- Exclude sheets that are not asset listings: summaries, rollforwards (opening/additions/disposals/closing), instructions, pivot outputs. Set include=false and say why in the rationale.
- headerRow is the 0-based row holding the column headers; title rows above it are common. null means the sheet has no header row.
- Set categoryFromBands=true when rows carry only a section name ("Machinery & Equipment") and the assets below have no category column of their own.
- A lifetime column may be in months (NetSuite) or "YY/MM" text (Sage) — map it to usefulLife either way; it is stored as text.
- Emit one entry in columns for every column in the sheet, in order, with field=null for columns that map to nothing. Use the note field only where the header alone would not justify the choice.
- confidence is your honest estimate (0 to 1) that this mapping could run unreviewed without producing wrong assets. Ambiguous cost columns or guessed sheets should push it well below 0.8.
- List every sheet from the input in your answer, including excluded ones.`;

function renderSheet(summary: SheetSummary): string {
  const rows = summary.preview
    .map((row, i) => `${i}\t${row.map((cell) => cell ?? '').join('\t')}`)
    .join('\n');
  return [
    `## Sheet: ${JSON.stringify(summary.name)}`,
    `${summary.rowCount} rows × ${summary.colCount} columns; detected header row: ${summary.detectedHeaderRow ?? 'none'}`,
    `First rows (row index, then cells tab-separated; blank = empty cell):`,
    rows,
  ].join('\n');
}

export interface MappingProposalResult {
  proposal: FarMappingProposal;
  model: string;
}

export async function proposeMapping(
  summaries: SheetSummary[],
  context: { filename: string },
): Promise<MappingProposalResult> {
  const { parsed, model } = await parseStructured({
    system: SYSTEM,
    user: `Workbook: ${JSON.stringify(context.filename)}\n\n${summaries.map(renderSheet).join('\n\n')}`,
    schema: ProposalOutputSchema,
    schemaName: 'far_mapping_proposal',
    maxTokens: 16000,
    task: 'mapping',
  });

  return { proposal: sanitize(parsed, summaries), model };
}

/**
 * Constrain the proposal to the workbook that actually exists. Unknown sheets
 * are dropped, sheets the model forgot come back excluded, out-of-range column
 * indexes and duplicates go away, and headerRow is bounded by the sheet.
 */
function sanitize(
  raw: z.infer<typeof ProposalOutputSchema>,
  summaries: SheetSummary[],
): FarMappingProposal {
  const byName = new Map(summaries.map((s) => [s.name, s]));

  const sheets = raw.sheets
    .filter((sheet) => byName.has(sheet.sheetName))
    .map((sheet) => {
      const summary = byName.get(sheet.sheetName)!;
      const seen = new Set<number>();
      const columns = sheet.columns
        .filter(
          (c) =>
            c.index >= 0 && c.index < summary.colCount && !seen.has(c.index) && seen.add(c.index),
        )
        .map((c) => ({ index: c.index, field: c.field, ...(c.note ? { note: c.note } : {}) }));
      const headerRow =
        sheet.headerRow !== null && sheet.headerRow >= 0 && sheet.headerRow < summary.rowCount
          ? sheet.headerRow
          : sheet.headerRow === null
            ? null
            : (summary.detectedHeaderRow ?? null);
      return { ...sheet, columns, headerRow };
    });

  const covered = new Set(sheets.map((s) => s.sheetName));
  for (const summary of summaries) {
    if (covered.has(summary.name)) continue;
    sheets.push({
      sheetName: summary.name,
      include: false,
      headerRow: summary.detectedHeaderRow,
      columns: [],
      categoryFromBands: false,
    });
  }

  return {
    sheets,
    confidence: Math.min(1, Math.max(0, raw.confidence)),
    rationale: raw.rationale,
  };
}

/**
 * Propose a mapping, then check it against what it actually produces.
 *
 * The single-shot proposal reads a preview and never sees the rows its mapping
 * makes — which is exactly where it fails: a header row one off, a cost column
 * that is really net book value, a rollforward read as assets. This closes the
 * loop. The proposal is applied in memory by the same deterministic
 * `applyMapping` a confirm would run, measured by `verifyMapping`, and where a
 * check fails the model sees the evidence — the counts, the raw skipped rows,
 * the printed total its costs did not foot against — and revises.
 *
 * Deliberately not a tool-using agent. Every "tool" here is deterministic and
 * cheap, so the harness runs them all every round and the model's only job is
 * the one it is good at: reading the evidence and re-deciding the mapping.
 * That also keeps the loop provider-agnostic — it is the same `parseStructured`
 * seam as everything else, just called more than once.
 *
 * Bounded hard: at most {@link MAX_ROUNDS} proposals, and the loop also stops
 * when the model stands by its mapping unchanged — some registers genuinely
 * are the mess the checks describe, and a model that has seen the evidence and
 * kept its answer is giving information, not failing. Whatever round it ends
 * on, the final proposal ships with its verification attached, so the reviewer
 * sees the same evidence the loop saw. Nothing here writes: the human-confirm
 * gate downstream is untouched.
 */
const MAX_ROUNDS = 3;

const REVISE = `A proposed mapping was applied to the full workbook — not the preview, the whole file — and measured. Some checks failed; the results and the raw rows behind them are below.

Revise the mapping to fix what the evidence shows. If a check failed because the register genuinely is like that — a file with no printed totals, a legitimately costless listing — keep the mapping unchanged and say why in the rationale; an honest stand-by ends the revision loop. Never bend a mapping just to make a number pass: a wrong cost column that happens to foot is worse than a right one that does not.

Return the complete mapping again, every sheet, in the same form as before.`;

export interface VerifiedMappingResult extends MappingProposalResult {
  verification: MappingVerification;
}

export async function proposeVerifiedMapping(
  workbook: ParsedWorkbook,
  summaries: SheetSummary[],
  context: { filename: string },
): Promise<VerifiedMappingResult> {
  const workbookText = summaries.map(renderSheet).join('\n\n');

  let { proposal, model } = await proposeMapping(summaries, context);
  let result = verifyMapping(workbook, proposal);
  let rounds = 1;

  while (!result.ok && rounds < MAX_ROUNDS) {
    const { parsed, model: revisedBy } = await parseStructured({
      system: SYSTEM,
      user: [
        `Workbook: ${JSON.stringify(context.filename)}`,
        workbookText,
        REVISE,
        `Your previous mapping:\n${JSON.stringify({ sheets: proposal.sheets })}`,
        `What it produced:\n${describe(result)}`,
      ].join('\n\n'),
      schema: ProposalOutputSchema,
      schemaName: 'far_mapping_proposal',
      maxTokens: 16000,
      task: 'mapping',
    });
    const revised = sanitize(parsed, summaries);
    rounds += 1;

    // The model stood by its mapping: the checks describe the register, not a
    // mistake. Take the (possibly updated) rationale and stop asking.
    const unchanged = JSON.stringify(revised.sheets) === JSON.stringify(proposal.sheets);
    proposal = revised;
    model = revisedBy;
    if (unchanged) break;

    result = verifyMapping(workbook, proposal);
  }

  const verification: MappingVerification = { rounds, checks: result.checks };
  return { proposal: { ...proposal, verification }, model, verification };
}

/** The verification, in the words the reviewer will also see. */
function describe(result: VerifyResult): string {
  const lines = result.checks.map(
    (check) => `- [${check.ok ? 'pass' : 'FAIL'}] ${check.check}: ${check.detail}`,
  );
  if (result.evidence.length > 0) {
    lines.push('', 'Raw rows behind the failures (cells pipe-separated):');
    lines.push(...result.evidence.map((line) => `  ${line}`));
  }
  return lines.join('\n');
}
