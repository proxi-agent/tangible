"""Emit the extracted HCAD schedules as a committed TypeScript data module."""

import json

data = json.load(open("schedules-2026.json"))
main, special = data["main"], data["special"]

MAIN_LIVES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
SPECIAL = ["pc", "spc", "mf", "telecom4", "telecom6", "telecom8", "solar10"]

years = sorted(main, key=int, reverse=True)
special_years = sorted(special, key=int, reverse=True)


def index_block():
    return "\n".join(f"    {y}: {main[y]['indexFactor']:.3f}," for y in years)


def percent_good_block(source, keys, quote=False):
    lines = []
    for key in keys:
        name = f"'{key}'" if quote else key
        rows = [
            (y, source[y]["percentGood"][str(key) if not quote else key])
            for y in (special_years if quote else years)
            if (str(key) if not quote else key) in source[y]["percentGood"]
        ]
        pairs = " ".join(f"{y}: {v}," for y, v in rows)
        lines.append(f"    {name}: {{ {pairs} }},")
    return "\n".join(lines)


ts = f"""/**
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

import type {{ DepreciationSchedule }} from '../types.js';

export const TX_HARRIS_2026: DepreciationSchedule = {{
  jurisdictionId: 'tx-harris',
  taxYear: 2026,
  source: {{
    title: 'HCAD BPP Schedule Value Calculation Guidelines, Tax Year 2026',
    url: 'https://hcad.org/assets/uploads/pdf/resources/2026/2026-PP-Calc-Guide.pdf',
    pages: '3-4',
  }},

  /** Cost index by year acquired; 2025 is the base year at 1.000. */
  indexFactors: {{
{index_block()}
  }},

  /** Percent good by life class, then by year acquired. */
  percentGood: {{
{percent_good_block(main, MAIN_LIVES)}
  }},

  /**
   * The un-indexed schedules, which are keyed by equipment type rather than a
   * life in years: personal computers, specific equipment (telephone systems,
   * mobile radio, cellular, fax), mainframes and point-of-sale registers, and
   * the industrial telecom and solar schedules.
   */
  specialPercentGood: {{
{percent_good_block(special, SPECIAL, quote=True)}
  }},
}};
"""

open("tx-harris-2026.ts", "w").write(ts)
print(ts[:1600])
print("...\nwrote tx-harris-2026.ts")
