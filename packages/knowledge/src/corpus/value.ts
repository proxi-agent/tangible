import type { KnowledgeArticle } from '../types.js';

/**
 * How a number is arrived at: the district's arithmetic, the exemptions that
 * sit on top of it, and the reading of a register that decides what enters
 * the arithmetic at all.
 *
 * The classification articles are the commercially load-bearing ones. A
 * schedule argument moves a value by a depreciation table; deciding a line is
 * not business personal property at all takes the whole cost off.
 */
export const VALUE_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'valuation-how-a-district-values',
    title: 'Cost, index factor, percent good',
    jurisdiction: 'tx',
    topics: ['valuation'],
    authority: ['Tax Code 23.01', 'Tax Code 23.12', 'HCAD Personal Property Valuation Guide'],
    keywords: [
      'depreciation',
      'schedule',
      'percent good',
      'index factor',
      'life class',
      'how is value calculated',
      'replacement cost',
      'market value',
    ],
    body: `Tax Code 23.01 requires property to be appraised at market value, and 23.12 says the market value of inventory is its price for a sale as a unit. For everything else on a business personal property account, districts reach market value through a cost approach, because there is no market in a used three-year-old point-of-sale terminal to observe.

The arithmetic, in the form Harris County publishes it: reported original cost, multiplied by an index factor that trends the historical cost to current replacement cost, multiplied by a percent good that depreciates it for age. Cost x index x percent good.

Which percent-good table applies depends on the asset's life class, and the life class comes from the district's category table — furniture and fixtures depreciate on a different curve than computers. Some categories are driven not by the asset but by what the business does, keyed to its SIC code, which is why the same shelving unit can be valued on different lives at a restaurant and at a warehouse.

Two consequences follow. First, an asset with no acquisition year cannot be valued at all by this method, so a register with blank years produces gaps rather than numbers. Second, the tables floor out — an asset never depreciates to nothing while it is still on the register, which is exactly why assets that were scrapped years ago keep drawing tax.`,
    related: ['classification-what-is-not-bpp', 'valuation-sic-and-life'],
  },
  {
    id: 'valuation-sic-and-life',
    title: 'Why the same asset gets a different life at a different business',
    jurisdiction: 'tx',
    topics: ['valuation', 'classification'],
    authority: ['HCAD Personal Property Valuation Guide'],
    keywords: [
      'SIC',
      'sic code',
      'life',
      'life class',
      'business type',
      'why is my life different',
      'category default',
    ],
    body: `A district's category table is not purely a table of assets. Several categories are keyed to what the business does, using its SIC code, so the life class assigned to a line depends on the taxpayer as well as on the property.

Where a SIC code is not known, those categories fall back to the category's published default life. That fallback is a real difference in outcome, not a formality, and it is worth reporting rather than hiding: a client whose SIC is unset may be valued on a longer life than the district would actually use.

The practical implication for intake is that a client's SIC code is not optional metadata. It is an input to the valuation, and getting it from the client early is cheaper than arguing a schedule later.`,
    related: ['valuation-how-a-district-values'],
  },
  {
    id: 'classification-what-is-not-bpp',
    title: 'What sits on a fixed asset register that is not business personal property',
    jurisdiction: 'tx',
    topics: ['classification'],
    authority: ['Tax Code 1.04', 'Tax Code 11.01', 'Tax Code 23.24'],
    keywords: [
      'exclusion',
      'not taxable',
      'real property',
      'intangible',
      'software',
      'leased',
      'lessor',
      'double taxed',
      'ghost asset',
      'disposed',
    ],
    body: `A fixed asset register is a book record kept for depreciation. It is not a list of taxable personal property, and the gap between the two is the largest single lever in a business personal property engagement.

Real property carried on the register. Land, buildings, roofs, HVAC serving the structure, permanent electrical and plumbing, parking. These are appraised as real property and taxed there; rendering them again on the personal property account taxes the same thing twice. Tenant build-out is the near case and belongs in leasehold improvements instead, where Tax Code 23.24 governs.

Intangible and non-property cost. Capitalized software licences, implementation labour, training, and other costs that were capitalized for book purposes but are not tangible property at all.

Property of others. A copier leased from a lessor who renders it themselves; consigned inventory; equipment owned by a customer. Rendering it means two parties render one asset.

Ghost assets. Property disposed of, scrapped, or moved but never retired from the register. This is the ground that Tax Code 25.25(c) names directly — property that does not exist in the form or at the location described in the appraisal roll.

Every one of these is a claim that has to survive a district's questions, so each needs a stated basis and none should be applied without a person deciding it.`,
    related: [
      'exemptions-freeport-and-allocation',
      'corrections-25-25-routes',
      'rendition-what-must-be-rendered',
    ],
  },
  {
    id: 'exemptions-bpp-threshold',
    title: 'The Texas business personal property exemption',
    jurisdiction: 'tx',
    topics: ['exemptions'],
    authority: [
      'Tax Code 11.145',
      'HB 9 (89th Legislature, 2025)',
      'Proposition 9 (November 2025)',
    ],
    keywords: [
      'exemption',
      '125,000',
      '125000',
      '2,500',
      'threshold',
      'small account',
      'do I still have to file',
      'proposition 9',
    ],
    body: `For tax year 2026 onward, the Texas exemption for tangible personal property held for the production of income is $125,000, raised from $2,500 by HB 9 (89th Legislature, 2025) and the constitutional amendment approved as Proposition 9 in November 2025.

Two caveats have to travel with that number. It is granted per taxing unit, against that unit's own levy — so modelling it as a single subtraction against a blended tax rate is an approximation that slightly understates the benefit.

And it is a threshold worth watching in its own right. A client whose whole corrected position lands under it owes nothing at all, which changes the engagement from a refund conversation to a filing-only one. That is a materially different piece of work and should be said out loud early rather than discovered at the end.

The exemption does not remove the obligation to render. Rendering and owing are separate questions.`,
    related: ['exemptions-freeport-and-allocation', 'rendition-what-must-be-rendered'],
  },
  {
    id: 'exemptions-freeport-and-allocation',
    title: 'Freeport and interstate allocation',
    jurisdiction: 'tx',
    topics: ['exemptions', 'deadlines'],
    authority: [
      'Tax Code 11.251',
      'Tax Code 11.4391',
      'Tax Code 21.02',
      'Tax Code 21.031',
      'SB 1352',
    ],
    keywords: [
      'freeport',
      'inventory',
      '175 days',
      'allocation',
      'interstate',
      'goods in transit',
      'late application',
      'april 30',
    ],
    body: `Freeport (Tax Code 11.251) exempts certain inventory — goods acquired in or brought into Texas to be forwarded out of state, and detained no more than 175 days for assembly, storing, manufacturing, processing, or fabricating. The application is due April 30 under 11.4391, and a granted rendition extension carries that date to May 15 as well (SB 1352).

A late Freeport application is not fatal. 11.4391 allows an application filed after the deadline and before the appraisal roll is approved, with the exemption reduced by a penalty — so a missed April 30 is worth pursuing rather than writing off, which is the opposite of the instinct most calendars produce.

Freeport is claimed, not achieved by omission. Leaving qualifying inventory off the rendition because an exemption might apply is how a 22.28 penalty starts: the inventory is rendered, and the exemption is applied for separately.

Interstate allocation (21.02, 21.031) is the related idea for property used both inside and outside Texas — aircraft, rolling stock, and mobile equipment — where only the Texas-attributable portion is taxable here. It is applied for on its own form and on the same extended calendar.`,
    related: ['deadlines-season', 'classification-what-is-not-bpp'],
  },
];
