import 'server-only';
import { fitDetectionModel, type DetectionModelFit, type ModelLabel } from '@tangible/savings';
import type { DetectionModel } from '@tangible/types';
import { harvestLabels } from '@/lib/quality';

/**
 * The engine's confidence weights, refitted on the firm's own decisions.
 *
 * The dataset is the review queue, unchanged and unaugmented: every accept or
 * reject a licensed reviewer recorded, stamped with the signals the row was
 * carrying when they saw it. Nothing new is collected here and no labelling
 * tool is implied. That is the whole argument for why this can exist at all —
 * a firm that files returns produces the training set as a by-product of
 * filing them, and a competitor that does not do the work cannot buy it.
 *
 * Two filters, both load-bearing:
 *
 *   **Firm decisions only.** A controller rejecting a row is real information
 *   and is often better information — they know what happened to the machine —
 *   but "the client did not want to make this argument" and "the detector was
 *   wrong" are different facts. Training on both would teach the engine to
 *   lower its confidence in positions that are correct and unpopular. The
 *   client labels are still scored and reported; they are just not fitted on.
 *
 *   **Judged only.** An abstention is a row that was parked or sent onward,
 *   which is work rather than evidence, and it carries no answer to learn from.
 *
 * Fitted on every request that runs an analysis, rather than cached. It is a
 * Newton solve over a few thousand rows and a dozen features — microseconds —
 * and a cache here would be a second copy of the labels with its own staleness
 * problem. The one real cost is the label scan, which the quality dashboard
 * already pays.
 */
export async function loadDetectionModel(): Promise<DetectionModelFit> {
  const labels = await harvestLabels();
  const training: ModelLabel[] = labels
    .filter((label) => label.decidedByAudience !== 'client')
    .filter((label) => label.verdict !== 'abstain')
    .map((label) => ({
      findingKey: label.findingKey,
      signals: label.signals,
      correct: label.verdict === 'correct',
    }));
  return fitDetectionModel(training, new Date().toISOString());
}

/** The dashboard's read: the same fit, without the part used for scoring. */
export async function detectionModelView(): Promise<DetectionModel> {
  return (await loadDetectionModel()).view;
}
