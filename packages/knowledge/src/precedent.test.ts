import { describe, expect, it } from 'vitest';
import {
  renderPrecedent,
  searchPrecedent,
  tallyPrecedent,
  type PrecedentDocument,
  type PrecedentOutcome,
} from './precedent.js';

/**
 * A corpus written by hand, because the point of supplying documents rather
 * than reading them is that the retriever can be argued with on a set somebody
 * chose. Three of these say almost the same thing with different endings —
 * that is the case the "losses rank like wins" rule exists for.
 */
function doc(overrides: Partial<PrecedentDocument> & Pick<PrecedentDocument, 'id'>) {
  return {
    kind: 'protest-brief' as const,
    title: 'Untitled',
    body: '',
    clientId: 'client-1',
    clientName: 'Acme Fabrication',
    district: 'Harris County Appraisal District',
    taxYear: 2026,
    findingKey: null,
    outcome: null,
    writtenOn: '2026-05-01',
    href: null,
    ...overrides,
  } satisfies PrecedentDocument;
}

const allowed: PrecedentOutcome = {
  label: 'Informal agreement — value reduced to the rendered figure.',
  favorable: true,
  on: '2026-06-10',
};
const refused: PrecedentOutcome = {
  label: 'ARB order — noticed value upheld in full.',
  favorable: false,
  on: '2026-07-02',
};

const CORPUS: PrecedentDocument[] = [
  doc({
    id: 'protest-brief:1',
    title: 'Obsolescence on idle extrusion line',
    findingKey: 'idle-equipment',
    body: 'The extrusion line has been out of service since 2024 and the district applied percent good as though it were running. Functional obsolescence is argued on the maintenance log and the utility record.',
    outcome: allowed,
  }),
  doc({
    id: 'protest-brief:2',
    title: 'Obsolescence on idle press, second attempt',
    findingKey: 'idle-equipment',
    district: 'Dallas Central Appraisal District',
    clientId: 'client-2',
    clientName: 'Northline Plastics',
    body: 'The press is idle and obsolescence is argued the same way. The district refused the maintenance log as evidence of anything but downtime.',
    outcome: refused,
  }),
  doc({
    id: 'protest-brief:3',
    title: 'Freeport allocation on finished goods',
    findingKey: 'freeport',
    body: 'Inventory shipped out of Texas within 175 days qualifies for the freeport exemption and the district assessed the full inventory figure.',
    outcome: null,
  }),
  doc({
    id: 'correction-motion:1',
    kind: 'correction-motion',
    title: 'Double-assessed forklifts, tax year 2024',
    findingKey: 'duplicate-asset',
    taxYear: 2024,
    body: 'Two forklifts appear on the roll twice under separate account numbers. Correction is sought for a clerical error in the appraisal roll.',
    outcome: allowed,
  }),
  doc({
    id: 'finding-note:1',
    kind: 'finding-note',
    title: 'Rejected: leasehold improvements are real property here',
    findingKey: 'leasehold-improvements',
    body: 'Taking these off would be wrong. The lease makes the improvements the landlord’s at termination, so they are already on the real property account and the register line is a duplicate of nothing.',
    outcome: { label: 'Rejected by the preparer.', favorable: false, on: '2026-04-02' },
    href: '/clients/c/engagements/e/findings',
  }),
];

describe('searchPrecedent', () => {
  const ids = (query: string, options = {}) =>
    searchPrecedent(CORPUS, query, options).map((hit) => hit.document.id);

  it('finds the firm’s own prose by the words a preparer would use', () => {
    expect(ids('idle equipment obsolescence')).toContain('protest-brief:1');
  });

  it('returns the refusal alongside the win, not below the floor', () => {
    const found = ids('idle obsolescence maintenance log');
    expect(found).toContain('protest-brief:1');
    expect(found).toContain('protest-brief:2');
  });

  it('does not retrieve on the outcome text', () => {
    // "upheld" and "refused" appear only in outcome labels, which are not
    // indexed — a query about results must not pull the losses.
    expect(ids('upheld in full')).not.toContain('protest-brief:2');
  });

  it('narrows by kind', () => {
    expect(ids('forklifts roll correction', { kinds: ['protest-brief'] })).toEqual([]);
    expect(ids('forklifts roll correction', { kinds: ['correction-motion'] })).toEqual([
      'correction-motion:1',
    ]);
  });

  it('narrows by district, case-insensitively', () => {
    expect(ids('obsolescence idle', { district: 'dallas central appraisal district' })).toEqual([
      'protest-brief:2',
    ]);
  });

  it('narrows by finding key exactly', () => {
    expect(ids('inventory shipped out of texas', { findingKey: 'idle-equipment' })).toEqual([]);
    expect(ids('inventory shipped out of texas', { findingKey: 'freeport' })).toEqual([
      'protest-brief:3',
    ]);
  });

  it('narrows by client', () => {
    expect(ids('obsolescence idle press', { clientId: 'client-2' })).toEqual(['protest-brief:2']);
  });

  it('honours the limit', () => {
    expect(ids('obsolescence idle district value', { limit: 1 }).length).toBe(1);
  });

  it('is silent on a question the firm has never written about', () => {
    expect(ids('what is the weather in Houston tomorrow')).toEqual([]);
  });

  it('is silent on an empty corpus rather than throwing', () => {
    expect(searchPrecedent([], 'obsolescence')).toEqual([]);
  });

  it('is silent on a query that is all stopwords', () => {
    expect(ids('what is the')).toEqual([]);
  });

  it('reports which terms hit', () => {
    const [hit] = searchPrecedent(CORPUS, 'freeport 175 days', { limit: 1 });
    expect(hit?.matched).toEqual(expect.arrayContaining(['freeport', '175']));
  });
});

describe('tallyPrecedent', () => {
  it('counts unresolved apart from a loss', () => {
    const hits = searchPrecedent(CORPUS, 'obsolescence idle freeport inventory', { limit: 10 });
    const tally = tallyPrecedent(hits);
    expect(tally.total).toBe(tally.favorable + tally.unfavorable + tally.unresolved);
    expect(tally.unresolved).toBeGreaterThan(0);
  });

  it('is all zeroes on no hits', () => {
    expect(tallyPrecedent([])).toEqual({
      total: 0,
      favorable: 0,
      unfavorable: 0,
      unresolved: 0,
    });
  });

  it('treats a missing outcome as unresolved, never as favourable', () => {
    const hits = searchPrecedent(CORPUS, 'freeport 175 days', { limit: 1 });
    expect(tallyPrecedent(hits)).toMatchObject({ total: 1, favorable: 0, unresolved: 1 });
  });
});

describe('renderPrecedent', () => {
  it('is empty for no hits', () => {
    expect(renderPrecedent([])).toBe('');
  });

  it('prints the outcome and the warning beside every document', () => {
    const hits = searchPrecedent(CORPUS, 'obsolescence idle press log', { limit: 2 });
    const rendered = renderPrecedent(hits);
    expect(hits.length).toBe(2);
    expect(rendered.match(/not authority/g)?.length).toBe(2);
    expect(rendered).toContain('ARB order');
  });

  it('says so when nothing came of a document, rather than omitting the line', () => {
    const hits = searchPrecedent(CORPUS, 'freeport 175 days', { limit: 1 });
    expect(renderPrecedent(hits)).toContain('Outcome: not recorded');
  });

  it('names the client, district and year a document came from', () => {
    const hits = searchPrecedent(CORPUS, 'forklifts roll correction', { limit: 1 });
    const rendered = renderPrecedent(hits);
    expect(rendered).toContain('Acme Fabrication');
    expect(rendered).toContain('tax year 2024');
  });
});
