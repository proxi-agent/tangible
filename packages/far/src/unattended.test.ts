import { describe, expect, it } from 'vitest';
import type { FarMappingProposal, MappingMemoryHint, SheetMapping } from '@tangible/types';
import { mappingClearsBar } from './unattended.js';

/**
 * The gate between "a machine read this file" and "this file is the return".
 *
 * Every test here is a way a mapping can look fine and not be, and the
 * assertion is always the same shape: the bar refuses, and says why in a
 * sentence a preparer can act on. The one passing case is deliberately the
 * boring one — a clean register, checked against its own rows — because that
 * is the file this whole mechanism exists for.
 */

function sheet(overrides: Partial<SheetMapping> = {}): SheetMapping {
  return {
    sheetName: 'Register',
    include: true,
    headerRow: 0,
    columns: [
      { index: 0, field: 'assetTag' },
      { index: 1, field: 'description' },
      { index: 2, field: 'acquisitionYear' },
      { index: 3, field: 'originalCost' },
    ],
    categoryFromBands: false,
    ...overrides,
  };
}

function proposal(overrides: Partial<FarMappingProposal> = {}): FarMappingProposal {
  return {
    sheets: [sheet()],
    confidence: 0.94,
    rationale: 'Four columns, all named.',
    verification: {
      rounds: 1,
      checks: [
        { check: 'produced-assets', ok: true, detail: '3 assets from 1 included sheet(s).' },
        { check: 'foots', ok: true, detail: 'Register: mapped costs foot against row 5.' },
      ],
    },
    ...overrides,
  };
}

const clean = { openAsks: [], conflicted: [] };

describe('mappingClearsBar', () => {
  it('clears a checked mapping the model stands behind', () => {
    const verdict = mappingClearsBar({ proposal: proposal(), ...clean });
    expect(verdict.clears).toBe(true);
    expect(verdict.reason).toContain('94%');
  });

  it('refuses a mapping that was never run against the rows', () => {
    const { verification: _dropped, ...rest } = proposal();
    const verdict = mappingClearsBar({ proposal: rest as FarMappingProposal, ...clean });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('without being checked');
  });

  /**
   * The case the whole bar is built around. A cost column that is really net
   * book value produces a mapping that looks complete and confident, and the
   * only thing that catches it is footing the column against the printed
   * total — so a failed check outranks any confidence the model reports.
   */
  it('refuses a mapping that failed a check, however sure the model is', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({
        confidence: 1,
        verification: {
          rounds: 3,
          checks: [
            { check: 'produced-assets', ok: true, detail: '3 assets.' },
            {
              check: 'foots',
              ok: false,
              detail:
                'Register: mapped costs sum to $84,000 but the total printed comes to $200,000.',
            },
          ],
        },
      }),
      ...clean,
    });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('$200,000');
  });

  it('refuses a mapping the model hedges on even when every check passed', () => {
    const verdict = mappingClearsBar({ proposal: proposal({ confidence: 0.55 }), ...clean });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('55%');
  });

  it('refuses when nothing is included, which no check catches on its own', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({ sheets: [sheet({ include: false })] }),
      ...clean,
    });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('no sheets');
  });

  it('names the field an included sheet is missing', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({
        sheets: [
          sheet({
            columns: [
              { index: 1, field: 'description' },
              { index: 2, field: 'acquisitionYear' },
            ],
          }),
        ],
      }),
      ...clean,
    });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('originalCost');
  });

  /**
   * A cost-and-description register with no dates passes `verifyMapping`
   * outright — nothing it measures involves an acquisition date — and values
   * nothing downstream, because depreciation needs an age.
   */
  it('refuses a register with no acquisition date of any kind', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({
        sheets: [
          sheet({
            columns: [
              { index: 1, field: 'description' },
              { index: 3, field: 'originalCost' },
            ],
          }),
        ],
      }),
      ...clean,
    });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('acquisition date');
  });

  it('accepts an in-service date in place of an acquisition date', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({
        sheets: [
          sheet({
            columns: [
              { index: 1, field: 'description' },
              { index: 2, field: 'inServiceDate' },
              { index: 3, field: 'originalCost' },
            ],
          }),
        ],
      }),
      ...clean,
    });
    expect(verdict.clears).toBe(true);
  });

  it('ignores what an excluded sheet fails to map', () => {
    const verdict = mappingClearsBar({
      proposal: proposal({
        sheets: [sheet(), sheet({ sheetName: 'Rollforward', include: false, columns: [] })],
      }),
      ...clean,
    });
    expect(verdict.clears).toBe(true);
  });

  it('refuses while a question is open with the client, and quotes it', () => {
    const verdict = mappingClearsBar({
      proposal: proposal(),
      openAsks: ['Are these costs gross, or net of the 2024 disposals?'],
      conflicted: [],
    });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('net of the 2024 disposals');
  });

  it('refuses when the mapping maps a column reviewers have read two ways', () => {
    const conflicted: MappingMemoryHint[] = [
      {
        sheetName: 'Register',
        index: 3,
        header: 'Value',
        field: 'originalCost',
        confirmations: 2,
        conflicted: true,
        conflictingField: 'netBookValue',
      },
    ];
    const verdict = mappingClearsBar({ proposal: proposal(), openAsks: [], conflicted });
    expect(verdict.clears).toBe(false);
    expect(verdict.reason).toContain('"Value"');
    expect(verdict.reason).toContain('netBookValue');
  });

  /**
   * The disagreement has to be about a column this mapping actually uses. A
   * conflicted header on a sheet nobody included, or in a column this mapping
   * left unmapped, is history about a different question.
   */
  it('ignores a disagreement about a column this mapping does not use', () => {
    const elsewhere: MappingMemoryHint[] = [
      {
        sheetName: 'Rollforward',
        index: 3,
        header: 'Value',
        field: 'originalCost',
        confirmations: 2,
        conflicted: true,
        conflictingField: 'netBookValue',
      },
      {
        sheetName: 'Register',
        index: 9,
        header: 'Notes',
        field: 'department',
        confirmations: 1,
        conflicted: true,
        conflictingField: 'location',
      },
    ];
    const verdict = mappingClearsBar({ proposal: proposal(), openAsks: [], conflicted: elsewhere });
    expect(verdict.clears).toBe(true);
  });
});
