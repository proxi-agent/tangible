import type { KnowledgeArticle } from '../types.js';

/**
 * What happens after the value is settled: the roll becomes a bill, the bill
 * has a date, and lateness has a price. None of it is filed by this practice,
 * all of it is asked about, and a firm that can only talk about the rendition
 * season is mute for the other seven months.
 *
 * The articles here answer the questions that arrive in October and in March:
 * when is it due, what does late cost, who owes it if the business was sold,
 * where does a refund come from. They are Texas; Florida's counterpart sits in
 * the Florida file under the same topic.
 */
export const BILLING_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'billing-from-value-to-bill',
    title: 'From the appraisal roll to a tax bill, and what lateness costs',
    jurisdiction: 'tx',
    topics: ['billing', 'deadlines', 'penalties'],
    authority: [
      'Tax Code 25.24',
      'Tax Code 31.01',
      'Tax Code 31.02',
      'Tax Code 33.01',
      'Tax Code 33.07',
      'Tax Code 6.30',
      'Tax Code 31.11',
      'Tax Code 26.15',
    ],
    keywords: [
      'tax bill',
      'bill',
      'when do I pay',
      'when is the tax due',
      'due',
      'delinquent',
      'delinquency',
      'late',
      'pay late',
      'late payment',
      'february 1',
      'october 1',
      'interest',
      'penalty and interest',
      'attorney fees',
      'collection penalty',
      'collector',
      'refund',
      'overpayment',
      'tax rate',
      'taxing unit',
      'levy',
    ],
    body: `The appraisal district never sends a bill. Once the review board has approved the records they become the appraisal roll under Tax Code 25.24, each taxing unit adopts its rate against that roll, and the assessor-collector for each unit, or a county collector acting for several, bills the account. A business in one location may get one consolidated bill or three, depending on who collects for whom, and the appraised value on every one of them is the same number.

Under 31.01(a) bills go out by October 1 or as soon after as practicable, to the owner and, where one is on file, to the authorized agent, which is why a firm holding a Form 50-162 sees the bill. Under 31.02(a) the tax is due on receipt and becomes delinquent if it is not paid before February 1 of the following year.

Lateness compounds in three layers. Under 33.01 a delinquent tax picks up a penalty of six percent in the first month and one percent for each further month, reaching twelve percent on July 1, and interest at one percent per month from delinquency with no cap. Under 33.07 taxes still delinquent on July 1 pick up an additional collection penalty to cover the attorney's contract, which 6.30(c) caps at twenty percent of the tax, penalty and interest. A bill ignored for a year therefore costs close to half again what was owed, before anything is done about it.

Refunds run two ways. Where a 25.25 correction or a protest lowers a value after the tax was paid, 26.15(f) requires the taxing unit to refund the difference, and the owner does not have to apply for it. Where the owner simply overpaid or paid in error, 31.11 requires an application to the collector within three years of the payment, and the governing body may extend that once by up to two years for good cause. A refund the client expects but has not received is one of those two cases, and which one decides whether a form is missing.`,
    related: ['billing-sold-or-closed', 'corrections-25-25-routes', 'protest-after-the-arb'],
  },
  {
    id: 'billing-sold-or-closed',
    title: 'The business was sold, closed or moved after January 1',
    jurisdiction: 'tx',
    topics: ['billing', 'rendition', 'classification'],
    authority: ['Tax Code 22.01', 'Tax Code 32.01', 'Tax Code 32.07', 'Tax Code 21.02'],
    keywords: [
      'sold the business',
      'sale of business',
      'asset sale',
      'closed',
      'shut down',
      'ceased operations',
      'went out of business',
      'moved',
      'relocated',
      'buyer',
      'seller',
      'proration',
      'prorate',
      'lien',
      'personally liable',
      'final rendition',
      'close the account',
    ],
    body: `January 1 decides everything, and nothing after it undoes what that day fixed.

Under Tax Code 32.07(a) the tax on personal property is the personal obligation of the person who owned the property on January 1 of the year. A client who sells the business in March owes the whole year's tax on what it owned in January; the Code prorates nothing. A purchase agreement can allocate the cost between buyer and seller, and often does, but that is a contract between them and binds no collector. Under 32.01(a) a lien attaches to the property on January 1 to secure that year's tax, penalties and interest, so a buyer of the assets takes them subject to it. That lien is why an asset purchase closes with a tax certificate, and why a buyer who skipped one can find the equipment it paid for standing security for the seller's bill.

The rendition follows the same date. The January 1 owner renders for that year even if the doors closed on January 2, and property acquired after January 1 waits for next year's form. A register showing a disposal dated after January 1 of the tax year is describing property that was still renderable; it comes off the following year.

A move follows it too. Under 21.02 personal property is taxable where it was located on January 1, so a business that relocated to another county or another state in February owes that year's tax to the old situs and picks up a rendition duty at the new one the following January. There is no partial year at either end.

There is no statutory final rendition. A closed business should tell the district in writing that the account should be closed, because in practice an account that goes quiet is carried forward and appraised on the district's own estimate, and the notice for that estimate goes to an address nobody is reading. Closing the account is a letter, not a form, and it is worth sending the month the business stops rather than the following April.`,
    related: [
      'method-ghost-assets',
      'rendition-what-must-be-rendered',
      'billing-from-value-to-bill',
      'corrections-omitted-property',
    ],
  },
];
