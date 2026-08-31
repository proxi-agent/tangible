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
    ruleId: 'rates:tx-harris:2025',
    reason:
      'Generated from the HCAD archive rather than transcribed, which rules out typing errors and nothing else. What is outstanding is that nobody has checked a sample of the 1,072 units against the districts’ own rate notices, and that units 327 and 703 — both out-of-county — carry a 2025 rate the 2026 archive contradicts.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'rates:tx-harris:2026',
    reason:
      'A placeholder for a year whose rates no taxing unit has adopted yet. There is nothing to approve until they exist; the entry is here so the gate counts the year rather than passing over it.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'valuation:tx-dallas:2026',
    reason:
      'Transcribed by column coordinate from DCAD’s one-page 2026 worksheet, and checked against the district’s own footnote — five-year assets before 2018 at 13% — which the table reproduces. What is outstanding is that nobody has read all 194 published cells back against the PDF, and that two of them need a person’s judgment rather than a checker’s: the 25-year column prints 93% for 2002 between 83% and 79%, which is transcribed as published, and "licensed vehicles" is defaulted to the five-year line DCAD prints for cars and pickups when the same worksheet puts trucks of one ton or greater on eight.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'valuation:tx-tarrant:2026',
    reason:
      'Transcribed from page 4 of TAD’s own rendition form, separating the grid from the legend prose by font size, and checked against the district’s own worked example — an eight-year asset acquired in 1993 at 15 percent good — which the table reproduces at its floor. Three things need a person rather than a checker. TAD prints by effective age with a blank Year Acquired column, so every row here is 2026 minus an age, and the last row is printed "& OLDER" with no numeral at all. TAD splits point of sale from mainframes; `computer-mainframe` is pointed at the five-year point-of-sale line, which is the higher percent good of the two, so a genuine mainframe is currently valued high and a reviewer has to move it to four. And TAD publishes a SPECIAL semiconductor manufacturing column that this schedule does not carry, because no category key reaches it — a fab’s tools are valued on the ten-year machinery line at 72% where the district itself would say 30%.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'valuation:tx-collin:2026',
    reason:
      'Transcribed by column coordinate from CCAD’s one-page 2026 sheet, 142 cells with none left over, every column contiguous and bottoming out at its own lowest published figure. Two external checks passed: the COMPUTERS column is cell for cell HCAD’s personal computer table, and the three-year column is cell for cell Dallas’s. What is outstanding is that nobody has read all 142 cells back against the PDF, and one assignment is a judgment call: `machinery-equipment` is pointed at the ten-year "MANUFACTURING EQUIPMENT" line when the same sheet also prints a nine-year "MACHINERY & EQUIPMENT" line, and which of the two a given client’s equipment belongs to is a question for a preparer. The sheet publishes its figures as a Percent Value Factor with the cost index already inside, so factors above 100 and factors that rise with age are the district’s arithmetic and not transcription errors.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'valuation:tx-bexar:2026',
    reason:
      'Transcribed by column x-anchor from BCAD’s one-page 2026 factor table, 119 cells with none left over, every column contiguous, every column bottoming out at exactly the residual its own heading names, and the district’s printed Age column checked against year acquired across all 31 rows. The column headings are the substantive reading and nobody has confirmed it: BCAD heads its columns 0410, 0520, 0620, 0820, 1020, 1220, 1520, 2020 and 3020, read here as life-then-residual on the strength of the forms page calling this a "Life Residual Index" table and of all nine columns flooring exactly where that reading predicts. Four category assignments are judgment calls rather than cell checks. `office-equipment` is pointed at the eight-year 0820 line on "Office Equipment (Non-IT)" when the five-year 0520 legend also says plainly "Office Equipment" — 0820 is the higher factor, so the choice errs toward the district. `machinery-equipment` is pointed at the ten-year 1020 trade-equipment line when the same table publishes light manufacturing at eight, specialty and food production at twelve, and heavy manufacturing at fifteen; which rung a client belongs on is a question for a preparer. `telecom-8` is pointed at 0520 on "Servers" when genuine carrier plant belongs on the thirty-year 3020 line. And `leasehold-improvements` and `vessels` have no published answer at all — 0820 and the twenty-year column are placements, not readings. The figures carry BCAD’s trending inside them ("informed by nationally recognized Marshall & Swift cost trends… the appraiser’s concluded present value"), so `costIndexIncluded` is set and no index is applied on top.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
  },
  {
    ruleId: 'valuation:tx-travis:2026',
    reason:
      'Registered with no tables, because TCAD publishes none. Its 2025-2026 reappraisal plan (pp. 52-53) describes present value factor tables built from BLS price indexes and the published Iowa State percent good factors across 723 business codes and 1,320 SIC grid segments, and prints not one of the factors; the 2026 mass appraisal report repeats the method and prints none either; the forms, renditions and open-government pages carry nothing. Nothing values against Travis — every asset gaps — so what is outstanding is not an approval of numbers but a decision about how to get them, and the only route is a Public Information Act request to TCAD for the 2026 PVF tables. Two substitutes were considered and both rejected: the Iowa State factors are a commercial publication and reproducing them would still be guessing which column TCAD applied, and the Comptroller’s public BPP depreciation schedule is the school-district Property Value Study table, which says on its face that appraisal districts should develop their own.',
    raisedBy: 'kajmeri',
    raisedAt: '2026-08-28',
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
