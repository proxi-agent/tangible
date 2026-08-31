import { describe, expect, it } from 'vitest';
import {
  APPRAISAL_DISTRICTS,
  appraisalDistrict,
  appraisalDistrictCounty,
  appraisalDistrictName,
} from './districts.js';
import { DISTRICT_RECORDS } from './districts.data.js';

/**
 * The twelve names this file held before the directory was loaded.
 *
 * Kept as a literal rather than deleted, because each was typed off the
 * district's own letterhead one at a time, and the generated table has to agree
 * with every one of them. It does — including the three a rule built from the
 * county name would have got wrong.
 */
const HAND_TYPED: Readonly<Record<string, string>> = {
  'tx-harris': 'Harris Central Appraisal District',
  'tx-dallas': 'Dallas Central Appraisal District',
  'tx-tarrant': 'Tarrant Appraisal District',
  'tx-bexar': 'Bexar Appraisal District',
  'tx-travis': 'Travis Central Appraisal District',
  'tx-collin': 'Collin Central Appraisal District',
  'tx-denton': 'Denton Central Appraisal District',
  'tx-fort-bend': 'Fort Bend Central Appraisal District',
  'tx-williamson': 'Williamson Central Appraisal District',
  'tx-montgomery': 'Montgomery Central Appraisal District',
  'tx-galveston': 'Galveston Central Appraisal District',
  'tx-el-paso': 'El Paso Central Appraisal District',
};

describe('the appraisal district directory', () => {
  it('still gives the twelve names that were typed by hand', () => {
    for (const [id, name] of Object.entries(HAND_TYPED)) {
      expect(appraisalDistrictName(id), id).toBe(name);
    }
  });

  it('covers 254 counties with 253 districts, which is how many Texas has', () => {
    const counties = DISTRICT_RECORDS.flatMap((d) => d.counties);
    expect(DISTRICT_RECORDS).toHaveLength(253);
    expect(counties).toHaveLength(254);
    expect(new Set(counties.map((c) => c.id)).size).toBe(254);
    expect(new Set(counties.map((c) => c.code)).size).toBe(254);
  });

  it('has one district serving two counties, and it is Potter-Randall', () => {
    const shared = DISTRICT_RECORDS.filter((d) => d.counties.length > 1);
    expect(shared.map((d) => d.name)).toEqual(['Potter-Randall County Appraisal District']);
    // The same record, not two equal ones: one office, one address, one filing.
    expect(appraisalDistrict('tx-potter')).toBe(appraisalDistrict('tx-randall'));
  });

  it('names itself, rather than being named after its county', () => {
    // The claim the module's doc block makes, asserted so it cannot quietly
    // stop being true. A rule that built the name from the county would be
    // wrong on these, and wrong on a document filed with the entity it misnames.
    const derivable = DISTRICT_RECORDS.filter((d) =>
      d.counties.some((c) => d.name === `${c.name} County Appraisal District`),
    );
    expect(DISTRICT_RECORDS.length - derivable.length).toBe(91);
    expect(appraisalDistrictName('tx-bell')).toBe('Tax Appraisal District of Bell County');
    expect(appraisalDistrictName('tx-comal')).toBe('Comal Appraisal District');
  });

  it('spells "Appraisal District" the same way 253 times', () => {
    // The generator repairs that phrase and nothing else, so a misspelling here
    // means a correction was missed rather than a district being unusual.
    for (const d of DISTRICT_RECORDS) {
      expect(d.name, d.name).toMatch(/\bAppraisal District\b/);
      expect(d.name.match(/Appraisal District/g), d.name).toHaveLength(1);
      expect(d.name, d.name).not.toMatch(/\bOf\b/);
    }
  });

  it('gives every district somewhere to send the paper', () => {
    // Tax Code 1.08: a properly addressed, postmarked document is filed on the
    // day it was mailed. Without the address there is no timely filing to make.
    for (const d of DISTRICT_RECORDS) {
      expect(d.mailingAddress.length, d.name).toBeGreaterThanOrEqual(2);
      expect(d.mailingAddress.at(-1), d.name).toMatch(/,\s*(TX|Texas)\s+\d{5}/);
      expect(d.directoryUpdated, d.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('refuses to name a district it does not have, rather than inventing one', () => {
    expect(appraisalDistrictName('fl-broward')).toBeNull();
    expect(appraisalDistrictName('tx-nonesuch')).toBeNull();
    expect(appraisalDistrict('')).toBeNull();
  });

  it('offers one picker row per county, so every choice resolves to a name', () => {
    expect(APPRAISAL_DISTRICTS).toHaveLength(254);
    for (const option of APPRAISAL_DISTRICTS) {
      expect(appraisalDistrictName(option.id), option.id).toBe(option.name);
    }
    const labels = APPRAISAL_DISTRICTS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect([...labels]).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('appends the county only where two rows would otherwise read alike', () => {
    expect(APPRAISAL_DISTRICTS.find((o) => o.id === 'tx-potter')?.label).toBe(
      'Potter-Randall County Appraisal District — Potter County',
    );
    expect(APPRAISAL_DISTRICTS.find((o) => o.id === 'tx-harris')?.label).toBe(
      'Harris Central Appraisal District',
    );
    const appended = APPRAISAL_DISTRICTS.filter((o) => o.label !== o.name);
    expect(appended.map((o) => o.id)).toEqual(['tx-potter', 'tx-randall']);
  });
});

describe('the county a jurisdiction names', () => {
  it('gives the county, not the district that serves it', () => {
    expect(appraisalDistrictCounty('tx-harris')).toBe('Harris');
    expect(appraisalDistrictCounty('tx-bell')).toBe('Bell');
  });

  it('gives a shared district the right half of itself', () => {
    // Every county blank on the forms sits in a sentence naming one county.
    expect(appraisalDistrictCounty('tx-potter')).toBe('Potter');
    expect(appraisalDistrictCounty('tx-randall')).toBe('Randall');
  });

  it('names no county for an id outside the directory', () => {
    expect(appraisalDistrictCounty('fl-broward')).toBeNull();
  });

  it('answers for all 254, which is what the forms need', () => {
    for (const option of APPRAISAL_DISTRICTS) {
      expect(appraisalDistrictCounty(option.id), option.id).not.toBeNull();
    }
  });
});
