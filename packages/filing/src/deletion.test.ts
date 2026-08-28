import { describe, expect, it } from 'vitest';
import type { DeletionCounts } from '@tangible/types';
import { deletionWarnings } from './deletion.js';

const empty: DeletionCounts = {
  engagements: 0,
  locations: 0,
  assets: 0,
  documents: 0,
  storageObjects: 0,
  findings: 0,
  filedRenditions: 0,
  notices: 0,
  protests: 0,
  correctionMotions: 0,
  appointments: 0,
  portalLogins: 0,
  memoryRows: 0,
  assistantTurns: 0,
};

describe('deletionWarnings', () => {
  it('counts the sign-ins that stop working, because nobody tells them', () => {
    const [warning] = deletionWarnings({ ...empty, portalLogins: 2 });
    expect(warning).toContain('2 people');
    expect(warning).toContain('not told');
  });

  it('says nothing about a client who was never worked', () => {
    expect(deletionWarnings({ ...empty, engagements: 1, locations: 2 })).toEqual([]);
  });

  it('warns that the firm loses its copy of a filing, not the district', () => {
    const [warning] = deletionWarnings({ ...empty, filedRenditions: 1 });
    expect(warning).toContain('1 filed rendition');
    expect(warning).toContain('district');
  });

  it('names protests and motions in one warning, and asks about live deadlines', () => {
    const [warning] = deletionWarnings({ ...empty, protests: 2, correctionMotions: 1 });
    expect(warning).toContain('2 protests and 1 25.25 motion');
    expect(warning).toContain('deadline');
  });

  it('mentions only the one that applies when the other is absent', () => {
    expect(deletionWarnings({ ...empty, protests: 1 })[0]).not.toContain('motion');
    expect(deletionWarnings({ ...empty, correctionMotions: 1 })[0]).not.toContain('protest');
  });

  it('flags the cross-client memory as the client’s own text', () => {
    const [warning] = deletionWarnings({ ...empty, memoryRows: 3 });
    expect(warning).toContain('3 learned classifications');
    expect(warning).toContain('description text');
  });

  it('warns for every distinct consequence at once', () => {
    expect(
      deletionWarnings({
        ...empty,
        filedRenditions: 2,
        protests: 1,
        memoryRows: 4,
        storageObjects: 6,
      }),
    ).toHaveLength(4);
  });
});
