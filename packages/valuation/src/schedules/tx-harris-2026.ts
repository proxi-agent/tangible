/**
 * Harris County's published business personal property valuation schedules for
 * tax year 2026.
 *
 * Source: Harris Central Appraisal District, "Business & Industrial Personal
 * Property Division — Schedule Value Calculation Guidelines, Tax Year 2026",
 * pages 3 and 4 (PDF pages 5 and 6).
 * https://hcad.org/assets/uploads/pdf/resources/2026/2026-PP-Calc-Guide.pdf
 *
 * Generated from that PDF and committed rather than parsed at runtime: these
 * are published figures that change once a year, and a number that decides a
 * client's rendition should be reviewable in a diff. Every value below was
 * checked against the invariant that percent good never rises as an asset ages.
 *
 * HCAD's method is: reported original cost x index factor x percent good. The
 * index factor restates historical cost as replacement cost new (Marshall
 * Valuation Service national equipment cost index, October issue); the percent
 * good then depreciates it. The computer, specific-equipment, and industrial
 * telecom/solar schedules carry an index factor of 1.000 — they depreciate
 * without being trended up first.
 *
 * A year older than the oldest row here is not an error: the class has reached
 * its floor, and `floorPercentGood` is what applies. See `appraise`.
 */

import type { DepreciationSchedule } from '../types.js';
import { TX_HARRIS_2026_SIC } from './tx-harris-2026-sic.js';

export const TX_HARRIS_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-harris:2026',
    title: 'Harris County BPP depreciation schedules, tax year 2026',
    citation:
      'HCAD Business & Industrial Personal Property Division, Schedule Value Calculation Guidelines, Tax Year 2026, pp. 3-4. Method authorised by Tex. Tax Code 23.01(b) (market value determined by generally accepted appraisal methods).',
    source: {
      title: 'HCAD BPP Schedule Value Calculation Guidelines, Tax Year 2026',
      url: 'https://hcad.org/assets/uploads/pdf/resources/2026/2026-PP-Calc-Guide.pdf',
      pages: '3-4',
    },
    // The guide governs one tax year. Written as the year rather than as the
    // day the next guide appears, because the next guide's date is unknowable
    // and a window that ends "when something else happens" never closes.
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-harris'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-20',
    /**
     * Null, and it should stay null until somebody with standing has actually
     * checked these tables against the published guide page by page. The gate
     * reports it; the baseline acknowledges it with a date, so the fact that
     * this is outstanding is visible rather than absent.
     */
    approvedBy: null,
    approvedAt: null,
    notes:
      'Transcribed from the published PDF and checked against the invariant that percent good never rises as an asset ages. Not yet re-checked cell by cell by a licensed preparer.',
  },
  jurisdictionId: 'tx-harris',
  jurisdictionName: 'Harris County, TX',
  taxYear: 2026,
  source: {
    title: 'HCAD BPP Schedule Value Calculation Guidelines, Tax Year 2026',
    url: 'https://hcad.org/assets/uploads/pdf/resources/2026/2026-PP-Calc-Guide.pdf',
    pages: '3-4',
  },

  /** Cost index by year acquired; 2025 is the base year at 1.000. */
  indexFactors: {
    2025: 1.0,
    2024: 1.033,
    2023: 1.048,
    2022: 1.066,
    2021: 1.252,
    2020: 1.362,
    2019: 1.369,
    2018: 1.418,
    2017: 1.467,
    2016: 1.496,
    2015: 1.484,
    2014: 1.498,
    2013: 1.517,
    2012: 1.53,
    2011: 1.573,
    2010: 1.623,
    2009: 1.611,
    2008: 1.657,
    2007: 1.722,
    2006: 1.816,
    2005: 1.901,
    2004: 2.044,
    2003: 2.114,
    2002: 2.15,
    2001: 2.163,
    2000: 2.181,
    1999: 2.221,
    1998: 2.228,
    1997: 2.247,
    1996: 2.283,
    1995: 2.318,
    1994: 2.401,
    1993: 2.469,
    1992: 2.517,
    1991: 2.547,
    1990: 2.599,
    1989: 2.668,
    1988: 2.811,
    1987: 2.931,
    1986: 2.974,
    1985: 3.002,
    1984: 3.046,
    1983: 3.129,
  },

  /** Percent good by life class, then by year acquired. */
  percentGood: {
    3: { 2025: 65, 2024: 39, 2023: 26, 2022: 13 },
    4: { 2025: 75, 2024: 56, 2023: 42, 2022: 27, 2021: 13 },
    5: { 2025: 85, 2024: 69, 2023: 52, 2022: 34, 2021: 23, 2020: 18, 2019: 13 },
    6: { 2025: 87, 2024: 73, 2023: 57, 2022: 41, 2021: 30, 2020: 23, 2019: 19, 2018: 13 },
    8: {
      2025: 90,
      2024: 79,
      2023: 67,
      2022: 54,
      2021: 43,
      2020: 33,
      2019: 26,
      2018: 22,
      2017: 20,
      2016: 13,
    },
    10: {
      2025: 92,
      2024: 84,
      2023: 76,
      2022: 67,
      2021: 58,
      2020: 49,
      2019: 39,
      2018: 30,
      2017: 24,
      2016: 21,
      2015: 20,
      2014: 13,
    },
    12: {
      2025: 94,
      2024: 87,
      2023: 80,
      2022: 73,
      2021: 66,
      2020: 58,
      2019: 50,
      2018: 43,
      2017: 36,
      2016: 29,
      2015: 24,
      2014: 22,
      2013: 20,
      2012: 13,
    },
    15: {
      2025: 95,
      2024: 90,
      2023: 85,
      2022: 79,
      2021: 73,
      2020: 68,
      2019: 62,
      2018: 55,
      2017: 49,
      2016: 43,
      2015: 37,
      2014: 31,
      2013: 26,
      2012: 23,
      2011: 21,
      2010: 20,
    },
    20: {
      2025: 97,
      2024: 93,
      2023: 90,
      2022: 86,
      2021: 82,
      2020: 78,
      2019: 74,
      2018: 70,
      2017: 65,
      2016: 60,
      2015: 55,
      2014: 50,
      2013: 45,
      2012: 40,
      2011: 35,
      2010: 31,
      2009: 27,
      2008: 24,
      2007: 22,
      2006: 21,
      2005: 21,
      2004: 20,
    },
    25: {
      2025: 98,
      2024: 95,
      2023: 93,
      2022: 90,
      2021: 87,
      2020: 84,
      2019: 81,
      2018: 78,
      2017: 75,
      2016: 71,
      2015: 68,
      2014: 64,
      2013: 60,
      2012: 56,
      2011: 52,
      2010: 48,
      2009: 44,
      2008: 39,
      2007: 34,
      2006: 30,
      2005: 30,
      2004: 26,
      2003: 26,
      2002: 23,
      2001: 23,
      2000: 21,
    },
    30: {
      2025: 98,
      2024: 97,
      2023: 95,
      2022: 93,
      2021: 91,
      2020: 89,
      2019: 86,
      2018: 84,
      2017: 82,
      2016: 79,
      2015: 76,
      2014: 74,
      2013: 71,
      2012: 68,
      2011: 65,
      2010: 61,
      2009: 58,
      2008: 54,
      2007: 51,
      2006: 47,
      2005: 47,
      2004: 40,
      2003: 40,
      2002: 34,
      2001: 34,
      2000: 28,
      1999: 28,
      1998: 23,
      1997: 23,
      1996: 21,
      1995: 21,
      1994: 20,
    },
  },

  /**
   * The un-indexed schedules, which are keyed by equipment type rather than a
   * life in years: personal computers, specific equipment (telephone systems,
   * mobile radio, cellular, fax), mainframes and point-of-sale registers, and
   * the industrial telecom and solar schedules.
   */
  specialPercentGood: {
    pc: { 2025: 78, 2024: 56, 2023: 35, 2022: 13, 2021: 10 },
    spc: { 2025: 78, 2024: 63, 2023: 50, 2022: 39, 2021: 25, 2020: 10 },
    mf: { 2025: 85, 2024: 70, 2023: 55, 2022: 40, 2021: 25, 2020: 10 },
    telecom4: { 2025: 75, 2024: 56, 2023: 42, 2022: 27, 2021: 13 },
    telecom6: { 2025: 87, 2024: 73, 2023: 57, 2022: 41, 2021: 30, 2020: 23, 2019: 19, 2018: 13 },
    telecom8: {
      2025: 90,
      2024: 79,
      2023: 67,
      2022: 54,
      2021: 43,
      2020: 33,
      2019: 26,
      2018: 22,
      2017: 20,
      2016: 13,
    },
    solar10: {
      2025: 92,
      2024: 84,
      2023: 76,
      2022: 67,
      2021: 58,
      2020: 49,
      2019: 39,
      2018: 30,
      2017: 24,
      2016: 21,
      2015: 20,
      2014: 20,
    },
  },
  sicProfiles: TX_HARRIS_2026_SIC,
  status: 'committed',
};
