import type { AssessabilityTreatment } from '@tangible/types';

/**
 * What a line on an invoice is, for property tax.
 *
 * This is the file the doc's largest category actually turns on, and it is
 * deliberately a **rule table a person can read** rather than a model call. The
 * position "$46,000 of this machine is not taxable property" has to be
 * defensible to a tax director first and an appraiser second, and neither of
 * them will accept "the model thought so". Every rule here names the reason in
 * a sentence and, where one exists, the authority behind it — and the report
 * prints both.
 *
 * Three things follow from that:
 *
 *   - **Rules are jurisdiction-scoped.** Whether freight belongs in the value of
 *     a machine is not a fact about invoices; it is a fact about how a district
 *     builds its schedules. Texas cost schedules are built on *installed* cost,
 *     which is why freight and installation are not on the Texas list even
 *     though a naive reading of "tangible personal property" would put them
 *     there. Getting that wrong is not a small overstatement — it is the kind of
 *     claim that costs the rest of the engagement's credibility.
 *   - **Silence is `unclear`, never `assessable`.** A line the table does not
 *     recognize is a line nobody has ruled on. Calling it assessable is the safe
 *     direction for the district and the wrong direction for honesty: it hides
 *     the fact that a $46,000 "PROJECT SERVICES" line was never looked at.
 *   - **Strength travels with the rule.** Capitalized interest is not property
 *     under any reading. Whether a permit fee is part of the machine's market
 *     value is arguable. Both come out of the assessable cost; they do not
 *     arrive at the taxpayer with the same confidence, and the row says so.
 */

export interface AssessabilityRule {
  id: string;
  treatment: AssessabilityTreatment;
  /** Said the way a preparer would say it to a district. */
  reason: string;
  /** The statute, rule or convention it rests on. Null where it is simply what property is. */
  authority: string | null;
  /** How settled the position is, 0 to 1. Becomes the line's treatment confidence. */
  strength: number;
  /** Matched against the vendor's own wording, lowercased. */
  match: RegExp;
}

/**
 * Texas.
 *
 * Ordered, and order is load-bearing: the first rule that matches wins, so the
 * narrow readings sit above the broad ones. "SOFTWARE MAINTENANCE — YEAR 2"
 * should come out as a service contract rather than as software, and both
 * answers remove it, but only one of them is the reason a district would
 * accept.
 */
const TEXAS: AssessabilityRule[] = [
  {
    id: 'capitalized-interest',
    treatment: 'non-assessable',
    reason: 'Capitalized interest is a financing cost, not property',
    authority: 'Tax Code 11.02 reaches tangible personal property',
    strength: 0.95,
    match: /\b(capitali[sz]ed interest|interest (charge|expense)|finance charge)\b/,
  },
  {
    id: 'sales-tax',
    treatment: 'non-assessable',
    reason: 'Sales tax paid on the purchase is a tax, not a component of the property',
    authority: null,
    strength: 0.6,
    match: /\b(sales tax|use tax|state tax|local tax|vat)\b/,
  },
  {
    id: 'service-contract',
    treatment: 'non-assessable',
    reason: 'A maintenance or service agreement buys future labour, not property',
    authority: null,
    strength: 0.9,
    match:
      /\b(extended warranty|service (contract|agreement|plan)|maintenance (contract|agreement|plan)|support (contract|agreement|plan|renewal)|preventative maintenance|annual support)\b/,
  },
  {
    id: 'training',
    treatment: 'non-assessable',
    reason: 'Training is a service delivered to people, and nothing is left behind to assess',
    authority: null,
    strength: 0.92,
    match: /\b(training|on-?site instruction|operator certification|classroom)\b/,
  },
  {
    id: 'software-licence',
    treatment: 'non-assessable',
    reason: 'A software licence is intangible property and is not on the ad valorem roll',
    authority: 'Tax Code 11.02 — ad valorem tax reaches tangible personal property',
    strength: 0.82,
    match:
      /\b(software|licen[cs]e|licen[cs]ing|subscription|saas|user seats?|perpetual licen[cs]e)\b/,
  },
  {
    id: 'real-property',
    treatment: 'non-assessable',
    reason: 'This is an improvement to real property and belongs on the real account, not this one',
    authority: 'Tax Code 23.24 — an improvement may not be appraised as personal property',
    strength: 0.88,
    match:
      /\b(concrete|foundation|slab|footing|pad(?: work)?|excavat|trenching|masonry|roof|wall|structural steel|building modification|demolition|electrical (?:service|feed|panel|rough)|plumbing rough|hvac duct|fire (?:suppression|sprinkler))\b/,
  },
  {
    id: 'permits-and-fees',
    treatment: 'non-assessable',
    reason: 'A permit or inspection fee buys a permission, not a thing',
    authority: null,
    strength: 0.62,
    match: /\b(permit|inspection fee|filing fee|plan review|code review)\b/,
  },
  {
    id: 'engineering-services',
    treatment: 'non-assessable',
    reason: 'Design and project management are professional services capitalized into the entry',
    authority: null,
    strength: 0.55,
    match:
      /\b(engineering (?:services?|design|fees?)|project management|consult(?:ing|ancy)|design services?|drafting|commissioning services?)\b/,
  },
  {
    id: 'consumables',
    treatment: 'non-assessable',
    reason: 'Consumables and spare parts are not the machine, and are reported as supplies if held',
    authority: 'Form 50-144 Schedule C reports supplies separately',
    strength: 0.5,
    match: /\b(consumables?|spare parts?|wear parts?|lubricant|coolant|filters?|tooling kit)\b/,
  },
  {
    id: 'freight-and-install',
    treatment: 'assessable',
    reason:
      'Texas cost schedules are built on installed cost, so freight and installation stay in the value',
    authority: 'Comptroller and district schedules quote cost delivered and installed',
    strength: 0.85,
    match:
      /\b(freight|shipping|delivery|rigging|installation|install|millwright|setup|set-?up|start-?up|assembly)\b/,
  },
  {
    id: 'equipment',
    treatment: 'assessable',
    reason: 'Tangible equipment at the location on January 1',
    authority: 'Tax Code 21.02 — situs on January 1',
    strength: 0.8,
    match:
      /\b(machine|equipment|conveyor|press|lathe|mill|pump|compressor|robot|forklift|rack|shelving|workstation|server|laptop|desktop|monitor|printer|furniture|desk|chair|cabinet|vehicle|trailer)\b/,
  },
];

/**
 * The Texas rules that survive into Florida, re-cited.
 *
 * Every inherited rule with a Texas authority needs one here, and a test asserts
 * that no rule in the Florida list quotes the Texas Tax Code. That test is the
 * point of the table: the *answers* mostly carry across a state line — software
 * is intangible in both places, sales tax is not property in either — but a
 * correct position filed against the wrong state's statute is a position a
 * property appraiser stops reading at the citation. A rule with no Texas
 * authority to begin with (`sales-tax`, `training`, `permits-and-fees`) is
 * absent here on purpose; there is nothing to re-cite.
 *
 * Section-level citations only. The subsection letters in 192.001 are checked;
 * nothing below reaches for a paragraph nobody has opened.
 */
const FL_AUTHORITIES: Readonly<Record<string, string>> = {
  'capitalized-interest': 's. 192.001(11)(d), F.S. defines tangible personal property',
  'software-licence':
    's. 192.001(11)(d), F.S. — tangible personal property does not reach intangibles',
  consumables: 'DR-405 reports supplies separately from equipment',
  'freight-and-install': 'DR-405 asks for original installed cost',
  equipment: 's. 192.032, F.S. — situs of tangible personal property, assessed as of January 1',
};

/**
 * Florida.
 *
 * This is the list the "a state whose rules genuinely differ gets its own"
 * sentence below was written for, and writing it is what proved the split was
 * real. Three of the Texas rules are wrong in Florida, and one of them is wrong
 * in the expensive direction.
 *
 *   - **Tenant build-out is taxable and says so on the form.** Line 20 of the
 *     DR-405 asks for leasehold improvements by name. The Texas
 *     `real-property` rule leans on Tax Code 23.24, which bars appraising as
 *     personal property an improvement the real-property appraisal already
 *     includes — there is no Florida analogue, and running the Texas rule here
 *     would strip a tenant's whole build-out off a return the county built to
 *     collect it. So a build-out rule sits *above* the real-property rule and
 *     rules it assessable; first match wins, and that ordering is the fix.
 *   - **Inventory is exempt outright** under s. 196.185, F.S., where in Texas
 *     it is rendered at full cost. An invoice line that is stock rather than
 *     equipment comes off the Florida return entirely.
 *   - **The authorities change even where the answer does not.** Software is
 *     off the roll in both states, but citing the Texas Tax Code to a Florida
 *     property appraiser is how a correct position gets dismissed unread.
 *
 * Freight and installation stay assessable: the DR-405 asks for original
 * installed cost, so Florida shares the convention that made freight assessable
 * in Texas even though it does not share the schedule that produced it.
 */
const FLORIDA: AssessabilityRule[] = [
  {
    id: 'fl-inventory',
    treatment: 'non-assessable',
    reason: 'Inventory is exempt from ad valorem taxation and does not belong on the return',
    authority: 's. 196.185, F.S.',
    strength: 0.92,
    match:
      /\b(inventory|goods held for (?:sale|lease)|finished goods|raw materials?|work in process|stock in trade|merchandise for resale)\b/,
  },
  {
    id: 'fl-leasehold-improvement',
    treatment: 'assessable',
    reason:
      'Tenant build-out is reported as tangible personal property on line 20 of the DR-405, so it stays in',
    authority: 'DR-405 line 20 — leasehold improvements',
    strength: 0.85,
    match:
      /\b(leasehold improvements?|tenant (?:improvements?|build-?out|finish)|build-?out|store fixtures? installation)\b/,
  },
  ...TEXAS.filter((rule) => rule.id !== 'real-property').map((rule) => {
    const reauthored = FL_AUTHORITIES[rule.id];
    return reauthored === undefined ? rule : { ...rule, authority: reauthored };
  }),
  {
    /**
     * Placed last rather than in the Texas position. In Texas this rule fires
     * before the equipment rule and takes concrete, ductwork and electrical
     * rough-in off the return. In Florida the same wording inside a tenant
     * build-out is line 20 property, so the build-out rule above claims it
     * first and only genuinely structural work — work on a building the
     * taxpayer owns — reaches here.
     */
    id: 'fl-real-property',
    treatment: 'non-assessable',
    reason:
      'This is an improvement to real property and is appraised on the real property roll, not the tangible return',
    authority: 's. 192.001(12), F.S. — real property includes buildings and fixtures to land',
    strength: 0.7,
    match:
      /\b(concrete|foundation|slab|footing|excavat|trenching|masonry|roof|structural steel|building (?:modification|shell)|demolition)\b/,
  },
];

/**
 * Everywhere else, for now.
 *
 * The same table minus the freight rule, because "installed cost" is a Texas
 * schedule convention rather than a universal one, and minus nothing else — the
 * removals above are about what property *is*, which does not change at a state
 * line. A state whose rules genuinely differ gets its own list rather than a
 * flag on this one, which is what Florida now has.
 */
const DEFAULT_RULES: AssessabilityRule[] = TEXAS.filter(
  (rule) => rule.id !== 'freight-and-install',
);

export function rulesFor(jurisdictionId: string | null): AssessabilityRule[] {
  if (jurisdictionId === null || jurisdictionId.startsWith('tx-')) return TEXAS;
  if (jurisdictionId === 'fl' || jurisdictionId.startsWith('fl-')) return FLORIDA;
  return DEFAULT_RULES;
}

export interface LineRuling {
  treatment: AssessabilityTreatment;
  reason: string | null;
  authority: string | null;
  confidence: number;
  ruleId: string | null;
}

const UNRULED: LineRuling = {
  treatment: 'unclear',
  reason: null,
  authority: null,
  confidence: 0,
  ruleId: null,
};

/** The first rule that recognizes this wording, or nothing at all. */
export function ruleLine(description: string, jurisdictionId: string | null): LineRuling {
  const text = description.toLowerCase();
  for (const rule of rulesFor(jurisdictionId)) {
    if (!rule.match.test(text)) continue;
    return {
      treatment: rule.treatment,
      reason: rule.reason,
      authority: rule.authority,
      confidence: rule.strength,
      ruleId: rule.id,
    };
  }
  return UNRULED;
}

export interface SplitLine {
  description: string;
  amount: number | null;
  treatment: AssessabilityTreatment;
  readConfidence: number;
  treatmentConfidence: number;
}

export interface InvoiceSplitResult {
  /** What the lines add to. */
  total: number;
  assessable: number;
  nonAssessable: number;
  unclear: number;
  excluded: { label: string; amount: number }[];
  /**
   * The weakest thing about this reading, which is what a reviewer should be
   * shown. An average would hide one badly-read $80,000 line behind forty
   * clean ones.
   */
  confidence: number;
}

/**
 * Add the lines up by treatment.
 *
 * Unclear cost is counted and kept separate rather than folded into either
 * side. It is the number that says how much of this invoice nobody has ruled
 * on, and a preparer looking at a 40%-unclear invoice should see that before
 * they see a saving.
 */
export function splitInvoice(lines: readonly SplitLine[]): InvoiceSplitResult {
  let assessable = 0;
  let nonAssessable = 0;
  let unclear = 0;
  const excluded: { label: string; amount: number }[] = [];
  let weakest = 1;

  for (const line of lines) {
    const amount = line.amount ?? 0;
    if (amount === 0) continue;
    weakest = Math.min(weakest, line.readConfidence);
    if (line.treatment === 'non-assessable') {
      nonAssessable += amount;
      excluded.push({ label: line.description, amount });
      weakest = Math.min(weakest, line.treatmentConfidence);
    } else if (line.treatment === 'unclear') {
      unclear += amount;
    } else {
      assessable += amount;
    }
  }

  return {
    total: assessable + nonAssessable + unclear,
    assessable,
    nonAssessable,
    unclear,
    excluded,
    confidence: lines.length === 0 ? 0 : weakest,
  };
}

/**
 * One asset's share of everything invoiced against it.
 *
 * Where an invoice covers several capitalized lines, the non-assessable content
 * is split by the link's `share` rather than traced — the document does not say
 * which of three machines the concrete pad was for. That is an allocation, and
 * the returned confidence is knocked down for it, because a reviewer should be
 * able to tell a measured split from an apportioned one without opening
 * anything.
 *
 * Unclear cost stays on the assessable side. Not because it is assessable, but
 * because the alternative is claiming a saving for a line nobody has read.
 */
export function splitForAsset(input: {
  assetId: string;
  bookedCost: number;
  reviewed: boolean;
  contributions: readonly {
    documentLabel: string | null;
    share: number;
    nonAssessable: number;
    excluded: { label: string; amount: number }[];
    confidence: number;
  }[];
}): {
  assetId: string;
  bookedCost: number;
  assessableCost: number;
  excluded: { label: string; amount: number }[];
  extractionConfidence: number;
  reviewed: boolean;
  documentLabel: string | null;
} | null {
  if (input.contributions.length === 0 || input.bookedCost <= 0) return null;
  let removed = 0;
  let confidence = 1;
  const excluded: { label: string; amount: number }[] = [];
  for (const contribution of input.contributions) {
    const share = Math.max(0, Math.min(1, contribution.share));
    removed += contribution.nonAssessable * share;
    confidence = Math.min(confidence, contribution.confidence);
    if (share < 1) confidence = Math.min(confidence, 0.6);
    for (const line of contribution.excluded) {
      excluded.push({ label: line.label, amount: line.amount * share });
    }
  }
  if (removed <= 0) return null;
  return {
    assetId: input.assetId,
    bookedCost: input.bookedCost,
    // Never below zero: an invoice whose exclusions exceed the capitalized
    // amount is a linking error, not a machine worth nothing.
    assessableCost: Math.max(0, input.bookedCost - removed),
    excluded,
    extractionConfidence: confidence,
    reviewed: input.reviewed,
    documentLabel:
      input.contributions.length === 1
        ? input.contributions[0]!.documentLabel
        : `${input.contributions.length} invoices`,
  };
}
