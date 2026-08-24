import { describe, expect, it } from 'vitest';
import type { MappingAsk } from '@tangible/types';
import { askFingerprint, planAskSync, type ExistingAsk } from './asks.js';

const ask = (over: Partial<MappingAsk> = {}): MappingAsk => ({
  question: 'Are the year-only acquisition dates fiscal years or calendar years?',
  why: 'A fiscal-year read shifts every depreciation schedule by one year.',
  field: 'acquisitionYear',
  sheetName: 'Register',
  ...over,
});

const row = (over: Partial<ExistingAsk> = {}): ExistingAsk => ({
  id: 'row-1',
  fingerprint: askFingerprint(ask()),
  field: 'acquisitionYear',
  sheetName: 'Register',
  status: 'answered',
  answer: 'Calendar years.',
  ...over,
});

describe('askFingerprint', () => {
  it('ignores punctuation and case, not words', () => {
    expect(askFingerprint(ask({ question: 'Are the year-only acquisition dates FISCAL years, or calendar years?' })))
      .toBe(askFingerprint(ask()));
    expect(askFingerprint(ask({ question: 'Is this file complete?' }))).not.toBe(askFingerprint(ask()));
  });
});

describe('planAskSync', () => {
  it('inserts a brand-new question as open work', () => {
    const plan = planAskSync([], [ask()]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('does nothing for a question already on file', () => {
    const plan = planAskSync([row()], [ask()]);
    expect(plan.insert).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('a reworded question about the same field inherits the row and its answer', () => {
    const reworded = ask({ question: 'Do the acquisition years refer to fiscal or calendar years?' });
    const plan = planAskSync([row()], [reworded]);
    expect(plan.insert).toHaveLength(0);
    expect(plan.update).toEqual([{ id: 'row-1', ask: reworded, fingerprint: askFingerprint(reworded) }]);
  });

  it('free-text asks never inherit loosely', () => {
    const existing = row({ field: null, sheetName: null, fingerprint: askFingerprint(ask({ field: null, sheetName: null })) });
    const plan = planAskSync([existing], [ask({ field: null, sheetName: null, question: 'Is page two missing?' })]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('one row is not inherited by two incoming asks', () => {
    const a = ask({ question: 'Fiscal or calendar?' });
    const b = ask({ question: 'Which fiscal year convention applies?' });
    const plan = planAskSync([row()], [a, b]);
    expect(plan.update).toHaveLength(1);
    expect(plan.insert).toHaveLength(1);
  });

  it('leaves rows the model stopped asking about alone', () => {
    const plan = planAskSync([row()], []);
    expect(plan.insert).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('an exact match claims its row before a loose rewording can steal it', () => {
    const reworded = ask({ question: 'Fiscal or calendar years?' });
    const plan = planAskSync([row()], [ask(), reworded]);
    expect(plan.update).toHaveLength(0);
    expect(plan.insert.map((i) => i.ask.question)).toEqual([reworded.question]);
  });
});
