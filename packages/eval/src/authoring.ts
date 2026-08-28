import type { DraftReview, ScheduleDraft } from '@tangible/types';
import { LIFE_CLASSES, SPECIAL_SCHEDULES } from '@tangible/valuation';

/**
 * The deterministic half of rule authoring.
 *
 * A model drafted the tables; this decides whether they can be true, and then
 * renders the source file a person commits. Nothing here calls a model, and
 * nothing here writes to the repository — the output is text, and a human
 * putting it in a file is the approval step.
 *
 * The invariants are the part worth arguing about, so they are written out
 * rather than left as a validator. Each one is a statement about how published
 * depreciation schedules work, and each one catches the specific way a model
 * gets a numeric table wrong: not a wild figure, but a plausible one in the
 * wrong cell.
 */

export function reviewDraft(draft: ScheduleDraft): DraftReview {
  const problems: string[] = [];
  const observations: string[] = [];

  for (const gap of draft.gaps) {
    /**
     * A gap is a refusal to invent, which is the behaviour we asked for — and
     * it still blocks. A schedule with a hole in it values some year of some
     * class wrongly and says nothing while it does.
     */
    problems.push(`The guide was not fully read: ${gap}`);
  }

  if (draft.citation.trim().length < 20) {
    problems.push(
      'The citation is too short to check. It has to name the document, the division, the year and the pages.',
    );
  }
  if (!draft.effectiveTo) {
    problems.push(
      'No end date. An annual guide governs one tax year, and a schedule with an open window is how last year’s tables quietly value this year’s property.',
    );
  }

  const years = draft.indexFactors.map((cell) => cell.year);
  if (years.length === 0) {
    problems.push('No index factors at all.');
  } else {
    /**
     * An index factor restates historical cost as replacement cost new, so an
     * older year takes a larger factor. A run that goes the other way means the
     * column was read upside down — the single most likely transcription error
     * on a table printed newest-first.
     */
    const sorted = [...draft.indexFactors].sort((a, b) => b.year - a.year);
    for (let i = 1; i < sorted.length; i += 1) {
      const newer = sorted[i - 1]!;
      const older = sorted[i]!;
      if (older.value < newer.value) {
        problems.push(
          `The index factor for ${older.year} (${older.value}) is below ${newer.year} (${newer.value}). Factors do not fall as the year gets older — the column may have been read in the wrong direction.`,
        );
        break;
      }
    }
    if (sorted.some((cell) => cell.value < 0.9 || cell.value > 5)) {
      problems.push(
        'An index factor outside 0.9–5.0. Published factors sit near 1 for recent years and rise slowly; anything outside that range is a misread decimal.',
      );
    }
    const span = Math.max(...years) - Math.min(...years);
    if (span < 10) {
      observations.push(
        `The index table covers ${span + 1} years. Most district guides publish twenty or more, so the excerpt may be partial.`,
      );
    }
  }

  const lives = new Set<number>();
  for (const column of draft.percentGood) {
    lives.add(column.lifeClass);
    if (!(LIFE_CLASSES as readonly number[]).includes(column.lifeClass)) {
      /**
       * Blocking rather than noted, because the schedule type is keyed by the
       * life classes the package knows: a module carrying a ${column.lifeClass}-year
       * column would not compile. Widening `LIFE_CLASSES` is a code change with
       * its own review, and it should happen before the tables land, not after.
       */
      problems.push(
        `Life class ${column.lifeClass} is not one the valuation package publishes. The schedule type has to be widened to carry it before this district can be added.`,
      );
    }
    problems.push(...monotonicProblems(`the ${column.lifeClass}-year column`, column.cells));
    problems.push(...rangeProblems(`the ${column.lifeClass}-year column`, column.cells));
  }
  if (lives.size === 0) problems.push('No percent-good columns at all.');
  /**
   * A life class the guide does not publish is rendered as an empty table, and
   * `appraise` reports a gap rather than inventing a figure — so this is a note,
   * not a block. It matters because a category pointed at an empty column values
   * nothing, and the report will say so on every one of those rows.
   */
  const missing = LIFE_CLASSES.filter((life) => !lives.has(life));
  if (lives.size > 0 && missing.length > 0) {
    observations.push(
      `No column for ${missing.join(', ')}-year property. Assets that resolve to those lives will come back as gaps rather than values.`,
    );
  }

  for (const special of draft.specialPercentGood) {
    if (!(SPECIAL_SCHEDULES as readonly string[]).includes(special.schedule)) {
      problems.push(
        `Special schedule "${special.schedule}" has no counterpart in the valuation package. Adding it means a code change, not just this table.`,
      );
    }
    problems.push(...monotonicProblems(`the ${special.schedule} schedule`, special.cells));
    problems.push(...rangeProblems(`the ${special.schedule} schedule`, special.cells));
  }

  for (const profile of draft.sicProfiles) {
    if (!/^\d{2,4}$/.test(profile.sic)) {
      problems.push(`"${profile.sic}" is not an SIC code. The business-line table was misread.`);
      break;
    }
    if (!(LIFE_CLASSES as readonly number[]).includes(profile.machineryLife)) {
      problems.push(
        `SIC ${profile.sic} is given a machinery life of ${profile.machineryLife}, which is not a life class in the tables.`,
      );
    }
  }
  if (draft.sicProfiles.length === 0) {
    observations.push(
      'No SIC profiles. Machinery will fall back to the category default life, and the report will say so on every machinery row.',
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    observations,
    scheduleModule: renderScheduleModule(draft),
    goldenModule: renderGoldenModule(draft),
  };
}

/**
 * Percent good never rises as an asset ages. This is the invariant that catches
 * a swapped pair of cells, and it is the one the Harris tables were checked
 * against by hand when they were first typed in.
 */
function monotonicProblems(label: string, cells: { year: number; value: number }[]): string[] {
  const sorted = [...cells].sort((a, b) => b.year - a.year);
  for (let i = 1; i < sorted.length; i += 1) {
    const newer = sorted[i - 1]!;
    const older = sorted[i]!;
    if (older.value > newer.value) {
      return [
        `In ${label}, ${older.year} is ${older.value}% good against ${newer.year} at ${newer.value}%. Property does not get better with age — two cells are swapped.`,
      ];
    }
  }
  return [];
}

function rangeProblems(label: string, cells: { year: number; value: number }[]): string[] {
  const problems: string[] = [];
  const bad = cells.find((cell) => cell.value < 0 || cell.value > 100);
  if (bad) {
    problems.push(
      `In ${label}, ${bad.year} is ${bad.value}. Percent good is printed 0–100; a fraction here means the column was rescaled on the way in.`,
    );
  }
  /**
   * A column rescaled to a fraction sits inside 0–100 and looks fine, so the
   * bounds check above never sees it — and the resulting schedule depreciates
   * every asset to a hundredth of its value without erroring once. No real
   * percent-good column tops out at or below 1%: the newest year is always
   * high, because a one-year-old asset is not nearly worthless.
   */
  const top = cells.reduce((max, cell) => Math.max(max, cell.value), 0);
  if (cells.length > 0 && top <= 1) {
    problems.push(
      `In ${label}, the highest figure is ${top}. Percent good is printed 0–100 — the column was rescaled to a fraction on the way in.`,
    );
  }
  const duplicated = cells
    .map((cell) => cell.year)
    .filter((year, i, all) => all.indexOf(year) !== i);
  if (duplicated.length > 0) {
    problems.push(`In ${label}, ${duplicated[0]} appears twice.`);
  }
  return problems;
}

/* ── Rendering ───────────────────────────────────────────────────────────────
 *
 * The artifact is a source file, not a database row. That is the whole point of
 * "a human approves it into the repo": the tables arrive in a pull request, a
 * person reads the diff, and until they merge it the district does not exist as
 * far as the product is concerned. Runtime never parses a guide, never calls a
 * model, and never reads a table that is not committed.
 */

function renderScheduleModule(draft: ScheduleDraft): string {
  const constName = draft.jurisdictionId.replace(/-/g, '_').toUpperCase() + `_${draft.taxYear}`;
  const today = draft.effectiveFrom;
  return `/**
 * ${draft.jurisdictionName}'s published business personal property valuation
 * schedules for tax year ${draft.taxYear}.
 *
 * Source: ${draft.sourceTitle}${draft.sourcePages ? `, ${draft.sourcePages}` : ''}.
${draft.sourceUrl ? ` * ${draft.sourceUrl}\n` : ''} *
 * Drafted from that document and committed rather than parsed at runtime: these
 * are published figures that change once a year, and a number that decides a
 * client's rendition should be reviewable in a diff.
 *
 * DRAFTED, NOT APPROVED. Read the tables against the guide before merging, and
 * set approvedBy when somebody with standing has done that.
${draft.notes ? ` *\n * The drafter noted: ${draft.notes}\n` : ''} */

import type { DepreciationSchedule } from '../types.js';

export const ${constName}: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:${draft.jurisdictionId}:${draft.taxYear}',
    title: ${quote(draft.title)},
    citation: ${quote(draft.citation)},
    source: {
      title: ${quote(draft.sourceTitle)},
      url: ${draft.sourceUrl ? quote(draft.sourceUrl) : 'null'},
      pages: ${draft.sourcePages ? quote(draft.sourcePages) : 'null'},
    },
    effectiveFrom: ${quote(draft.effectiveFrom)},
    effectiveTo: ${draft.effectiveTo ? quote(draft.effectiveTo) : 'null'},
    jurisdictions: [${quote(draft.jurisdictionId)}],
    taxYears: [${draft.taxYear}],
    authoredBy: 'rule-author (drafted from the published guide)',
    authoredAt: ${quote(today)},
    // Nobody has checked these tables cell by cell against the guide.
    approvedBy: null,
    approvedAt: null,
    notes: ${draft.notes ? quote(draft.notes) : 'null'},
  },
  jurisdictionId: ${quote(draft.jurisdictionId)},
  jurisdictionName: ${quote(draft.jurisdictionName)},
  taxYear: ${draft.taxYear},
  source: {
    title: ${quote(draft.sourceTitle)},
    url: ${quote(draft.sourceUrl ?? '')},
    pages: ${quote(draft.sourcePages ?? '')},
  },
  indexFactors: {
${cellLines(draft.indexFactors, 4)}
  },
  percentGood: {
${LIFE_CLASSES.map((life) =>
  tableLines(String(life), draft.percentGood.find((column) => column.lifeClass === life)?.cells),
).join('\n')}
  },
  specialPercentGood: {
${SPECIAL_SCHEDULES.map((key) =>
  tableLines(key, draft.specialPercentGood.find((special) => special.schedule === key)?.cells),
).join('\n')}
  },
  sicProfiles: {
${draft.sicProfiles
  .map(
    (profile) =>
      `    ${quote(profile.sic)}: {\n      description: ${quote(profile.description)},\n      machineryLife: ${profile.machineryLife},\n      miscLife: ${profile.miscLife},\n      stateClass: ${profile.stateClass ? quote(profile.stateClass) : 'null'},\n    },`,
  )
  .join('\n')}
  },
};
`;
}

/**
 * The goldens that come with the draft.
 *
 * Their expectations are left blank on purpose. A model that transcribed the
 * table cannot also certify what the table produces — the golden would be
 * testing the draft against itself, which is how a suite goes green through the
 * exact drift it exists to catch. Filling them in means running an asset
 * through `appraise` and checking the answer against a real assessment notice
 * from the district, which is a person's job and the only kind of golden that
 * proves our reading matches theirs.
 */
function renderGoldenModule(draft: ScheduleDraft): string {
  const constName = draft.jurisdictionId.replace(/-/g, '_').toUpperCase() + `_${draft.taxYear}`;
  const sample = [...draft.indexFactors].sort((a, b) => b.year - a.year).slice(0, 3);
  return `import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Goldens for ${draft.jurisdictionName}, tax year ${draft.taxYear}.
 *
 * TO FILL IN. Each case below names an asset; the expected figures are for a
 * person to take from a real assessment notice for that property, not from
 * running our own code. A golden whose expectation came from the same
 * transcription it is guarding proves nothing.
 */
export const ${constName}_VALUATION_GOLDENS: readonly ValuationGolden[] = [
${sample
  .map(
    (cell, i) => `  {
    id: '${draft.jurisdictionId}-${draft.taxYear}-case-${i + 1}',
    jurisdictionId: ${quote(draft.jurisdictionId)},
    taxYear: ${draft.taxYear},
    basis: 'assessment-notice',
    description: 'TODO: the property this notice is about',
    input: {
      originalCost: 0,
      acquisitionYear: ${cell.year},
      categoryKey: 'machinery-equipment',
      businessSic: null,
    },
    expected: { indexFactor: ${cell.value}, percentGood: 0, marketValue: 0, atFloor: false },
    citation: 'TODO: account number and notice date',
  },`,
  )
  .join('\n')}
];
`;
}

/**
 * One table in the rendered object, present whether or not the guide published
 * it. The schedule type requires every life class and every special schedule to
 * have a key, and an empty one is the honest filling: `appraise` returns a gap
 * for an asset that lands there, which reads on the report as "we cannot value
 * this" rather than as a number nobody can source.
 */
function tableLines(key: string, cells: { year: number; value: number }[] | undefined): string {
  if (!cells || cells.length === 0) {
    return `    // Not published in this guide.\n    ${key}: {},`;
  }
  return `    ${key}: {\n${cellLines(cells, 6)}\n    },`;
}

function cellLines(cells: { year: number; value: number }[], indent: number): string {
  const pad = ' '.repeat(indent);
  return [...cells]
    .sort((a, b) => b.year - a.year)
    .map((cell) => `${pad}${cell.year}: ${cell.value},`)
    .join('\n');
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
