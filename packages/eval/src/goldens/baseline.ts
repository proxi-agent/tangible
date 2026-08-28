/**
 * What is allowed to be red today.
 *
 * A gate whose suite is failing teaches everyone to ignore it, and the usual
 * fix — deleting or skipping the failing case — deletes the finding along with
 * the failure. This file is the third option: a dated, named, signed list of
 * cases known to fail, so the gate stays green on what it already knows and
 * turns red the moment something *new* breaks.
 *
 * Two rules keep it from becoming a graveyard. An entry needs an owner and a
 * date, and the gate reports the list in every run — an acknowledged failure is
 * loud, it just isn't blocking. And an entry that no longer matches a failing
 * case is itself a failure: a stale acknowledgement means somebody fixed the
 * case and left the exemption behind, which would silently cover the next
 * regression in the same place.
 */

export interface AcknowledgedFailure {
  /** The golden's own id. Must match, or the acknowledgement is stale. */
  id: string;
  /** Why it is failing and what would close it. */
  reason: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

export const ACKNOWLEDGED_FAILURES: readonly AcknowledgedFailure[] = [];

/**
 * Rules whose approval is outstanding, and which the gate may therefore let
 * through as a warning rather than a block.
 *
 * Every rule in the repository is on this list today, which is an honest
 * statement of where the practice is rather than a loophole. Nobody with a
 * licence has signed the Harris tables cell by cell, and nobody has signed the
 * detector rules' reading of the statutes they cite. Both are real outstanding
 * risks, and they are written down here — with a reason, an owner and a date —
 * rather than left as an absent field that no code looks at.
 *
 * Emptying this list is the release criterion for a paid engagement, not a
 * nice-to-have. Every run of the gate prints what is still on it.
 */
export interface OutstandingApproval {
  ruleId: string;
  reason: string;
  raisedBy: string;
  raisedAt: string;
}

const DETECTOR_REVIEW: Omit<OutstandingApproval, 'ruleId'> = {
  reason:
    "The citation was checked against the statute; what nobody licensed has confirmed is that the detector's reading of it is the one a district would accept.",
  raisedBy: 'kajmeri',
  raisedAt: '2026-08-27',
};

export const OUTSTANDING_APPROVALS: readonly OutstandingApproval[] = [
  {
    ruleId: 'valuation:tx-harris:2026',
    reason:
      'Transcribed from the published PDF. The arithmetic around the tables is tested; that each of several hundred published figures was typed correctly is not independently verified.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-27',
  },
  {
    ruleId: 'valuation:fl:2026',
    reason:
      'Registered so the second state exists in code, with no tables transcribed and no county millage. Nothing values against it yet — an appraisal in Florida gaps rather than guessing — so what is outstanding is the transcription itself, from the DOR guidelines attachments B, C and D.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-27',
  },
  ...[
    'ghost-assets',
    'non-taxable',
    'fully-depreciated',
    'leasehold-double-tax',
    'freeport',
    'duplicate-capitalization',
    'non-assessable-cost',
    'situs-error',
    'misclassification',
    'leased-double-report',
    'de-minimis',
    'carryforward-error',
    'suspected-retired',
    'idle-obsolete',
  ].map((key) => ({ ruleId: `detector:${key}`, ...DETECTOR_REVIEW })),
];

export const UNAPPROVED_ALLOWED: readonly string[] = OUTSTANDING_APPROVALS.map((a) => a.ruleId);
