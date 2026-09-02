import 'server-only';
import type { FarFileRow } from '@tangible/db';
import { mappingClearsBar, type UnattendedVerdict } from '@tangible/far';
import type { FarMappingProposal, IntakeRoute } from '@tangible/types';
import { fileAsks } from '@/lib/asks';
import { fetchIntakeFile, routable, routeIntakeFile, type IntakeRow } from '@/lib/intake';
import { confirmMapping, proposeForFile } from '@/lib/mapping';
import { hintsForFile } from '@/lib/mapping-memory';
import { executeRun } from '@/lib/runs';
import { fetchFarFile } from '@/lib/workspace';

/**
 * Carry a client's drop as far as the evidence allows, and no further.
 *
 * Until this existed a client could send their register, see "received", and
 * wait — because two people at the firm had to act before anything happened:
 * one to route the file, one to confirm what its columns meant. Neither was a
 * judgement call on the ordinary file. A clean spreadsheet triaged as a
 * register at 0.95, mapped, applied to the whole workbook and footed against
 * the total printed on the sheet is not waiting on human wisdom; it is waiting
 * on somebody to be at their desk.
 *
 * So this runs the drop end to end when — and only when — the evidence is
 * strong enough to stand on, and leaves everything else exactly where it was:
 * in the triage queue, or on the mapping screen, with the reason visible. The
 * bar is deliberately made of measurements rather than of the model's opinion
 * of itself. `verifyMapping` applies the proposed mapping to the real rows and
 * foots the mapped costs against the total the register prints; a mapping that
 * clears every one of those checks has been tested against the file, not
 * merely believed.
 *
 * Two properties make this safe to be wrong about. Nothing here is
 * irreversible — a mapping the autopilot confirmed can be re-confirmed by a
 * person against the same durable assets, which is the whole point of the
 * asset graph — and everything it does is signed: the import batch and the run
 * both carry {@link AUTOPILOT} as their actor, so "who decided this" has an
 * answer that is not a shrug.
 */

/** The actor written onto everything this does. Not an email, and not meant to look like one. */
export const AUTOPILOT = 'autopilot';

/**
 * How sure triage must be before a file routes itself.
 *
 * Routing wrong is cheap but not free: a notice sent down the register
 * pipeline fails the parse and lands as `failed` rather than as a question.
 * The model is told its confidence must reflect that a PDF it could not read
 * was judged by filename, so this bar mostly separates "sheet named FAR with
 * asset headers" from "a PDF called scan_003".
 */
const ROUTE_CONFIDENCE = 0.85;

export type AutopilotStep = 'routed' | 'mapped' | 'imported' | 'held' | 'failed';

export interface AutopilotOutcome {
  intakeId: string;
  filename: string;
  step: AutopilotStep;
  /** Why it stopped where it stopped, in words a preparer can act on. */
  reason: string;
  farFileId?: string;
  runId?: string;
}

/**
 * Run the autopilot over one drop.
 *
 * Called from `after()` on the intake handler, so it is already behind the
 * client's response: nothing here can slow an upload down, and nothing here
 * can fail one. Every file is independent — one that throws leaves the rest to
 * run, and leaves itself in the queue.
 */
export async function autopilotDrop(intakeIds: string[]): Promise<AutopilotOutcome[]> {
  const outcomes: AutopilotOutcome[] = [];
  for (const intakeId of intakeIds) {
    try {
      outcomes.push(await advanceIntakeFile(intakeId));
    } catch (error) {
      console.error('[autopilot] gave up on an intake file', intakeId, error);
      outcomes.push({
        intakeId,
        filename: '',
        step: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

async function advanceIntakeFile(intakeId: string): Promise<AutopilotOutcome> {
  const row = await fetchIntakeFile(intakeId);
  const base = { intakeId, filename: row.originalFilename };

  const decision = routeDecision(row);
  if (decision.hold) return { ...base, step: 'held', reason: decision.reason };

  const routed = await routeIntakeFile(row, decision.action);
  if (decision.action !== 'register') {
    return { ...base, step: 'routed', reason: `Routed to ${decision.action}. ${decision.reason}` };
  }

  const farFileId = routed.routedId;
  if (!farFileId) {
    return { ...base, step: 'failed', reason: 'The register was routed but recorded no file.' };
  }
  return { ...(await advanceRegister(farFileId)), ...base, farFileId };
}

/**
 * Decide where a staged file goes, from the triage proposal alone.
 *
 * `other` and a missing proposal both hold — the first is triage saying it
 * does not know, the second is triage not having run — and neither is ever
 * turned into a dismissal. Dismissing is throwing away client evidence on a
 * machine's say-so, and no confidence figure earns that.
 */
function routeDecision(
  row: IntakeRow,
):
  | { hold: true; reason: string }
  | { hold: false; action: 'register' | 'rendition' | 'notice'; reason: string } {
  if (row.status !== 'triaged') {
    return { hold: true, reason: `Already ${row.status}.` };
  }
  const route = row.proposedRoute as IntakeRoute | null;
  const confidence = row.proposedConfidence;
  if (route === null || confidence === null) {
    return { hold: true, reason: 'Triage proposed nothing for this file.' };
  }
  if (route === 'other') {
    return { hold: true, reason: 'Triage could not tell what this file is.' };
  }
  if (confidence < ROUTE_CONFIDENCE) {
    return {
      hold: true,
      reason: `Triage read it as a ${route} at ${Math.round(confidence * 100)}%, under the ${Math.round(ROUTE_CONFIDENCE * 100)}% the autopilot routes on.`,
    };
  }
  if (!routable(row, route)) {
    return { hold: true, reason: `Triage read it as a ${route}, which its file type cannot be.` };
  }
  return {
    hold: false,
    action: route,
    reason: `Triage was ${Math.round(confidence * 100)}% sure.`,
  };
}

/**
 * A routed register, the rest of the way: propose the mapping, hold it to the
 * bar, and — if it clears — apply it and produce the report the client is
 * actually waiting for.
 */
async function advanceRegister(
  farFileId: string,
): Promise<Omit<AutopilotOutcome, 'intakeId' | 'filename'>> {
  let file = await fetchFarFile(farFileId);
  if (file.status === 'failed') {
    return { step: 'failed', reason: file.error ?? 'The workbook could not be parsed.' };
  }

  await proposeForFile(file);
  file = await fetchFarFile(farFileId);

  const proposal = file.proposal as FarMappingProposal | null;
  if (!proposal) return { step: 'routed', reason: 'No mapping was proposed.' };

  const bar = await mappingBar(file, proposal);
  if (!bar.clears) return { step: 'mapped', reason: bar.reason };

  const { run } = await confirmMapping({
    file,
    mapping: { sheets: proposal.sheets },
    actor: AUTOPILOT,
  });

  /**
   * The run is executed here rather than handed to `after`: this is already an
   * `after` callback, and a run left queued would wait on the reaper's next
   * sweep before the client heard anything. A run that dies mid-flight is not
   * lost either way — it keeps its checkpoints and the reaper resumes it.
   */
  if (run && run.status === 'queued') {
    try {
      await executeRun(run.id);
    } catch (error) {
      console.error('[autopilot] the report run failed; the reaper will retry', run.id, error);
    }
  }

  return { step: 'imported', reason: bar.reason, runId: run?.id };
}

/**
 * The bar, with the evidence fetched.
 *
 * The judgement itself is `mappingClearsBar` in @tangible/far, next to the
 * checks it reads and under test; what belongs here is only the reading of the
 * rows it needs — the open questions and the firm's own disagreements about
 * these headers — plus the one condition that is about this file's state
 * rather than about the mapping.
 */
async function mappingBar(
  file: FarFileRow,
  proposal: FarMappingProposal,
): Promise<UnattendedVerdict> {
  if (file.status === 'normalized') {
    return { clears: false, reason: 'Already normalized.' };
  }
  const [asks, hints] = await Promise.all([fileAsks(file.id), hintsForFile(file)]);
  return mappingClearsBar({
    proposal,
    openAsks: asks.filter((ask) => ask.status === 'open').map((ask) => ask.question),
    conflicted: hints.filter((hint) => hint.conflicted),
  });
}
