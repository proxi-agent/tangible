import type { KnowledgeArticle } from '../types.js';

/**
 * How this practice reads a register: the detectors, what each one is claiming,
 * how sure it is, and what would settle it.
 *
 * These articles exist because the assistant was fluent in the statute and
 * mute about the method. It could quote Tax Code 22.01(a) and could not say
 * what a ghost asset is, why one sits at 0.72 and its cousin at 0.28, or why a
 * screening finding carries no dollar figure. Asked anyway — and it is asked,
 * constantly, because these are the words on every findings screen — it
 * answered from what a language model generally believes about fixed asset
 * audits, which is plausible, unsourced, and occasionally the opposite of what
 * this code does.
 *
 * Two kinds here, and the difference decides the `authority` field. An article
 * that states a rule of tax carries the statute the detector cites and the
 * state it is a rule of. An article that describes how Tangible weighs
 * evidence rests on this repository, carries no authority, and is tagged
 * `product` as well as `method` — the same convention the other product
 * articles follow, for the same reason: an answer leaning on one of these is
 * describing a tool, not a requirement, and the two must never be quoted in
 * the same voice.
 *
 * The numbers below are copied from `packages/savings`, and copying them is a
 * liability with a rule attached: when a weight, a threshold, or a citation
 * moves there, it moves here in the same commit. A corpus that describes last
 * month's detector is worse than one that describes none.
 */
export const METHOD_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'method-finding-catalogue',
    title: 'The fourteen findings, and what each one claims',
    jurisdiction: 'tx',
    topics: ['method', 'classification', 'valuation'],
    authority: [
      'Tax Code 22.01(a)',
      'Tax Code 11.02',
      'Tax Code 23.01(b)',
      'Tax Code 23.24',
      'Tax Code 21.02',
      'Tax Code 25.25(c)',
      'Tax Code 25.25(c-1)',
      'Tax Code 11.145',
      'Tax Code 11.251',
      'HCAD Schedule Value Calculation Guidelines',
    ],
    keywords: [
      'detector',
      'detectors',
      'findings',
      'what do we look for',
      'catalogue',
      'rules',
      'ghost assets',
      'duplicate',
      'freeport',
      'situs',
      'misclassification',
      'idle',
      'obsolete',
      'de minimis',
      'carryforward',
    ],
    body: `Fourteen detectors run against a classified register. Each one has a statutory hook, and the hook is what the finding is arguing, not decoration.

Ghost assets: property the register marks as disposed. Tax Code 22.01(a) renders what was owned on January 1; 25.25(c)(3) reaches property that does not exist at the location described. The least arguable finding on the list.

Non-taxable property: real property, leasehold improvements, software and leased-in equipment sitting in a fixed asset register. Tax Code 11.02 reaches tangible personal property; 23.24 puts an improvement on the real property account.

Fully depreciated: assets older than the last published schedule year, which sit at the class floor. HCAD's published tables plus 23.01(b). Harris-scoped, because the floor is a property of that district's table.

Leasehold double tax: tenant build-out already inside the landlord's real property assessment. Tax Code 23.24.

Freeport: inventory that may leave the state within 175 days. Tax Code 11.251 and Const. art. VIII s. 1-j. Local-option and claimed by application, so the detector raises the question and never asserts the exemption.

Duplicate capitalization: the same property rendered more than once. Tax Code 25.25(c)(2), multiple appraisals of a property in one year.

Non-assessable cost: freight, installation, engineering, software and sales tax capitalized into an equipment line. Tax Code 11.02 with 23.01(b) — the tax reaches the machine, not the accounting total booked under it.

Situs error: property taxable in another district on January 1. Tax Code 21.02 with 25.25(c)(3). This moves value between accounts rather than out of tax.

Misclassification: a life class longer than the client's own books or identical neighbours imply. HCAD's guidelines and SIC table. Harris-scoped for the same reason as the floor.

Leased double report: right-of-use assets the lessee is rendering. Tax Code 22.01(a) with ASC 842, which put operating leases in the register in the first place.

De minimis: everything in one taxing unit under the exemption. Tax Code 11.145 as raised by HB 9 and Proposition 9 — $125,000 from tax year 2026, $2,500 before it. The only genuinely year-scoped rule in the set.

Carryforward error: last year's return reported more historical cost in a bucket than the books hold. Tax Code 25.25(c-1), which reaches the current year and either of the two preceding.

Suspected retired: old property with no corroborating record. Tax Code 22.01(a), raised as a question about ownership and never as an asserted disposal.

Idle or obsolete: property the client's own books impaired. Tax Code 23.01, with the obsolescence argued from the write-down the accountant already signed.

Every citation in this set is Texas law, and the scope is written down as such. A register from another state is refused rather than analysed under Tax Code 21.02 by accident.`,
    related: ['method-ghost-assets', 'method-kinds-and-effects', 'method-confidence-tiers'],
  },
  {
    id: 'method-ghost-assets',
    title: 'What a ghost asset is, and the date that decides whether it saves anything',
    jurisdiction: 'tx',
    topics: ['method', 'rendition', 'classification'],
    authority: ['Tax Code 22.01(a)', 'Tax Code 25.25(c)(3)', 'Tax Code 41.41(a)'],
    keywords: [
      'ghost asset',
      'ghost assets',
      'disposed',
      'disposal date',
      'scrapped',
      'sold',
      'retired',
      'still on the register',
      'lien date',
      'january 1',
      'property that does not exist',
    ],
    body: `A ghost asset is property the fixed asset register still lists that the business no longer owned on January 1. The register is the evidence: a disposal flag, and ideally a disposal date, recorded by the client's own accounting.

The name gets used loosely in this industry for anything that looks gone. This product uses it narrowly, for the recorded case, and keeps the unrecorded case under a different name — see the suspected-retired article. The distinction is the difference between a position and a lead, and blurring it is how a firm files something it cannot support.

Why it is the strongest finding in the set: Tax Code 22.01(a) requires rendering property owned or managed on January 1, so property gone before that date was never renderable. Tax Code 25.25(c)(3) reaches property that does not exist in the form or at the location described in the appraisal roll, which is exactly what a disposed asset on the roll is — and 25.25(c) reaches five preceding years with no threshold and no penalty. Chapter 41 offers the same argument in-season under 41.41(a): inclusion of the property on the appraisal records, a question of fact rather than of appraisal judgment.

The date decides everything, and it decides it twice.

Its presence is corroboration. A register that recorded when something left is a register somebody maintained, and that lifts the row. A disposal flag with no date beside it lowers it — the client marked something and did not write down what happened.

Its value is the position. Property disposed of in March was owned on January 1 and belongs on that year's return however plainly the register says it is gone. That row is not a saving. It is the single largest negative weight anywhere in the detection code, and it exists because a register that spans two years will hand you a page of disposals that are all real and none of them yours to remove. The row still prints, because a reviewer needs to see what was considered, but it will never surface in a high-confidence filter.

Exposure runs from the year after the disposal, not the disposal year: the owner did hold the asset on that January 1, so the roll was right for that year and wrong from the next one.

Accepting a ghost-asset finding does not change the form. The register already marks the asset disposed and the rendition already drops it, both before anybody decided anything. What the decision adds is a cross-check — a ghost-asset finding rejected against property the form is still dropping means the decision log and the register disagree, and one of them is wrong.`,
    related: [
      'method-suspected-retired',
      'corrections-25-25-routes',
      'product-findings-and-dispositions',
    ],
  },
  {
    id: 'method-suspected-retired',
    title: 'Suspected retired: the six habits that suggest an asset already left',
    jurisdiction: 'tx',
    topics: ['method', 'rendition'],
    authority: ['Tax Code 22.01(a)'],
    keywords: [
      'suspected retired',
      'looks gone',
      'never marked',
      'no disposal recorded',
      'zombie asset',
      'past its life',
      'walk the floor',
      'physical inventory',
      'screening',
    ],
    body: `Suspected-retired is the finding for property that shows several signs of having left without anybody recording it. It is deliberately not called a ghost asset, and it deliberately starts below the medium confidence threshold, because nothing in a register proves an asset is gone. The register knows what was bought. It does not know what walked out.

Six habits, each a signed weight, and it takes more than one before a row appears at all.

Age against class life: past the schedule life is a small signal, well past it a larger one. Age alone is common and proves nothing.

Retirement discipline in the cost centre: a department holding a real number of assets that has never recorded a single retirement, while several are overdue, is a department whose register is not being maintained. The reverse is a negative signal — a cost centre that retires things regularly is one whose silence about an asset means something.

Siblings: assets bought from the same vendor on the same date that were themselves disposed of. Vendor plus acquisition date stands in for the purchase order the register does not carry, and where most of a batch is gone the signal is much stronger.

Round cost: a suspiciously round figure suggests an estimate rather than an invoice. Silent below ten thousand dollars, where round numbers are ordinary.

Description: generic wording — "equipment", "misc", "furniture" — is a signal, because a line nobody can identify is a line nobody can find on a floor. A description carrying a serial number, a model number, or a dimension pushes the other way.

Location: no location recorded is a signal, a location recorded as unknown a stronger one, a real location a negative.

Two guards keep this honest. A minimum cost, because walking a floor to chase a two-hundred-dollar chair costs more than the tax. And a standing negative signal on every row of the finding, stating in the row itself that the register does not say this is gone — the signals do — and naming what would settle it: a walk of the floor, or a maintenance record.

It claims no prior years. Ghost assets carry exposure back through the correctable window; this one carries none, because a screening question is not a basis for a correction motion.

What settles it is physical: a walk-through, an insurance schedule, maintenance records, badge or production data. None of that is connected to this product. Anything genuinely gone comes off next year's return as well as this one, which is usually the argument that gets the walk-through scheduled.`,
    related: ['method-ghost-assets', 'method-confidence-tiers', 'method-register-limits'],
  },
  {
    id: 'method-kinds-and-effects',
    title: 'Measured, modeled, screening — and why a question is never priced',
    topics: ['method', 'product'],
    authority: [],
    keywords: [
      'measured',
      'modeled',
      'screening',
      'saving',
      'exposure',
      'neutral',
      'why is there no number',
      'expected recovery',
      'total savings',
      'netting',
    ],
    body: `Every finding carries two labels on two independent axes, and the independence is the point.

The kind says how the number was arrived at. Measured is computed from data held: ghost assets, non-assessable cost read off invoices, a carryforward excess measured against a prior return. Modeled rests on a stated assumption about how the client rendered — non-taxable property valued as though it had been rendered on the district's general default, duplicates, situs, misclassification, de minimis. Screening is a question no register can answer: fully depreciated, leasehold double tax, freeport, leased double report, suspected retired, idle or obsolete.

Only measured and modeled findings carry a figure into the total. A screening finding has no dollar amount at all, and that is not an omission to be filled in later. Pricing a question converts a thing worth asking into a number a client will repeat to their board, and the assistant must not supply one — not as a range, not as an illustration, not with a caveat. What a screening finding carries instead is what would settle it: the document, the record, or the walk-through that turns it into a position.

The effect says which way it moves the client. Saving takes value off the return. Exposure means the client is under-reported and should hear it from us before the district finds it. Neutral moves nothing.

Kept as a separate axis on purpose. An under-reported category is a real, well-evidenced, measured finding that the client owes more than they filed, and folding it into the same scale as a saving is how a report quietly nets exposure against relief and presents the remainder as money saved. The two totals never meet. Both get shown.

Nothing unreviewed is counted. Assets still sitting in the classification queue are excluded from the figures and the report says so, because a savings number inflated by unreviewed guesses is worse than no number.`,
    related: [
      'method-confidence-tiers',
      'product-findings-and-dispositions',
      'method-finding-catalogue',
    ],
  },
  {
    id: 'method-confidence-tiers',
    title: 'How confident a finding is, and what each tier licenses',
    topics: ['method', 'product'],
    authority: [],
    keywords: [
      'confidence',
      'high',
      'medium',
      'low',
      'score',
      'signals',
      'evidence',
      'why is this low confidence',
      'threshold',
      'weight',
      'detection basis',
    ],
    body: `Confidence here is a property of a position, not of a model call. A disposed asset with a disposal date on it is a strong position whether a rule or a model found it, and a leasehold flagged purely on its category is a weak one either way.

A score is built from named signals with signed weights, and every signal stays on the row. Three things follow that would not from a bare number: a reviewer who disagrees can see which signal to argue with; the detection basis at the top of a category page is a group-by over the signals rather than prose somebody has to keep true; and when dispositions come back, each is a label attached to the signals that produced it, which is the only form this is worth learning from later.

Two thresholds. At or above 0.75 is high — a reviewer can act on the row without going back to the register. At or above 0.45 is medium. Below 0.45 is low: a lead rather than a position, and the honest thing to call it.

Each finding starts from a base rate that belongs to the finding rather than to the asset. A recorded disposal starts near the top, at 0.72. Non-taxable property, invoice-read non-assessable cost and de minimis start around 0.6. Duplicates and carryforward errors start at 0.5 — four things agreeing about two rows is a real claim and still a claim, because a register cannot distinguish a double entry from a real pair. Misclassification, situs, the schedule floor, leased double report, leasehold double tax and freeport start between 0.34 and 0.44: arguments to be made rather than errors to be corrected, since the class is the district's to decide and property in the wrong place usually moves rather than vanishes. Idle-obsolete and suspected-retired start at 0.3 and 0.28, below the medium line on purpose, because nothing in a register proves an asset is gone or idle and it should take real corroborating signal to lift one into a tier a reviewer filters on.

The row's own signals move it from there, in both directions. Negative signals are as important as positive ones and are shown, not netted away silently: no acquisition year, no cost recorded, a disposal flag with no date, distinct serial numbers inside a duplicate group, a specific description on a row suspected of being retired.

The weights are judgement, not measurement, and they are legible judgement — each one is a sentence about tax written next to a number. They stop being judgement per finding rather than all at once: once enough decisions have come back for a given finding, the weights are refitted against what reviewers actually said and the fit is consulted instead.

Never report a confidence score without the signals behind it. The number alone is the one part of this that cannot be argued with, which makes it the least useful part to hand someone.`,
    related: ['method-kinds-and-effects', 'method-suspected-retired', 'method-register-limits'],
  },
  {
    id: 'method-duplicate-detection',
    title: 'How a duplicate is found, and when it is left alone',
    jurisdiction: 'tx',
    topics: ['method', 'classification'],
    authority: ['Tax Code 25.25(c)(2)'],
    keywords: [
      'duplicate',
      'duplicates',
      'capitalized twice',
      'same asset twice',
      'double entry',
      'imported twice',
      'components and total',
      'serial number',
    ],
    body: `A duplicate finding says the same property is on the rendition more than once, and the district values every line it is given. Tax Code 25.25(c)(2) reaches multiple appraisals of the same property in one year specifically, which is why this is a correction route rather than only an argument.

Four things have to agree before two rows are grouped: the descriptions are close, by a similarity measure well above a coincidental match; the costs are within about two percent of one another; the acquisitions fall within about four months; and the cost centre is the same. Any one of the four on its own is ordinary — a business buys ten of the same thing all the time. Four together is a claim worth making, and it is a modeled finding rather than a measured one because a register cannot distinguish a double entry from a real pair.

The two shapes this usually takes: a project capitalized once as a total and again as its components, and a batch imported twice into the ledger.

Where the rows carry distinct serial numbers or asset tags, the group is scored down hard rather than deleted. Ten identical desks on one purchase order are ten real assets; one lathe entered by two teams is one asset. Keeping the scored-down group printed is deliberate — a reviewer can see what was considered and set aside, which is more useful than a silent suppression, and the same reviewer occasionally disagrees with the suppression.

The saving is the excess: keeping one copy of each group and removing the rest.`,
    related: ['method-finding-catalogue', 'method-confidence-tiers', 'corrections-25-25-routes'],
  },
  {
    id: 'method-non-assessable-cost',
    title: 'Cost inside a capitalized line that is not taxable property',
    jurisdiction: 'tx',
    topics: ['method', 'valuation', 'classification'],
    authority: ['Tax Code 11.02', 'Tax Code 23.01(b)'],
    keywords: [
      'freight',
      'shipping',
      'installation',
      'rigging',
      'millwright',
      'engineering',
      'sales tax',
      'software',
      'capitalized cost',
      'invoice',
      'what comes out of cost',
    ],
    body: `Capitalization rules and tax rules disagree about what belongs in the cost of a machine, and the register follows the capitalization rules because it is a book record kept for depreciation.

Freight and rigging, installation and millwright labour, engineering and commissioning, software licences, and sales tax are all routinely capitalized into the same line as the equipment. Texas assesses tangible personal property under Tax Code 11.02, at market value determined by generally accepted methods under 23.01(b) — it does not assess the accounting total booked under the machine. Rendered on the machine alone, the schedule value falls with the cost.

This is a measured finding, and it is measured because of a hard restriction: a line only appears here if there is an invoice behind it that was actually read. Nothing is estimated from a percentage. There is a standing temptation to apply a rule of thumb — freight is usually a few percent, installation is usually a bit more — and a rendition built on rules of thumb is a rendition with no evidence under it. If asked to estimate non-assessable cost without invoices, say what it would take instead: the invoices.

Extractions a preparer has not yet checked are scored down and say so on the row, because reading an invoice is not the same as a preparer agreeing with how its lines were split.

One caution that is easy to get backwards. Cost that is not taxable property coming out is a saving; cost the client left out of a line that should have been in it is exposure. Both are measured findings and they do not net against each other.`,
    related: ['method-finding-catalogue', 'rendition-cost-vs-value', 'classification-what-is-not-bpp'],
  },
  {
    id: 'method-register-limits',
    title: 'What a fixed asset register cannot tell you',
    topics: ['method', 'product'],
    authority: [],
    keywords: [
      'register',
      'fixed asset register',
      'limits',
      'unknown',
      'blank',
      'missing acquisition year',
      'no cost',
      'no location',
      'zero',
      'what we cannot know',
    ],
    body: `Most wrong answers in this practice come from treating an absence in the register as a fact.

No register proves an asset is gone. It records what was bought and, if somebody kept it up, what was disposed of. Silence about an asset means silence, which is why the recorded-disposal finding and the suspected-retired finding are separate things with very different confidence.

A blank acquisition year is not an old asset. It means nothing can be valued at all — there is no schedule year to read a percent good from — and it is a blocker on the return rather than an input to it.

A blank cost is not a zero. Zero is never a substitute for unknown, in a figure, in a total, or in a sentence. A row with no cost lowers the confidence of any finding that includes it and says so.

No location column is the normal case, not an anomaly, and it is why situs is a modeled finding rather than a measured one. Most registers carry no situs signal at all.

The register is a book record kept for depreciation. It carries right-of-use assets the client does not own, real property improvements, software, and capitalized costs that are not property — not by mistake, but because that is what the accounting standards require of it. Classification is the step that reads a book record as a tax schedule, and nothing downstream of it is more reliable than it is.

The rendition itself is confidential in the district's hands, so what an account previously reported is an inference unless the firm holds a copy of what was filed. A prior return in hand converts several screening findings into measured ones, which is usually the highest-value document to ask a new client for.

When the record does not answer a question, the correct answer is that it does not, together with what would. Filling the gap with a plausible figure is the one failure mode this whole product is arranged against.`,
    related: ['method-suspected-retired', 'method-kinds-and-effects', 'product-ready-and-blockers'],
  },
  {
    id: 'method-return-comparisons',
    title: 'The findings that come from a prior return rather than from the register',
    jurisdiction: 'tx',
    topics: ['method', 'corrections', 'rendition'],
    authority: ['Tax Code 22.01(a)', 'Tax Code 25.21', 'Tax Code 25.25(c)', 'Tax Code 25.25(c-1)', 'Tax Code 22.28'],
    keywords: [
      'prior return',
      'last year',
      'compare',
      'comparison',
      'register comparison',
      'carry forward',
      'carry-forward',
      'rendered after disposal',
      'over-reported',
      'under-reported',
      'misscheduled',
      'omitted',
      'dropped',
      'not itemized',
      'aggregate',
      'reconcile',
    ],
    body: `The fourteen detectors read the register on its own. Two further readings need a prior return beside it, and they produce findings of their own that are worded differently because they prove different things.

The register comparison subtracts a filed return, read line by line and mapped into the same categories the register is classified to, from the register itself. Four findings can come out. Rendered after disposal: cost on the return for property the register says was already gone by that January 1; measured, a saving, and the ground for a 25.25(c)(3) motion on the earlier roll. Over-reported: cost on the return the register does not carry at all; modelled, because the books may be incomplete rather than the return wrong. Under-reported: property on the register the return never accounted for; an exposure, worded against the client's own filing, and the one that is disclosed rather than hidden when the next return goes out, since 25.21 lets the district reach either of the two preceding years. Misscheduled: cost filed under the wrong category for its year, which moves value in whichever direction the two schedules' tables point. Three rules keep the comparison honest: property bought after that January 1 or disposed before it is set aside by name rather than netted in; nothing still in the classification queue is compared; and the compared cost plus the set-aside cost is the whole register, so every figure walks back to a total.

The carry-forward reads last season's return as this app froze it, at the level of the individual assets the return was built from, which is the one comparison the paper cannot make. Its verdicts are per asset. Omitted from the prior return, the critical one: owned before that January 1 by its own acquisition year and not in the slice the return was built from, which is 25.21 exposure with a 22.28 penalty attaching to the omitted year. Dropped from the register: on last year's return and not on this year's book, and absence is not disposal, so it is a question for the client rather than a retirement. Not itemized: the prior return is a document the client filed, which reports in aggregate and never names an asset, so it proves the site was rendered and nothing about any single line. Undated and unrendered: no acquisition year, so whether it was renderable last year cannot be said either way. Carried and now disposed: the disposal date decides which side of January 1 it falls on, and the rendition applies that test itself. And no prior return on file, which is a gap in the filing cabinet and not a finding about the client, because a location whose return this app never held cannot be called omitted on the strength of our own missing records.

Both readings say considered rather than filed. A return's frozen asset list is the slice it was built from, and the rendition then set part of that slice aside for recorded reasons; the comparison is worded against the return, which is the part that can be proven.`,
    related: ['method-finding-catalogue', 'method-ghost-assets', 'corrections-25-25-routes', 'corrections-omitted-property'],
  },
];
