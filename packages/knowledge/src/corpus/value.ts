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
    topics: ['exemptions', 'rendition', 'product'],
    authority: [
      'Tax Code 11.145',
      'Tax Code 22.01(j-1)',
      'Tax Code 22.01(j-3)',
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
      'certification',
      'elect not to render',
      'per location',
      'related entities',
      'unified business enterprise',
    ],
    body: `For tax year 2026 onward, the Texas exemption for tangible personal property held for the production of income is $125,000, raised from $2,500 by HB 9 (89th Legislature, 2025) and the constitutional amendment approved as Proposition 9 in November 2025.

Three caveats travel with that number. It is granted per taxing unit, against that unit's own levy, so modelling it as a single subtraction against a blended tax rate slightly understates the benefit. It applies at each separate location in a taxing unit: property at the same situs is aggregated and the exemption is taken against that aggregate, so a business with three sites in one county has three exemptions there, not one. And related business entities that together compose a unified business enterprise are aggregated at a shared location, so splitting one operation across affiliates to multiply the exemption does not work.

It is a threshold worth watching in its own right. A client whose whole corrected position lands under it owes nothing at all, which changes the engagement from a refund conversation to a filing-only one. That is a materially different piece of work and should be said out loud early rather than discovered at the end.

The exemption changes the rendition duty, but does not erase it. Under Tax Code 22.01(j-1), added by the same bill, a person is required to render only if the aggregate market value of their income-producing property at the same location in at least one taxing unit exceeds the exemption. Once it does anywhere, 22.01(j-2) requires all of the person's income-producing property in the appraisal district to be rendered, not just the location that crossed the line. And a person entitled to elect not to render must still file something: under 22.01(j-3), a rendition statement or property report carrying a certification that they reasonably believe the value is not more than the amount exempted. That certification takes effect for the tax year after the one it is filed in and continues until the person's ownership of the property changes, and the chief appraiser may still require a rendition regardless. So the small client's filing is not nothing; it is a one-time sworn statement that has to be revisited whenever an acquisition could carry a location over the threshold.

Tangible builds a full rendition either way. The certification election is not modelled, so a firm using it records the decision in the client's file rather than in the app.`,
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
  {
    id: 'valuation-inventory-september-1',
    title: 'Electing September 1 as the inventory date',
    jurisdiction: 'tx',
    topics: ['valuation', 'deadlines', 'rendition'],
    authority: ['Tax Code 23.12(a)', 'Tax Code 23.12(f)'],
    keywords: [
      'september 1',
      'inventory election',
      'inventory date',
      'seasonal inventory',
      'peak inventory',
      'alternate date',
      '23.12(f)',
      'revoke',
      'application',
      'july 31',
    ],
    body: `Tax Code 23.12(a) values inventory at the price it would bring as a unit to a purchaser who would continue the business, which in practice is cost, measured on January 1 like everything else. For a business whose stock peaks around the turn of the year, that date is expensive.

Subsection (f) offers a second date. The owner may apply to the chief appraiser to have inventory appraised at its market value as of September 1 of the preceding year instead. The timing is the trap: the election applies to each tax year that begins after the next August 1 following the date the application is filed. An application filed on or before July 31 therefore governs the roll the following January; one filed in August waits a further year. Once made it stays in force year after year until it is revoked in writing, and a revocation takes effect for tax years beginning after the next September following its filing, so switching back is also a year-ahead decision.

The election binds in both directions, which is why the comparison is a two-season one. A retailer whose January stock is high and whose September stock is low gains; a retailer building stock for the holidays in September loses. The right question is which of the two dates is reliably lower for this business, not which was lower last year.

It is not available for the special dealer inventories — motor vehicles, vessels and outboard motors, heavy equipment, and retail manufactured housing — which are valued on sales under their own sections rather than on stock at a date.

On the form, elected inventory is still Schedule B at cost; the district applies the September 1 figure. The election is a filing with the district, kept in the client's file, not a line on the rendition.`,
    related: ['valuation-how-a-district-values', 'rendition-form-schedules', 'valuation-dealer-inventories'],
  },
  {
    id: 'valuation-dealer-inventories',
    title: 'Dealer inventories are valued on sales, not on a rendition',
    jurisdiction: 'tx',
    topics: ['valuation', 'rendition', 'classification'],
    authority: [
      'Tax Code 23.121',
      'Tax Code 23.124',
      'Tax Code 23.1241',
      'Tax Code 23.127',
      'Tax Code 23.12(f)',
    ],
    keywords: [
      'dealer',
      'car dealer',
      'dealership',
      'heavy equipment',
      'equipment rental',
      'rental yard',
      'boat dealer',
      'vessel',
      'outboard motor',
      'manufactured housing',
      'special inventory',
      'monthly statement',
      'declaration',
      '1,500 pounds',
    ],
    body: `Four kinds of inventory leave the cost-based world entirely. Motor vehicle dealers (Tax Code 23.121), vessel and outboard motor dealers (23.124), heavy equipment dealers (23.1241) and retail manufactured housing dealers (23.127) have their inventory valued on what they sold, not on what they held.

The arithmetic is the same across the four: the market value of the inventory on January 1 is the dealer's total sales from that inventory over the preceding twelve months, net of dealer-to-dealer, fleet and subsequent sales, divided by twelve. One month of sales, not the stock on the lot. The dealer files an annual declaration and monthly statements with the collector, and prepays tax into escrow with each statement, in place of reporting the inventory on Form 50-144. A rendition that lists dealer stock on Schedule B at cost double-counts it.

Heavy equipment under 23.1241 is self-propelled, self-powered or pull-type equipment weighing at least 1,500 pounds, intended for agricultural, construction, industrial, maritime, mining or forestry use, including farm equipment and diesel engines, and excluding motor vehicles that must be titled or registered. A dealer is anyone in the business of selling, leasing or renting it, and the inventory is what is held for sale, lease or rent. So an equipment rental yard's excavators and generators are special inventory valued on twelve months of sales and rentals, while its pickup trucks are Schedule D and its shop tools are Schedule E. Equipment the dealer keeps for its own use rather than for sale or rent is ordinary property and is rendered.

None of the four may elect the September 1 inventory date under 23.12(f); their sections supply the date and the method. The practical question at intake is simply whether the client sells, leases or rents any of these four things, because a yes moves part of the account off the rendition and onto a monthly filing the firm may not have been told about.`,
    related: ['valuation-inventory-september-1', 'rendition-form-schedules'],
  },
  {
    id: 'exemptions-other-bpp',
    title: 'The exemptions besides the $125,000 one and Freeport',
    jurisdiction: 'tx',
    topics: ['exemptions', 'classification'],
    authority: [
      'Tax Code 11.14',
      'Tax Code 11.252',
      'Tax Code 11.254',
      'Tax Code 11.27',
      'Tax Code 11.31',
      'Tax Code 11.43',
    ],
    keywords: [
      'exempt',
      'exemption',
      'not producing income',
      'personal use property',
      'solar',
      'wind',
      'pollution control',
      'TCEQ',
      'use determination',
      'leased vehicle',
      'exemption application',
      'apply',
      'annual application',
      'one-time application',
      'may 1',
    ],
    body: `Beyond the $125,000 exemption and Freeport, a handful of exemptions reach business personal property, and the useful thing to know about each is whether it must be applied for and how often.

Tax Code 11.14 exempts tangible personal property that is not held or used for the production of income. It needs no application; it is the boundary of the whole practice, and the rendition duty in 22.01(a) stops at the same line. A taxing unit may vote to tax such property anyway, and where one has, the exemption is gone in that unit alone.

Tax Code 11.254 exempts one mixed-use vehicle owned by an individual, and 11.252 exempts a leased vehicle to its lessor where the lessee's use is mostly personal. Both are applied for; 11.254 is a one-time application under 11.43(c), while the 11.252 exemption rests on a lessee affidavit the lessor keeps on file.

Tax Code 11.27 exempts solar and wind-powered energy devices, which is why a rooftop array a client capitalized as equipment should be classified as such and then applied for rather than rendered and valued. Tax Code 11.31 exempts pollution control property, but only after the Texas Commission on Environmental Quality issues a positive use determination; the application to the district carries that letter, and without it the chief appraiser cannot grant anything. Both are one-time applications under 11.43(c).

Freeport under 11.251 is the exception in the other direction: it is not on the 11.43(c) list, so it is claimed again every year, and a year nobody files it is a year it is forfeited.

Three rules hold across all of them. An exemption is claimed on its own application, on the comptroller's form, due before May 1 under 11.43(d); leaving the property off the rendition claims nothing and starts a 22.28 penalty instead. The district decides, and the notice of appraised value is where a denial or cancellation shows up. And the property is still described on the rendition or the application, because the district needs to know what it is not taxing.`,
    related: [
      'exemptions-bpp-threshold',
      'exemptions-freeport-and-allocation',
      'classification-vehicles-schedule-d',
    ],
  },
];
