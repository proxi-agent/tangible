import type { KnowledgeArticle } from '../types.js';

/**
 * Getting a return out: what must be rendered, when it is due, what it costs
 * to be late, and what an extension actually buys.
 *
 * Each article restates a rule this repo already implements somewhere —
 * `deadlinesFor`, `extensionStanding`, `buildRendition`. That duplication is
 * on purpose and has one condition attached: when the code changes, the
 * article changes in the same commit. The alternative is an assistant that
 * confidently explains a rule the app no longer follows, which is worse than
 * an assistant that cannot explain it at all.
 */
export const FILING_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'rendition-what-must-be-rendered',
    title: 'What has to go on a rendition',
    jurisdiction: 'tx',
    topics: ['rendition', 'classification'],
    authority: ['Tax Code 22.01', 'Tax Code 22.24', 'Form 50-144'],
    keywords: [
      'render',
      'rendition',
      'january 1',
      'assessment date',
      'what do I report',
      'taxable',
      'owned',
      'in place',
    ],
    body: `Tax Code 22.01(a) requires an owner of tangible personal property used for the production of income to render it to the chief appraiser of the district where it is taxable. What is rendered is what was owned and in place on January 1 of the tax year. Property disposed of before January 1 does not belong on the form; property acquired after January 1 waits for next year's.

The rendition states the property's location on January 1, a description sufficient to identify it, and — at the owner's option in most cases — the owner's good faith estimate of market value, or the historical cost when new and the year acquired. A rendition filed on historical cost and acquisition year is what this practice files: the district applies its own index factors and percent-good tables to arrive at value, and reporting cost keeps the arithmetic in the district's published tables rather than in an unsupported opinion of value.

Rendering is not optional for income-producing property, and the January 1 rule is the one most often got wrong from a fixed asset register. A register is a book record kept for depreciation, not a tax record: it keeps assets long after they are scrapped, moved, or sold, and it carries costs that are not tangible personal property at all. Rendering it unedited over-reports, every year, and nothing in the district's process will catch it.`,
    related: ['rendition-cost-vs-value', 'classification-what-is-not-bpp', 'deadlines-season'],
  },
  {
    id: 'rendition-cost-vs-value',
    title: 'Reporting cost versus reporting an opinion of value',
    jurisdiction: 'tx',
    topics: ['rendition', 'valuation'],
    authority: ['Tax Code 22.01', 'Tax Code 22.24(c)', 'Tax Code 41.41', 'Form 50-144'],
    keywords: [
      'good faith estimate',
      'historical cost',
      'basis',
      'opinion of value',
      'withheld',
      'schedule A',
      'schedule B',
    ],
    body: `Form 50-144 accepts two bases for a line. Historical cost when new plus the year acquired lets the district value the property with its own depreciation schedules. A good faith estimate of market value is the owner's own number, and it commits the owner to defending it.

The consequential difference is what happens later. A good faith estimate given on a rendition is inadmissible in a subsequent proceeding except in a protest under Tax Code 41.41 — so an estimate offered casually can constrain the protest it was meant to leave room for. Cost-and-year reporting keeps the value question open and puts the burden of the arithmetic on the district's published tables.

Zero is never a substitute for an unknown. A line whose value could not be computed is shown as withheld, not as zero: zero on a document sworn under penalty of perjury asserts the property is worthless, which is a statement about the property, not about the gaps in our schedules. Tax Code 22.29 exists for statements like that.`,
    related: ['penalties-late-and-fraudulent', 'valuation-how-a-district-values'],
  },
  {
    id: 'deadlines-season',
    title: 'The Texas rendition calendar',
    jurisdiction: 'tx',
    topics: ['deadlines', 'rendition'],
    authority: [
      'Tax Code 1.06',
      'Tax Code 22.01',
      'Tax Code 22.23(a)',
      'Tax Code 22.23(b)',
      'Tax Code 41.44',
      'Tax Code 11.251',
    ],
    keywords: [
      'due date',
      'april 15',
      'may 15',
      'april 30',
      'deadline',
      'calendar',
      'when is it due',
      'weekend',
    ],
    body: `January 1 is the assessment date: property is counted as it stood that day (22.01).

April 15 is the rendition deadline (22.23(a)), and it is also the last day a written extension request can be made (22.23(b)).

April 30 is the Freeport exemption application deadline (11.251, 11.4391). A granted rendition extension carries this to May 15 as well, under SB 1352 — so an extension buys time on more than the rendition, and a calendar that showed a flat April 30 would send someone scrambling for no reason.

May 15 is the extended rendition deadline where an extension was requested by April 15 (22.23(b)), and it is the floor for the protest deadline (41.44).

The protest deadline is the later of May 15 and the thirtieth day after the notice of appraised value was delivered — so it is not a fixed date, it is a date computed from one particular piece of mail.

Every one of these moves under Tax Code 1.06: where the last day of an act falls on a Saturday, Sunday, or legal holiday, the act is timely on the next regular business day. That rule governs the fixed dates above and the counted ones equally.`,
    related: ['extensions-what-a-request-buys', 'protest-three-clocks'],
  },
  {
    id: 'extensions-what-a-request-buys',
    title: 'What a rendition extension actually moves',
    jurisdiction: 'tx',
    topics: ['extensions', 'deadlines'],
    authority: ['Tax Code 22.23(b)'],
    keywords: [
      'extension',
      'extend',
      'more time',
      'good cause',
      'fifteen days',
      'granted',
      'shall extend',
      'may extend',
    ],
    body: `Tax Code 22.23(b) makes two different promises in two sentences, and treating them alike is how a firm files late believing it had until May.

The first sentence is not a favour. On written request made on or before the April 15 deadline, the chief appraiser shall extend the deadline to May 15. Because it is mandatory, the extension exists whether or not the district ever writes back — the deadline moves the day the request goes out, and a district's silence is not a denial.

The second sentence is discretion. The chief appraiser may further extend by not more than 15 additional days, for good cause shown. "May" and "for good cause" mean this one moves nothing until somebody actually grants it. Recording a request for additional days and then treating the deadline as moved is the same mistake as not filing.

A standard request sent after April 15 is a third case: it obliges nobody. It is still worth sending and worth recording, because a district that grants it anyway is a fact you want in writing.`,
    related: ['deadlines-season', 'penalties-late-and-fraudulent'],
  },
  {
    id: 'penalties-late-and-fraudulent',
    title: 'The rendition penalties, and the window to ask for a waiver',
    jurisdiction: 'tx',
    topics: ['penalties', 'rendition'],
    authority: ['Tax Code 22.28', 'Tax Code 22.29', 'Tax Code 22.30'],
    keywords: [
      'penalty',
      '10%',
      '10 percent',
      '50%',
      'fraud',
      'waiver',
      'waive',
      'late filing',
      'failure to render',
    ],
    body: `Tax Code 22.28 imposes a penalty of 10 percent of the total amount of taxes imposed on the property for that year, where the property is rendered late or not at all. It is charged on the taxes, not on the value, and it recurs for each year the failure recurs.

Tax Code 22.29 is the larger one: 50 percent of the taxes, where a person files a false statement with intent to commit fraud or to evade the tax, or in connection with a scheme to do so. It is why a nil or wildly understated figure on a sworn form is a different category of risk from a late one.

Tax Code 22.30 lets the chief appraiser waive the 22.28 penalty. The request must be made within 30 days after the property owner receives notice of the penalty, and it must show substantial compliance or a good cause for the failure. That 30-day window has no May 15 floor under it, so it can close weeks before the protest window on the same notice does — which is why a notice carrying a penalty starts two clocks, not one, and the shorter one is the one that gets missed.`,
    related: ['protest-three-clocks', 'extensions-what-a-request-buys'],
  },
  {
    id: 'rendition-one-form-per-location',
    title: 'One rendition per location, not one per client',
    jurisdiction: 'tx',
    topics: ['rendition', 'product'],
    authority: ['Tax Code 21.02', 'Tax Code 22.01', 'Form 50-144'],
    keywords: [
      'situs',
      'location',
      'site',
      'multiple locations',
      'how many forms',
      'account number',
      'per site',
    ],
    body: `Personal property is taxable where it is located on January 1, subject to the situs rules in Tax Code 21.02. A business with three locations in one county therefore has three situs addresses, usually three appraisal district accounts, and three renditions — not one form listing everything.

That is why property has to be placed at a site before a return can be built for it. Property placed nowhere cannot be rendered, because the form has nowhere to say it was. It is not a data-entry nicety: filing all of a company's assets at its headquarters address understates one account and overstates another, and both are wrong in ways the district will eventually notice.

The account number belongs to the site, not to the client. When a client's accounts are looked up on the public roll, they come back one per location, and matching them to sites is what lets a filed return be checked against what the district actually did with it.`,
    related: ['rendition-what-must-be-rendered', 'county-data-what-the-roll-holds'],
  },
  {
    id: 'rendition-who-signs',
    title: 'Who may sign a rendition, and what notarization turns on',
    jurisdiction: 'tx',
    topics: ['rendition', 'agents'],
    authority: ['Tax Code 22.24(e)', 'Tax Code 22.26', 'Form 50-144'],
    keywords: [
      'signature',
      'sign',
      'notarize',
      'notary',
      'capacity',
      'owner',
      'employee',
      'secured party',
      'fiduciary',
      '150,000',
      'good faith estimate',
    ],
    body: `Form 50-144 asks in what capacity the person signs, and the answer decides whether the form needs a notary.

Tax Code 22.24(e) lists who signs without an oath: a secured party rendering under 22.01(a)(5), the property owner, an employee of the owner, and an employee of an owner acting on behalf of an affiliated entity. A fifth case is not about who signs but about the number: a rendition filed on behalf of an owner whose good faith estimate of the market value of the property is not more than $150,000 also needs no notary. Anyone else signing for the owner — an agent, a fiduciary — signs a rendition that must be notarized.

Read carefully, the $150,000 test turns on the good faith estimate, not on the district's value or on cost. A firm filing as agent on cost and year acquired gives no estimate, so the carve-out has nothing to measure and the conservative reading is that the form is notarized. A firm filing an estimate at or under $150,000 as agent is inside the carve-out. Above it, an agent-filed estimate is notarized every time.

This is the single most common reason a return that is otherwise complete cannot go out. The capacity question, and the basis that decides whether the $150,000 test even applies, have to be settled before the form is drafted, not at the moment it is due.

Tax Code 22.26 requires the rendition to be signed; an unsigned form is not a filed rendition, and the 22.28 penalty runs as if nothing was sent.`,
    related: ['agents-form-50-162', 'penalties-late-and-fraudulent'],
  },
  {
    id: 'rendition-form-schedules',
    title: 'Where each kind of property goes on Form 50-144',
    jurisdiction: 'tx',
    topics: ['rendition', 'classification'],
    authority: ['Form 50-144', 'Tax Code 22.01', 'Tax Code 22.04', 'Tax Code 23.12'],
    keywords: [
      'schedule A',
      'schedule B',
      'schedule C',
      'schedule D',
      'schedule E',
      'schedule F',
      'which schedule',
      'supplies',
      'consumables',
      'raw materials',
      'work in process',
      'consigned',
      'leased equipment',
      'expensed',
      'capitalization threshold',
      'fully depreciated',
      '20,000',
    ],
    body: `Form 50-144 sorts reportable property into six schedules, and the sorting is by what the property is to the district, not by how the register groups it.

Schedule A is a shortcut, not a category. Where the owner's total taxable personal property at the location is under $20,000, the form accepts a general description and a total, with type, year and cost optional. It turns a long filing into three fields, so it is worth detecting; it is not a place to put a larger account in the hope nobody adds it up.

Schedule B is inventory: goods held for sale, raw materials and work in process, reported at cost as of January 1. The district carries it at full cost with no index factor and no depreciation, because Tax Code 23.12 values inventory as a unit for sale rather than as ageing equipment. A Freeport claim on part of it is applied for separately, never netted here.

Schedule C is supplies: consumables on hand on January 1 that are not held for sale. Packaging, spare parts, office and janitorial stock. The measure is what was physically on hand that day, not the year's purchases, and a client who answers with an annual supplies expense has answered a different question.

Schedule D is licensed vehicles, trailers and special equipment, by year and description. The district values these from its own vehicle sources where it can match them, so the description matters more than the cost.

Schedule E is the main schedule: furniture and fixtures, machinery and equipment, computers and the rest, by type and year acquired at historical cost when new. Net book value is never what it asks for, and a register exported at net book value understates every line until the cost column is found.

Schedule F is property the owner holds but does not own: leased-in equipment, bailments, consigned goods. Tax Code 22.04 lets the chief appraiser require a report of property held for others, and the form gathers it here so the district assesses the actual owner. Reporting it on F is the opposite of rendering it — a leased copier on Schedule E is taxed to the client; on Schedule F it is pointed at the lessor.

Two things belong on the form that a book record tends to leave off. Tax Code 22.01(a) reaches all tangible personal property used for the production of income, so an asset expensed under a book capitalization policy is still rendered; the district does not care what the ledger did with the invoice. And fully depreciated property is still property. Those two are the usual reasons a rendition built from a general ledger and one built from a physical count disagree.`,
    related: [
      'rendition-what-must-be-rendered',
      'rendition-cost-vs-value',
      'classification-vehicles-schedule-d',
      'exemptions-freeport-and-allocation',
    ],
  },
  {
    id: 'rendition-inspection-and-explanation',
    title: 'When the district comes to look, or asks how a number was reached',
    jurisdiction: 'tx',
    topics: ['rendition', 'penalties', 'confidentiality', 'deadlines'],
    authority: ['Tax Code 22.07', 'Tax Code 22.27', 'Tax Code 22.28', 'Tax Code 41.41'],
    keywords: [
      'inspection',
      'inspect',
      'site visit',
      'field visit',
      'appraiser visit',
      'request for information',
      'explain',
      'how did you arrive',
      'substantiate',
      'support the estimate',
      '21 days',
      'twenty-one days',
      'federal depreciation',
      '50 employees',
    ],
    body: `Tax Code 22.07 gives the district two ways to test a rendition after it is filed, and each has a clock or a boundary worth knowing before the letter arrives.

The first is a visit. Under 22.07(a) the chief appraiser or a representative may enter the premises of a business and inspect the property to determine whether income-producing tangible personal property exists and what it is worth. Subsection (b) confines that to normal business hours or a time the owner agrees to. It is an inspection of property, not of books: the statute gives no right to the general ledger, and a preparer on site should show the equipment and keep the register in the file.

The second is a written demand. Where a rendition carries a good faith estimate, 22.07(c) lets the chief appraiser request a statement of how it was arrived at: the property's physical and economic characteristics, the sources used, the effective date, and the basis. A business with 50 or fewer employees may base that estimate on its federal income tax depreciation schedules, which is a real safe harbour for a small client. The statement is due within 21 days of the request under 22.07(d); it is for information only and is inadmissible in any later proceeding except to decide whether the owner complied, in a fraud penalty proceeding under 22.29, or in a protest under 41.41. Subsection (e) makes it confidential under 22.27.

The part that bites is 22.07(f): failing to deliver the statement within the 21 days is treated as a failure to render, and it draws the 22.28 penalty of ten percent of the taxes. So a request letter starts a 21-day clock the same way a penalty notice starts a 30-day one, and it lands in the middle of protest season when nobody is watching for it.

A rendition filed on cost and year acquired draws fewer of these, because there is no estimate to explain. When one does come, the answer is the register extract and the basis of classification for each line, not the firm's findings analysis; 22.27 does not oblige handing that over, and the demand does not ask for it.`,
    related: ['rendition-cost-vs-value', 'penalties-late-and-fraudulent', 'confidentiality-22-27'],
  },
  {
    id: 'classification-vehicles-schedule-d',
    title: 'Licensed vehicles stay on Schedule D, and the one exit is an application',
    jurisdiction: 'tx',
    topics: ['classification', 'exemptions', 'rendition'],
    authority: [
      'Tax Code 22.01(k)',
      'Tax Code 11.254',
      'Tax Code 11.252',
      'Tax Code 11.43',
      'Form 50-144',
      'Form 50-759',
    ],
    keywords: [
      'vehicle',
      'vehicles',
      'truck',
      'car',
      'fleet',
      'company car',
      'personal use',
      'mixed use',
      'leased vehicle',
      'lessee',
      'forklift',
      'trailer',
      'schedule D',
      '11.254',
    ],
    body: `Every titled, licensed vehicle the business owned on January 1 goes on Schedule D of Form 50-144, by year and description. A licensed vehicle means plates and road use: a forklift, a yard truck or a skid steer is machinery on Schedule E, however much it looks like a vehicle, and a trailer with a plate is on D.

The one route off the form is narrow and is not automatic. Tax Code 11.254 exempts one motor vehicle owned by an individual that is used in the individual's occupation or profession and also for personal activities, where the vehicle is a passenger car or light truck and is not used to carry passengers for hire. Tax Code 22.01(k) then relieves the rendition duty for that vehicle, but only for an individual who has been granted the exemption or has applied for it. Three things follow. An entity cannot claim it, so a company truck driven home every night is rendered regardless of how it is used. Qualifying without applying relieves nothing; the application is Form 50-759, filed with the district under 11.43, and once allowed it need not be re-filed each year. And it is one vehicle per person, which is why the application asks for a plate.

Leased vehicles run the other way. Tax Code 11.252 exempts a motor vehicle to its owner, the lessor, where the lessee does not hold it for the production of income, which is presumed where at least half the miles are non-income use. The lessee signs an affidavit on the comptroller's form and the lessor keeps it available for the chief appraiser; a lessor who cannot produce it must render the vehicle. So a client who leases its fleet in does not put those vehicles on Schedule D at all — they belong on Schedule F as property held but not owned — and the exemption is the lessor's question, not the client's. Cities with an ordinance predating 2002 may tax leased vehicles anyway, which is a local fact worth checking rather than assuming.

Tangible asks the personal-use question once, as a warning, whenever Schedule D carries something. The answer is recorded against the return rather than used to remove a line, because removal turns on the application having been made, not on the answer.`,
    related: ['rendition-form-schedules', 'exemptions-other-bpp', 'product-ready-and-blockers'],
  },
];
