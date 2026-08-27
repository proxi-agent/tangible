import type { KnowledgeArticle } from '../types.js';

/**
 * The other half of a season: what the district decided, and what is left to
 * do about it.
 *
 * Ordered the way the work actually arrives — a notice, a window, a hearing,
 * an ending, and then the years the window already closed on. The last of
 * those is the one a firm most often does not know it still has.
 */
export const DISPUTE_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'protest-three-clocks',
    title: 'One notice, three clocks',
    topics: ['protest', 'deadlines', 'penalties'],
    authority: ['Tax Code 41.44', 'Tax Code 1.07', 'Tax Code 22.30(b)'],
    keywords: [
      'notice of appraised value',
      'protest deadline',
      '30 days',
      'delivered',
      'mailed',
      'clock',
      'waiver window',
    ],
    body: `A notice of appraised value starts more than one deadline, and they are not the same deadline.

The protest window: Tax Code 41.44 gives the later of May 15 and the thirtieth day after the notice of appraised value was delivered. Delivery is presumed on the day the notice was deposited in the mail (1.07), so in practice the date printed on the notice is the date the clock started.

The penalty waiver window: where the district applied the 22.28 rendition penalty, 22.30(b) gives 30 days from receiving notice of the penalty to ask for a waiver. There is no May 15 floor under this one, so on an early notice it closes well before the protest window does.

The district's own printed deadline: not a clock at all, but it is what the counter will enforce.

Where the printed date and the statute disagree, the working rule is one rule in both directions — believe the shorter one, and say what the longer one is. A practice whose job is to not miss deadlines cannot take the generous reading, and a disagreement between the two is nearly always diagnostic: a district printing a flat May 15 without counting thirty days, or a delivery date on our side that is off by a week.`,
    related: ['protest-what-can-be-protested', 'penalties-late-and-fraudulent'],
  },
  {
    id: 'protest-what-can-be-protested',
    title: 'What Chapter 41 lets an owner protest',
    topics: ['protest'],
    authority: ['Tax Code 41.41', 'Tax Code 41.43', 'Tax Code 41.44', 'Tax Code 41.45'],
    keywords: [
      'protest',
      'grounds',
      'ARB',
      'appraisal review board',
      'unequal appraisal',
      'excessive',
      'hearing',
      'burden of proof',
    ],
    body: `Tax Code 41.41(a) lists what an owner is entitled to protest, and for a business personal property account the ones that matter are: the determination of appraised value; unequal appraisal of the owner's property; inclusion of the property on the appraisal records; and any other action of the chief appraiser that adversely affects the owner.

"Inclusion of the property on the appraisal records" is the ground that fits a register carrying assets the business no longer has. It is a different argument from "the value is too high" and it is often the stronger one, because it is a question of fact rather than of appraisal judgment.

Under 41.43, in a protest of excessive or unequal appraisal, the appraisal district has the burden of establishing the value by a preponderance of the evidence — and where the owner filed a timely rendition or complied with a request for information, that burden is meaningful. A protest by an owner who rendered nothing is a harder hearing.

41.45 governs the hearing itself. Most business personal property protests are settled informally with the appraiser before a board hearing is reached, and a settled protest is a written agreement, which matters later — see the corrections article.`,
    related: ['protest-three-clocks', 'corrections-25-25-routes'],
  },
  {
    id: 'protest-four-endings',
    title: 'The four ways a protest year ends',
    topics: ['protest'],
    authority: ['Tax Code 41.44', 'Tax Code 41.45', 'Tax Code 1.111(e)', 'Tax Code 42.01'],
    keywords: [
      'settled',
      'withdrawn',
      'board order',
      'determination',
      'unprotested',
      'appeal',
      'district court',
      'outcome',
    ],
    body: `A year on an account ends in one of four ways, and which one it was decides what is still available afterwards.

Unprotested: the 41.44 window closed and nobody filed. The noticed value is the value for the year — as final as a board order, reached by silence. A quiet year is a settled year, not an unfinished one.

Withdrawn: a protest was filed and pulled. Nothing was determined on the merits and no written agreement was reached.

Settled informally: an agreement with the appraiser under Tax Code 1.111(e). This is a written agreement, and it is final on the matters it covers.

Determined by the appraisal review board: an order after a hearing. Appealable to district court under Chapter 42, generally within 60 days of receiving the order.

The distinction that costs money later is between withdrawn and settled. Both look like "we didn't win," but a withdrawal leaves the 25.25 correction routes open and a written settlement agreement bars some of them.`,
    related: ['corrections-25-25-routes', 'corrections-what-bars-each-route'],
  },
  {
    id: 'corrections-25-25-routes',
    title: 'Tax Code 25.25: getting back into a year the protest window closed on',
    topics: ['corrections'],
    authority: [
      'Tax Code 25.25(a)',
      'Tax Code 25.25(c)',
      'Tax Code 25.25(c-1)',
      'Tax Code 25.25(d)',
      'Tax Code 25.25(l)',
    ],
    keywords: [
      'correction',
      'motion',
      'prior year',
      'back years',
      'refund',
      'closed year',
      'ghost assets',
      'property that does not exist',
      'five years',
    ],
    body: `Tax Code 25.25(a) says the appraisal roll may not be changed. The rest of 25.25 is the list of times it may, and for a business personal property practice that list is the answer to the first question a new client asks — whether anything can be done about the years already gone.

25.25(c) reaches the five preceding years, for a clerical error, multiple appraisals of a property, an error in ownership, or the inclusion of property that does not exist in the form or at the location described in the appraisal roll. That last ground is exactly a register carrying assets scrapped, sold, or moved years ago: it puts property on the roll that does not exist at that location. No threshold, no penalty.

25.25(c-1) is the personal property route and usually the one this practice reaches for. It corrects an inaccuracy in the appraised value of tangible personal property caused by an error or omission in a rendition filed under Chapter 22. It reaches the current tax year and either of the two preceding years. No threshold, no penalty.

25.25(d) is the general route. It can be filed any time before the taxes become delinquent, but the value has to exceed the correct value by more than one-third for property that is not a residence homestead, and correcting it carries a late-correction penalty of 10 percent of the taxes computed on the corrected value. The expensive route and the shortest one.

Order matters when presenting these. (c) and (c-1) cost nothing, so (d) is a last resort rather than a first suggestion. And none of them should be reached for while a protest is still available for the year, because a protest is cheaper than all three.`,
    related: ['corrections-what-bars-each-route', 'corrections-deadlines'],
  },
  {
    id: 'corrections-what-bars-each-route',
    title: 'What bars a 25.25 motion',
    topics: ['corrections'],
    authority: [
      'Tax Code 25.25(c)',
      'Tax Code 25.25(c-1)',
      'Tax Code 25.25(l)',
      'Tax Code 1.111(e)',
    ],
    keywords: [
      'barred',
      'bar',
      'already protested',
      'settled',
      'agreement',
      'delinquent taxes',
      'can I still',
      'regardless of whether',
    ],
    body: `The bars are route-specific, and the difference is worth real money.

25.25(l) is the one that surprises people: a motion under 25.25(c) may be filed regardless of whether the owner protested the value for that year. Winning — or losing — a protest does not spend the (c) route.

25.25(c-1) is barred where the value was established as a result of a written agreement between the owner or the owner's agent and the appraisal district. So a protest settled informally under 1.111(e) closes (c-1) for that year; a protest that was withdrawn does not, because a withdrawal leaves no agreement behind it.

25.25(c-1) also requires that the taxes on the property not be delinquent, and that the motion be filed by the owner or the owner's agent within the statutory period.

25.25(d) is barred where the property was the subject of a protest for that year in which a determination was made — the general route does not reopen what a board already decided.

One drafting note: the (c) bar text says "section," not "subsection," in the places where it appears, and reading it as subsection-scoped is how a motion gets filed into a route that was already shut. When the availability of a route decides whether to bill work, it is worth confirming the current text with the district rather than relying on a summary.`,
    related: ['corrections-25-25-routes', 'protest-four-endings'],
  },
  {
    id: 'corrections-deadlines',
    title: 'How long each correction route stays open',
    topics: ['corrections', 'deadlines'],
    authority: [
      'Tax Code 25.25(c)',
      'Tax Code 25.25(c-1)',
      'Tax Code 25.25(d)',
      'Tax Code 31.02(a)',
      'Tax Code 31.04',
    ],
    keywords: [
      'how long',
      'deadline',
      'delinquent',
      'february 1',
      'five preceding years',
      'two preceding years',
      'expires',
    ],
    body: `25.25(c) runs through the end of the fifth calendar year after the year being corrected.

25.25(c-1) reaches the current tax year and either of the two preceding tax years, so it runs through the end of the second calendar year after the subject year.

25.25(d) runs until the taxes on the property become delinquent. Under 31.02(a) taxes are delinquent on February 1 of the year following the year they were imposed, so (d) closes on January 31 — unless 31.04 postponed delinquency because the bill went out late, which pushes the date and is worth checking rather than assuming.

The deadline belongs to the subject year, not to today's season. A 2023 correction filed in 2026 is measured off 2023.`,
    related: ['corrections-25-25-routes', 'corrections-what-bars-each-route'],
  },
];
