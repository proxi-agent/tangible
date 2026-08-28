import type { RuleProvenance } from '@tangible/types';

/**
 * Every detector, as a rule with an authority behind it.
 *
 * The detectors already carried their statutory hook: each finding prints a
 * `basis` and clients read it. What was missing is everything around the hook —
 * when it started applying, where it applies, who wrote it down and who checked
 * it. Those are the fields that make a rule *repository* rather than a folder
 * of functions, and they are what a district's counsel would ask for.
 *
 * Two conventions worth stating, because both are load-bearing:
 *
 * `jurisdictions: ['tx-*']` means every Texas appraisal district. Every citation
 * below is Texas law, and the register that arrives next may well be Alabama's
 * — so the scope is written down and the gate refuses to analyse a jurisdiction
 * no rule claims, rather than silently applying Tax Code 21.02 to a Florida
 * account.
 *
 * `effectiveFrom: '2021-01-01'` on a long-standing statute is not a claim about
 * when the legislature passed it. It is the earliest tax year this product can
 * act on: Tax Code 25.25(c) reaches the five preceding years, so from tax year
 * 2026 nothing before 2021 is correctable and the statute's own enactment date
 * carries no information. Where a rule has a real recent amendment — 11.145 as
 * raised by HB 9 — the date is that amendment's, and it matters.
 */

/** The earliest tax year a 2026 engagement can reach under 25.25(c). */
const REACHABLE_FROM = '2021-01-01';

const LONG_STANDING =
  "Long-standing statute. The effective date is the earliest tax year reachable under Tax Code 25.25(c) from the 2026 season, not the statute's enactment — anything earlier cannot be corrected and so cannot be relied on.";

function texasRule(
  key: string,
  title: string,
  citation: string,
  extra: Partial<RuleProvenance> = {},
): RuleProvenance {
  return {
    ruleId: `detector:${key}`,
    title,
    citation,
    source: null,
    effectiveFrom: REACHABLE_FROM,
    effectiveTo: null,
    jurisdictions: ['tx-*'],
    taxYears: null,
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-24',
    approvedBy: null,
    approvedAt: null,
    notes: LONG_STANDING,
    ...extra,
  };
}

export const DETECTOR_RULES: readonly RuleProvenance[] = [
  texasRule(
    'ghost-assets',
    'Property disposed of before the lien date',
    'Tex. Tax Code 22.01(a) (render property owned or managed on January 1); 25.25(c)(3) (property that does not exist in the form or at the location described).',
  ),
  texasRule(
    'non-taxable',
    'Real property and leasehold improvements on a personal property register',
    'Tex. Tax Code 11.02 (ad valorem tax on tangible personal property); 23.24 (improvements appraised with the real property).',
  ),
  texasRule(
    'fully-depreciated',
    'Property at the schedule floor rendered above it',
    "HCAD Schedule Value Calculation Guidelines (each life class stops at a published floor); Tex. Tax Code 23.01(b) (market value by generally accepted methods).",
    { jurisdictions: ['tx-harris'], notes: 'Scoped to Harris because the floor is a property of that district\'s published table. Widening it means loading the other district\'s schedule first.' },
  ),
  texasRule(
    'leasehold-double-tax',
    'Tenant improvements already inside the landlord\'s real property assessment',
    'Tex. Tax Code 23.24 (an improvement may not be appraised as personal property where the real property appraisal includes it).',
  ),
  texasRule(
    'freeport',
    'Goods-in-transit inventory eligible for the freeport exemption',
    'Tex. Tax Code 11.251 (goods detained 175 days or less for assembly, storage, manufacturing or fabrication before leaving the state); Tex. Const. art. VIII, s. 1-j.',
    {
      notes:
        'Freeport is local-option: a taxing unit may have taxed it out before 1990. The detector raises the question and does not assert the exemption, which is why this scope is safe.',
    },
  ),
  texasRule(
    'duplicate-capitalization',
    'The same property rendered more than once',
    'Tex. Tax Code 25.25(c)(2) (multiple appraisals of a property in one year).',
  ),
  texasRule(
    'non-assessable-cost',
    'Freight, installation, software and tax capitalized into an equipment line',
    'Tex. Tax Code 11.02 (the tax reaches tangible personal property, not the capitalized accounting total); 23.01(b).',
  ),
  texasRule(
    'situs-error',
    'Property rendered to the wrong district',
    'Tex. Tax Code 21.02 (taxable situs on January 1); 25.25(c)(3) (property not at the location described).',
  ),
  texasRule(
    'misclassification',
    'Property valued on the wrong life class',
    "HCAD Schedule Value Calculation Guidelines (class decides index factor and percent good; machinery lives read off the district's SIC table).",
    { jurisdictions: ['tx-harris'], notes: 'The SIC-to-life mapping is HCAD\'s own table. Another district publishes its own, so this rule does not travel.' },
  ),
  texasRule(
    'leased-double-report',
    'Right-of-use assets rendered by the lessee',
    'Tex. Tax Code 22.01(a) (the owner or the person in control renders); FASB ASC 842 (operating leases capitalized as right-of-use assets).',
  ),
  texasRule(
    'de-minimis',
    'Total property under the small-business exemption',
    'Tex. Tax Code 11.145, as amended by HB 9 (89th Leg., 2025) and approved as Proposition 9 — $125,000 per taxing unit from tax year 2026, $2,500 before it.',
    {
      effectiveFrom: '2026-01-01',
      taxYears: [2026],
      notes:
        'The threshold changed, so this rule is genuinely year-scoped: a 2025 or earlier year uses the $2,500 figure, which `exemptionFor` carries separately. Re-check when the 2027 roll opens.',
    },
  ),
  texasRule(
    'carryforward-error',
    "Last year's rendition copied forward with an overstated bucket",
    'Tex. Tax Code 25.25(c-1) (inaccuracy in appraised value of personal property caused by an error or omission in a rendition, current year and either of the two preceding).',
    {
      effectiveFrom: '2024-01-01',
      notes:
        'Narrower window than the others on purpose: (c-1) reaches two preceding years, not five, so from 2026 nothing before 2024 is reachable by this route.',
    },
  ),
  texasRule(
    'suspected-retired',
    'Old property with no corroborating record',
    'Tex. Tax Code 22.01(a). A screening rule: it raises a question about ownership on January 1 rather than asserting a disposal.',
    {
      notes:
        'Deliberately below the medium confidence threshold. Nothing in a register proves an asset is gone, and this rule exists to direct a walk-through, not to support a position.',
    },
  ),
  texasRule(
    'idle-obsolete',
    'Impaired or idle property carried at schedule value',
    'Tex. Tax Code 23.01 (market value); functional and economic obsolescence argued from the impairment the accountant already signed.',
  ),
];

export function ruleFor(findingKey: string): RuleProvenance | undefined {
  return DETECTOR_RULES.find((rule) => rule.ruleId === `detector:${findingKey}`);
}

export const DETECTOR_RULE_KEYS: readonly string[] = DETECTOR_RULES.map((r) =>
  r.ruleId.replace(/^detector:/, ''),
);
