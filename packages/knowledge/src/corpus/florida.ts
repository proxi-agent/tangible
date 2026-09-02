import type { KnowledgeArticle } from '../types.js';

/**
 * Florida, which the valuation engine has been able to price since the DOR
 * schedules were committed and the assistant has until now been unable to say
 * a single procedural word about.
 *
 * The temptation with a second state is to write the first one again with the
 * nouns swapped. Almost every article here exists because that would have been
 * wrong in a way that costs a client money. Inventory is not exempt in Florida,
 * it is not property; the extension looks discretionary and its first thirty
 * days are not; leasehold improvements are affirmatively taxable rather than
 * arguably real property; and a late return does not merely draw a penalty, it
 * forfeits the appeal outright. Where Florida genuinely matches Texas — the
 * January 1 assessment date, cost times index times percent good — the article
 * says so plainly, because a preparer needs to know which of their instincts
 * transfer as much as which do not.
 *
 * Every article is tagged `jurisdiction: 'fl'`. That tag is what keeps an
 * April 1 out of an answer about a Harris County account, and it is not
 * optional on anything added here.
 */
export const FLORIDA_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'fl-return-what-must-be-filed',
    title: 'What has to go on a Florida DR-405',
    jurisdiction: 'fl',
    topics: ['rendition', 'classification'],
    authority: ['s. 192.042(2), F.S.', 's. 193.052, F.S.', 's. 193.062, F.S.', 'Form DR-405'],
    keywords: [
      'DR-405',
      'dr405',
      'return',
      'tangible personal property return',
      'florida',
      'january 1',
      'what do I report',
      'original installed cost',
      'trade level',
      'NAICS',
    ],
    body: `Florida calls it a return rather than a rendition, and the form is DR-405. s. 193.052 requires it of a person owning tangible personal property in the county, s. 193.062 makes it due April 1, and s. 192.042(2) fixes the valuation date at January 1 — the same assessment date as Texas, arrived at by a different statute.

One return per business location per county. Freestanding property at a location where the owner does not conduct business is reported on a single return for the county rather than one per site, so the number of returns is not simply the number of addresses, and it is worth settling before the season starts rather than at the deadline.

The two value columns are what catches a Texas preparer. Form 50-144 treats historical cost and a good faith estimate of value as alternatives, and this practice files on cost. DR-405 asks for both on the same line: Original Installed Cost and the Taxpayer's Estimate of Fair Market Value. There is no election to make. A return carrying only the cost column is incomplete, and what fills the gap is the appraiser's own schedule applied without any stated position from the taxpayer.

The form also asks for the business's NAICS code and for its trade level, both of which feed the valuation rather than sitting on it as description. It is signed by the preparer directly, and an unsigned return cannot be accepted.`,
    related: [
      'fl-deadlines-season',
      'fl-agents-and-signing',
      'fl-classification-inventory-and-exclusions',
    ],
  },
  {
    id: 'fl-deadlines-season',
    title: 'The Florida tangible personal property calendar',
    jurisdiction: 'fl',
    topics: ['deadlines', 'rendition'],
    authority: [
      's. 192.042(2), F.S.',
      's. 193.062, F.S.',
      's. 193.063, F.S.',
      's. 200.069, F.S.',
      's. 194.011(3), F.S.',
    ],
    keywords: [
      'april 1',
      'deadline',
      'due date',
      'florida',
      'TRIM',
      '25 days',
      'calendar',
      'when is it due',
      'VAB',
      'august',
    ],
    body: `January 1 is the assessment date under s. 192.042(2): property is valued as it stood that day.

April 1 is the return deadline under s. 193.062. It is two weeks ahead of the Texas April 15, and it is the date a firm working both states will miss first.

An extension request must reach the property appraiser before April 1 and early enough to be acted on, which in practice means the third week of March. The first thirty days of that extension are mandatory and the next fifteen are not — the extension article is where that matters.

The TRIM notice — the notice of proposed property taxes under s. 200.069 — is mailed in August, on a date each county sets for itself. It cannot honestly be printed on a calendar in advance, which is why it is carried as a date recorded when the notice arrives rather than as a prediction that would be wrong by weeks.

The value adjustment board petition is due 25 days after the TRIM notice was mailed, under s. 194.011(3). Receipt governs rather than postmark, so a petition mailed on the twenty-fifth day is late. One petition per tangible personal property account.

Two of these five dates are therefore not dates at all until the mail arrives. That is the structural difference from the Texas calendar, where May 15 is a floor under the protest deadline no matter when the notice went out, and it is why a Florida season cannot be planned to its end in January.`,
    related: ['fl-extensions-what-a-request-buys', 'fl-protest-vab', 'fl-penalties'],
  },
  {
    id: 'fl-extensions-what-a-request-buys',
    title: 'What a Florida extension request actually moves',
    jurisdiction: 'fl',
    topics: ['extensions', 'deadlines'],
    authority: ['s. 193.063, F.S.'],
    keywords: [
      'extension',
      'extend',
      'more time',
      '30 days',
      '15 days',
      'florida',
      '193.063',
      'may 1',
      'discretion',
      'ten days',
    ],
    body: `s. 193.063 has the same two-part shape as Tax Code 22.23(b), and mistaking either part for the other costs the same thing in both states.

The first part is mandatory. The property appraiser shall grant an extension for the filing of a tangible personal property return for 30 days. It cannot be refused, and a request properly made buys a May 1 deadline instead of April 1.

The second part is discretion. The appraiser may, at their discretion, grant an additional extension of up to 15 further days. "May", so this one moves nothing until somebody actually grants it. Recording a request for the extra days and then working to the middle of May is the same mistake as not asking at all.

Where Florida genuinely differs from Texas is timing rather than discretion, and this is the part that gets read backwards. Tax Code 22.23(b) moves the Texas deadline on the request itself, so a district's silence is not a denial. s. 193.063 instead requires the request to be made in time for the appraiser to consider it and act on it before the regular due date. A county may require the request as much as 10 days ahead of the due date, though no more than that. So a request sent on April 1 may be too late to be acted upon, even though the extension it asks for is one the appraiser has no power to refuse — the entitlement is unconditional and the opportunity to claim it is not.

The working rule that follows: Florida extension requests go out in the third week of March, not on the deadline.`,
    related: ['fl-deadlines-season', 'fl-penalties'],
  },
  {
    id: 'fl-penalties',
    title: 'The Florida penalties, and the two costs of lateness that are not penalties',
    jurisdiction: 'fl',
    topics: ['penalties', 'rendition', 'exemptions'],
    authority: [
      's. 193.072, F.S.',
      's. 196.183, F.S.',
      's. 194.034(1)(j), F.S.',
      'Rule 12D-8.005(7), F.A.C.',
    ],
    keywords: [
      'penalty',
      '25 percent',
      '5 percent a month',
      '15 percent',
      'unlisted property',
      'waiver',
      'florida',
      'late return',
      'failure to file',
    ],
    body: `s. 193.072 sets three penalties, and they stack differently from the flat Texas 10 percent.

Failure to file a return at all: 25 percent of the total tax levied against the property, for each year no return was filed.

Filing late: 5 percent of the total tax levied against the property covered by that return, for each month or part of a month the return is late, to a ceiling of 25 percent.

Property omitted from a return that was filed: 15 percent of the tax attributable to the omitted property. This one deserves to be stated on its own, because filing on time does not protect a taxpayer from it. An incomplete return carries its own penalty, and a register filed unedited is precisely how property gets left off one.

Any of the three may be reduced or waived. s. 193.072 closes by allowing the property appraiser, for good cause shown and on a finding that the failure was not intentional or made with the intent to evade the tax, to reduce or waive them.

The penalties are not the expensive part of being late. Two other consequences ride on the same missed date. Under s. 196.183 the $25,000 exemption does not apply in any year the taxpayer fails to timely file. And under s. 194.034(1)(j) an assessment may not be contested unless a return required by s. 193.052 was timely filed. So one missed April 1 loses the exemption, starts a penalty that compounds monthly, and forfeits the appeal — where a late Texas rendition costs a single 10 percent penalty and leaves the protest entirely intact.

Non-filing also becomes visible on its own schedule: Rule 12D-8.005(7) requires a field inspection after two consecutive years of non-filing.`,
    related: ['fl-deadlines-season', 'fl-exemption-25000', 'fl-protest-vab'],
  },
  {
    id: 'fl-exemption-25000',
    title: 'The Florida $25,000 exemption, and the filing waiver that follows it',
    jurisdiction: 'fl',
    topics: ['exemptions', 'rendition'],
    authority: ['s. 196.183, F.S.'],
    keywords: [
      'exemption',
      '25,000',
      '25000',
      'threshold',
      'initial return',
      'waiver',
      'florida',
      'do I still have to file',
      'small account',
    ],
    body: `Each tangible personal property return is eligible for an exemption of up to $25,000 of assessed value. It is granted per return — so per location per county, in the same shape the returns themselves take — and not once per taxpayer.

Claiming it requires an initial return. Once it is granted, the requirement to file annually is waived for as long as the property's value stays under the exemption. That waiver carries a duty with it: where in a later year the taxpayer owns taxable property whose value exceeds the exemption, the obligation to file returns again. A business that grew quietly under a waiver granted years ago is a non-filer without ever having decided to become one, and it is worth asking a Florida client when they last filed rather than assuming a waiver still fits them.

Over-claiming is expensive. A taxpayer claiming more exemptions than allowed owes the taxes exempted as a result, plus 15 percent interest per annum, plus a penalty of 50 percent of the taxes exempted.

The exemption also does not survive a late return: it does not apply in any year the taxpayer fails to timely file.

Set against the Texas $125,000, this number is what makes a Florida account taxable at a much smaller size. A client whose whole Texas position falls under the exemption may be squarely taxable on the same equipment in Florida, which is a different conversation from the one the Texas threshold produces.`,
    related: ['fl-penalties', 'fl-return-what-must-be-filed'],
  },
  {
    id: 'fl-classification-inventory-and-exclusions',
    title: 'What Florida writes out of tangible personal property entirely',
    jurisdiction: 'fl',
    topics: ['classification', 'exemptions'],
    authority: ['s. 196.185, F.S.', 's. 192.001(11)(c), F.S.', 's. 192.001(11)(d), F.S.'],
    keywords: [
      'inventory',
      'exempt',
      'excluded',
      'vehicles',
      'construction work in progress',
      'CWIP',
      'leased',
      'rental',
      'florida',
      'not taxable',
      '1,000 pounds',
    ],
    body: `The largest Florida lever is not an exemption argued on a schedule. It is that several whole categories are not tangible personal property in the first place.

Inventory. s. 196.185 exempts all items of inventory from ad valorem taxation, and s. 192.001(11)(d) goes further by writing inventory out of the definition of tangible personal property altogether. Property that is not TPP carries no return-filing requirement at all. This is the sharpest break from Texas, where inventory is rendered and Freeport is then applied for separately, on its own form and its own deadline.

Two sub-rules decide the close cases. Items held for lease are inventory only until the initial lease — once leased, the unit leaves inventory and becomes taxable, so the lease date and not the acquisition date is what a register has to show. And construction or agricultural equipment weighing 1,000 pounds or more, held under a rent-to-purchase option for sale to customers, is inventory.

Vehicles. s. 192.001(11)(d) excludes vehicular items from the definition of TPP. This is the clean opposite of Texas, where a licensed vehicle stays on the rendition and only an application takes it off.

Construction work in progress. CWIP is not taxable until it is, in the statute's own words, deemed substantially completed when connected with the preexisting, taxable, operational system. Connection is the test — not capitalization, not percentage complete, not the date the asset was placed in service for book purposes.

Each of these takes the whole cost out of the base rather than moving it down a depreciation curve, which is why reading a register against them is worth more than any schedule argument available in the state.`,
    related: [
      'fl-valuation-dor-guidelines',
      'fl-leasehold-and-pollution-control',
      'fl-return-what-must-be-filed',
    ],
  },
  {
    id: 'fl-valuation-dor-guidelines',
    title: 'How a Florida county values a return, and what the DOR guidelines are worth',
    jurisdiction: 'fl',
    topics: ['valuation'],
    authority: [
      'Florida DOR Tangible Personal Property Appraisal Guidelines',
      's. 193.011, F.S.',
      's. 195.032, F.S.',
      's. 195.062, F.S.',
    ],
    keywords: [
      'depreciation',
      'index factor',
      'percent good',
      'life',
      'attachment b',
      'attachment c',
      'attachment d',
      'florida',
      'just value',
      'trade level',
      'obsolescence',
    ],
    body: `The arithmetic is the arithmetic Harris County uses: reported cost, multiplied by an index factor trending it to current replacement cost, multiplied by a percent good for age. The Department of Revenue publishes the tables statewide in its Tangible Personal Property Appraisal Guidelines — Attachment B for equipment index factors, Attachment C for the untrended depreciation schedule, Attachment D for life expectancies by industry group. Both states' tables descend from the same Marshall source and agree cell for cell across several life classes, which is why the valuation engine ports between them.

What differs is life assignment, and it runs against the taxpayer. Florida puts office furniture and equipment on a 10-year life where Harris uses shorter ones, so the same register carries more value in Florida than in Harris. Florida also applies an index factor to computers, where Harris values computer equipment, telecom and vehicles off original cost with no trending at all. The guidelines themselves note that trending historical costs may not be appropriate where costs are decreasing because of emerging technologies — permissive, and addressed to the appraiser rather than granted to the taxpayer, which makes it an argument to be made on a computer-heavy register rather than a rule to be cited.

The standing of the tables is the part worth knowing before arguing with them. s. 195.032 makes the Department's standard measures of value prima facie correct, and says in the same breath that they shall not be deemed to establish the just value of any property. The guidelines' own cover note records that under s. 195.062 they do not have the force and effect of rules. The statutory measure is s. 193.011's eight factors. So the schedule is a rebuttable starting point rather than the answer — a friendlier posture for a taxpayer-side argument than a binding rule would be, and the opposite of how a published table usually feels across a counter.

Two openings follow. The guidelines expressly permit adjusting the residual percent good for functional and economic obsolescence. And they require trade level to be considered, so intercompany transfers are to be valued as though acquired at arm's length from an outside supplier rather than carried at the transferring entity's book cost.`,
    related: ['fl-classification-inventory-and-exclusions', 'fl-leasehold-and-pollution-control'],
  },
  {
    id: 'fl-leasehold-and-pollution-control',
    title: 'Two DR-405 lines a Texas preparer will read wrong',
    jurisdiction: 'fl',
    topics: ['classification', 'valuation', 'exemptions'],
    authority: ['Form DR-405', 's. 193.621, F.S.', 'Rule 12D-6.005, F.A.C.', 'Form DR-492'],
    keywords: [
      'leasehold improvements',
      'tenant build-out',
      'pollution control',
      'salvage',
      'DR-492',
      'supplies',
      'florida',
    ],
    body: `Leasehold improvements. DR-405 carries a summary line for them and taxes them as tangible personal property. This is the opposite of the Texas instinct, where tenant build-out is the hard case against real property and Tax Code 23.24 governs whether it belongs on the personal property account at all. In Florida the question is not whether leasehold improvements go on the return — they do — but at what value. A finding that moves build-out off a Texas rendition has no Florida counterpart, and applying one anyway understates a return.

Pollution control. s. 193.621, with Rule 12D-6.005 and Form DR-492, provides that qualifying pollution control property should be assessed at no greater than its market value as salvage. That is a stronger remedy than the Texas 11.31 percentage exemption, and it is claimed on a timely DR-492 rather than argued on the return itself. Qualifying property for which no DR-492 was filed is worth raising as a finding, and it belongs to the class that has to be caught before a deadline rather than repaired in a correction afterwards.

Supplies are the third line worth naming, and here Florida matches Texas: supplies not held for resale are reported and taxable. Over-reporting them is ordinary, because a book supplies account rarely distinguishes what was actually on hand at January 1 from everything bought during the year.`,
    related: ['fl-classification-inventory-and-exclusions', 'fl-return-what-must-be-filed'],
  },
  {
    id: 'fl-situs-30-days',
    title: 'Florida situs and the 30-day rule',
    jurisdiction: 'fl',
    topics: ['classification', 'rendition'],
    authority: ['s. 192.032, F.S.'],
    keywords: [
      'situs',
      'location',
      'temporary',
      '30 days',
      'habitually located',
      'multi-county',
      'mobile equipment',
      'fleet',
      'florida',
      'which county',
    ],
    body: `Where a Florida return is filed — and whether one is owed at all — turns on s. 192.032.

Property present in the state for temporary purposes only, for 30 days or less, is not assessable. That is a genuine exclusion for mobile equipment passing through, and it has no Texas equivalent: Texas reaches similar ground through interstate allocation under Tax Code 21.02 and 21.031, which apportions the value rather than excluding the property.

Where property moves among Florida counties, situs resolves to where it is habitually located or typically present, rather than to wherever it happened to sit on January 1. A single January 1 snapshot is therefore not sufficient evidence of situs for equipment that moves, and the register alone will rarely settle it.

Property brought into the state between January 1 and April 1 is taxable for that year if the appraiser believes it will be removed before the next January 1. The provision exists to catch property that would otherwise escape both years — arriving too late to be assessed on one January 1 and leaving before the next.

For a client with fleet or mobile equipment these three rules decide the county as much as the value, and getting them wrong surfaces as a return filed in the wrong county rather than as a number that is merely too high.`,
    related: ['fl-return-what-must-be-filed', 'fl-classification-inventory-and-exclusions'],
  },
  {
    id: 'fl-protest-vab',
    title: 'Contesting a Florida assessment, and the bar standing in front of it',
    jurisdiction: 'fl',
    topics: ['protest', 'deadlines'],
    authority: [
      's. 194.011(3), F.S.',
      's. 194.034(1)(j), F.S.',
      's. 194.171, F.S.',
      'Form DR-486',
    ],
    keywords: [
      'VAB',
      'value adjustment board',
      'petition',
      'DR-486',
      '25 days',
      'TRIM',
      'appeal',
      'circuit court',
      'florida',
      'protest',
    ],
    body: `The petition is Form DR-486, filed with the value adjustment board within 25 days of the mailing of the TRIM notice under s. 194.011(3). Receipt governs rather than postmark. One petition per tangible personal property account.

The bar comes before any of that, and it is the most consequential sentence in the Florida practice. Under s. 194.034(1)(j), an assessment may not be contested unless a return as required by s. 193.052 was timely filed. A taxpayer who missed April 1 has no appeal of the value that follows — not a weaker appeal, none at all. Texas has nothing resembling this. A Texas owner who rendered nothing still protests under Chapter 41; the rendition changes who carries the burden under 41.43, not whether there is a hearing.

That single rule reorders the work. In Texas the filing and the protest are two engagements that can be sold and run separately, and a client arriving in June still has a season worth working. In Florida the April 1 return is the precondition for everything downstream of it, so a client who arrives after April 1 has no year at all — only a narrow correction route and next season. It is the first thing to establish when a Florida prospect calls, and it should be said to them plainly rather than discovered in August.

Past the board, s. 194.171 provides the appeal to circuit court.`,
    related: ['fl-deadlines-season', 'fl-penalties', 'fl-corrections-197-122'],
  },
  {
    id: 'fl-corrections-197-122',
    title: 'Getting back into a closed Florida year',
    jurisdiction: 'fl',
    topics: ['corrections'],
    authority: ['s. 197.122, F.S.', 'Rule 12D-8.021, F.A.C.', 's. 197.182, F.S.'],
    keywords: [
      'correction',
      'material mistake of fact',
      'prior year',
      'refund',
      'closed year',
      'one year',
      'four years',
      'florida',
      'back years',
    ],
    body: `Florida's route back into a closed year is far narrower than Texas's, and the difference decides whether a prior-year review is worth selling in the state at all.

What is correctable is a material mistake of fact under s. 197.122. Rule 12D-8.021 puts the window at one year from the approval of the assessment roll. A change in the property appraiser's judgment is expressly not a material mistake of fact and is not correctable — so an argument that a life class or a schedule was wrong, which is the ordinary shape of a business personal property finding, does not get in through this door.

A refund claim under s. 197.182 must be made within four years of January 1 of the tax year. Those four years get quoted on their own and they mislead: the refund provision needs a correctable error underneath it, and s. 197.122 is what has to supply one. Four years of refund reach sitting on top of a one-year correction window is still a one-year correction window.

Set against Tax Code 25.25 — five preceding years for property that does not exist in the form or at the location described, two for an error or omission in a rendition, both with no threshold and no penalty — Florida offers a fraction of the reach. Ghost assets that would carry a five-year Texas correction carry, in Florida, whatever is left of a single year.`,
    related: ['fl-protest-vab', 'fl-penalties'],
  },
  {
    id: 'fl-agents-and-signing',
    title: 'Who signs a Florida return, and why there is no appointment to check',
    jurisdiction: 'fl',
    topics: ['agents', 'rendition', 'confidentiality'],
    authority: ['Form DR-405', 'Form DR-835', 'Form DR-486', 's. 193.074, F.S.'],
    keywords: [
      'agent',
      'signature',
      'preparer',
      'sign',
      'power of attorney',
      'DR-835',
      'authorization',
      'florida',
      'confidential',
      'may we file',
    ],
    body: `Florida has no equivalent of Form 50-162, and the absence cuts in both directions.

The preparer signs DR-405 directly, giving a preparer identification alongside the signature. There is no appointment to file with the county first, no effective date to compute, and no standing question to answer before a return can go out. An unsigned return cannot be accepted, and that is the whole of the signature gate — none of the notarization machinery that Tax Code 22.24(e) imposes on a Texas agent applies here.

What is missing along with it is the protection. Tax Code 1.111(d) means a Texas client cannot be represented by two firms on the same property, and a competing appointment revokes ours in a way that is at least discoverable. Florida has no such rule for returns, so nothing in the public record will tell us whether another preparer is also filing for this client this season. That has to be asked of the client rather than checked against a district.

Two other forms carry authority where authority is actually needed. DR-835 is the Department's power of attorney. DR-486 carries agent authorization for a value adjustment board petition, so representation at the appeal is authorized on the petition itself rather than established in advance.

Returns are confidential under s. 193.074, in the same way Tax Code 22.27 covers a Texas rendition. The form is headed CONFIDENTIAL and its contents do not appear on any public roll — which is also why the Florida county files this product ingests carry no filing-status field to read.`,
    related: ['fl-return-what-must-be-filed', 'fl-protest-vab'],
  },
  {
    id: 'fl-billing-and-delinquency',
    title: 'The Florida tangible personal property bill: discounts, April 1, and the warrant',
    jurisdiction: 'fl',
    topics: ['billing', 'deadlines', 'penalties'],
    authority: ['s. 197.333, F.S.', 's. 197.162, F.S.', 's. 197.413, F.S.'],
    keywords: [
      'tax bill',
      'bill',
      'when do I pay',
      'discount',
      '4 percent',
      'early payment',
      'november',
      'delinquent',
      'delinquency',
      'april 1',
      'tax warrant',
      'warrant',
      'seizure',
      'levy',
      'tax collector',
    ],
    body: `Florida bills tangible personal property on the same calendar as real estate, and the calendar rewards paying early rather than only punishing paying late.

Under s. 197.333, F.S., taxes are due on November 1 or as soon as the certified roll reaches the tax collector, and they become delinquent on April 1 of the following year or 60 days after the bill was mailed, whichever is later. Under s. 197.162, F.S., a bill paid in November, or within 30 days of mailing where the roll was late, earns a four percent discount; December earns three, January two, February one, and March earns nothing. For a client with a material account the November discount is real money, and it is the one thing a firm can say about the bill in October that the client will act on.

April 1 is a collision worth naming. It is the date the next year's return is due under s. 193.062 and the date the prior year's tax becomes delinquent under s. 197.333, for two different tax years, and a firm working both dates from one calendar should label which is which.

Delinquent tangible personal property tax does not sit as a lien and wait. Under s. 197.413, F.S., the tax collector lists unpaid tangible personal property taxes before May 1 of the year after they became delinquent, prepares warrants before April 30 for their collection by levy and seizure of the property, and petitions the circuit court within 30 days of the warrants for an order ratifying them. A warrant is not issued for a bill under $50, though the tax is still owed. The practical difference from Texas is the remedy: a Florida delinquency ends with the collector authorized to seize the equipment the tax was on, not only with penalty and interest accruing against it.`,
    related: ['fl-deadlines-season', 'fl-penalties'],
  },
  {
    id: 'fl-no-return-estimated-assessment',
    title: 'What Florida does when no return comes: an estimate that stands',
    jurisdiction: 'fl',
    topics: ['rendition', 'penalties', 'protest'],
    authority: ['s. 193.073, F.S.', 's. 193.072, F.S.', 's. 194.034(1)(j), F.S.'],
    keywords: [
      'no return',
      'did not file',
      'never filed',
      'estimate',
      'estimated assessment',
      'best information available',
      'prima facie',
      'incomplete return',
      'erroneous return',
      '30 days',
      'notice to file',
    ],
    body: `A Florida property appraiser who receives no return does not wait, and does not need the owner's help.

Under s. 193.073, F.S., a return that is erroneous or incomplete draws a notice, and the owner has 30 days from its mailing to file a complete one. Where no return is filed at all, the appraiser assesses the property from the best information available, and that estimate is deemed prima facie correct and placed on the roll. In practice the best information is the client's own prior returns, a comparable business, or a site visit, and it errs upward because nothing about the process rewards guessing low.

Two other sections turn the estimate into a trap. Under s. 193.072, F.S., the non-filer owes the 25 percent penalty on top of the tax, and under s. 194.034(1)(j), F.S., a petition to the value adjustment board is barred where no return was filed on time. So the non-filer pays tax on the appraiser's figure, plus a quarter, with no board before which to argue that the figure is wrong. That is the whole reason a late return is worth filing on the day it is discovered: it converts the estimate into a value the client can at least contest.

The 30-day letter under s. 193.073 is a clock the firm should track the way it tracks a Texas request under Tax Code 22.07, because the consequence of missing it is the same estimate with the same bar behind it.`,
    related: ['fl-penalties', 'fl-protest-vab', 'fl-return-what-must-be-filed'],
  },
];
