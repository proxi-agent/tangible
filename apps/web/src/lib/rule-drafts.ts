import 'server-only';
import { aiUnavailableReason, draftSchedule, isAiConfigured } from '@tangible/ai';
import { reviewDraft } from '@tangible/eval';
import { scheduleFor } from '@tangible/valuation';
import type { DraftScheduleRequest, DraftScheduleResult } from '@tangible/types';
import { HttpError } from '@/lib/http';

/**
 * Offline rule authoring: a model reads the guide, arithmetic checks it, and a
 * person commits it.
 *
 * Nothing here is stored and nothing here takes effect. The response is source
 * text — a schedule module and its goldens — that someone puts in a file, opens
 * a pull request with, and merges. Until they do, the district does not exist
 * as far as valuation is concerned, and runtime valuation never calls a model.
 *
 * That is not caution for its own sake. The alternative, a schedules table in
 * the database that an agent writes to, would mean a client's assessed value
 * could change between two runs with no diff to read and nobody's name on it.
 */
export async function draftScheduleForReview(
  request: DraftScheduleRequest,
): Promise<DraftScheduleResult> {
  const existing = scheduleFor(request.jurisdictionId, request.taxYear);
  if (existing) {
    /**
     * Refusing rather than drafting a second copy. A committed schedule is a
     * reviewed one, and the way it should be replaced is a diff against what is
     * there — which means starting from the file, not from a fresh transcription
     * that happens to disagree with it in three cells nobody will find.
     */
    throw new HttpError(
      409,
      `${request.jurisdictionName} already has a committed ${request.taxYear} schedule ` +
        `(${existing.provenance.ruleId}). Change that file rather than drafting over it.`,
    );
  }
  if (!isAiConfigured()) {
    throw new HttpError(503, `Rule drafting is off. ${aiUnavailableReason()}`);
  }

  let drafted;
  try {
    drafted = await draftSchedule({
      jurisdictionId: request.jurisdictionId,
      jurisdictionName: request.jurisdictionName,
      taxYear: request.taxYear,
      sourceTitle: request.sourceTitle,
      sourceUrl: request.sourceUrl,
      guideText: request.guideText,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The schedule draft failed: ${message}`);
  }

  /**
   * The draft's own answers about which district and year it covers are
   * overwritten with what the caller asked for. A model given a guide whose
   * cover page says one year and whose tables are headed another will pick one,
   * and the id it picks decides which committed rule the gate later checks — so
   * that is a person's answer, not the model's.
   */
  const draft = {
    ...drafted.parsed,
    jurisdictionId: request.jurisdictionId,
    jurisdictionName: request.jurisdictionName,
    taxYear: request.taxYear,
  };

  return { draft, review: reviewDraft(draft), model: drafted.model };
}
