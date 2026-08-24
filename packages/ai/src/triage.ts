import { z } from 'zod';
import { IntakeRouteSchema, type IntakeRoute } from '@tangible/types';
import { parseStructured } from './structured.js';

/**
 * Sort a client's drop into pipelines.
 *
 * One structured call over the whole batch, because the files explain each
 * other: "FAR_2026.xlsx" next to "FAR_2026_v2.xlsx" reads differently than
 * either alone, and the rendition PDF beside a register makes both more
 * certain. The model sees what a cheap deterministic pass could see — names,
 * sizes, and sheet names with header cells for anything that opened as a
 * workbook — and nothing more. PDFs are judged by their name alone at this
 * stage, which is exactly why the output is a proposal: the confidence is
 * told to say so, and the human confirms every route before anything moves.
 */

export interface TriageFileInput {
  filename: string;
  byteSize: number;
  /** Per-sheet evidence when the file opened as a workbook; null otherwise. */
  sheets: { name: string; rowCount: number; headerCells: string[] }[] | null;
}

export interface TriageDecision {
  route: IntakeRoute;
  confidence: number;
  reason: string;
}

export interface TriageResult {
  decisions: (TriageDecision | null)[];
  model: string;
}

const TriageOutputSchema = z.object({
  files: z.array(
    z.object({
      index: z.number().int(),
      route: IntakeRouteSchema,
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = `You triage the files a client sent to a business personal property tax practice. Each file goes down one pipeline, and a person will confirm every decision — your job is a proposal with honest confidence, not a verdict.

The routes:
- register: a fixed asset register or listing — asset-level rows with descriptions, dates, costs. Spreadsheets with sheets full of asset columns are the classic case.
- rendition: a business personal property rendition the client previously filed (Texas Form 50-144 or similar) — usually a PDF of a filled form.
- notice: an appraisal district's notice of appraised value — a letter stating the account, the year, and the value.
- other: everything else — invoices, trial balances, photos, depreciation policy memos, correspondence. When you cannot tell, choose other with low confidence and say what would settle it.

Rules:
- For spreadsheets you see sheet names and header cells; judge from them. A workbook of rollforwards or GL exports is other, not register.
- For PDFs you see only the filename and size. Filenames are often honest ("2025 Notice of Value.pdf") but the confidence must reflect that you have not seen inside.
- Answer for every file by its index. confidence is 0 to 1.`;

export async function triageFiles(files: TriageFileInput[]): Promise<TriageResult> {
  const listing = files
    .map((file, index) => {
      const lines = [
        `### File ${index}: ${JSON.stringify(file.filename)} (${file.byteSize} bytes)`,
      ];
      if (file.sheets === null) {
        lines.push('Did not open as a workbook — judge from the name.');
      } else {
        for (const sheet of file.sheets) {
          lines.push(
            `Sheet ${JSON.stringify(sheet.name)}: ${sheet.rowCount} rows; headers: ${sheet.headerCells.join(' | ') || '(none detected)'}`,
          );
        }
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const { parsed, model } = await parseStructured({
    system: SYSTEM,
    user: `The client sent ${files.length} file(s):\n\n${listing}`,
    schema: TriageOutputSchema,
    schemaName: 'intake_triage',
    maxTokens: 8000,
    task: 'mapping',
  });

  // Match by index, not order: a file the model skipped stays null and reaches
  // the person as "triage had no answer" rather than inheriting a neighbor's.
  const decisions: (TriageDecision | null)[] = files.map(() => null);
  for (const entry of parsed.files) {
    if (entry.index >= 0 && entry.index < files.length && decisions[entry.index] === null) {
      decisions[entry.index] = {
        route: entry.route,
        confidence: Math.min(1, Math.max(0, entry.confidence)),
        reason: entry.reason,
      };
    }
  }
  return { decisions, model };
}
