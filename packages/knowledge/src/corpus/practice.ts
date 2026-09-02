import type { KnowledgeArticle } from '../types.js';

/**
 * Working the practice rather than the statute: authority to act, what may be
 * said to whom, what the public roll does and does not contain, and how this
 * product's own screens should be read.
 *
 * The `product` articles are the ones that keep the assistant from explaining
 * the app wrongly. They rest on this repo rather than on a statute, and their
 * `authority` is empty for that reason — an answer that leans on one is
 * telling the reader how Tangible works, not what a state requires, and the
 * two should never be quoted in the same voice. They carry no `jurisdiction`
 * for the same reason: the app behaves the same way in every state.
 */
export const PRACTICE_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'agents-form-50-162',
    title: 'Form 50-162 and when an agent may act',
    jurisdiction: 'tx',
    topics: ['agents'],
    authority: ['Tax Code 1.111', 'Tax Code 1.111(d)', 'Form 50-162'],
    keywords: [
      'agent',
      'appointment',
      'authorization',
      'designated agent',
      'revoked',
      'expired',
      'may we file',
      '50-162',
    ],
    body: `Form 50-162 designates an agent for property tax matters. Its own instructions decide most of the question of whether we may act:

The designation does not take effect until it is filed with the appropriate appraisal district. Once effective, it stays in effect until the earlier of a written revocation filed with the district by the owner or the agent, or the expiration date designated on the form, if any.

So an appointment has three ways to be worth nothing — unfiled, revoked, expired — and a fourth that nobody tells us about. Under Tax Code 1.111(d) a property owner may not designate more than one agent for the same item of property, and a new designation automatically revokes the previous one for that property. A client who signed with another firm last season may have revoked us without either of us knowing.

Because of that, the question is never just "do we have an appointment" but "were we appointed on the day we signed this document." An appointment's standing has to be answerable about a past date, not only about today.

An appointment can also be scoped — to a district, or to particular locations. A firm-wide answer of "yes we're appointed" can still be no for one site.`,
    related: ['rendition-who-signs', 'confidentiality-22-27'],
  },
  {
    id: 'confidentiality-22-27',
    title: 'Rendition confidentiality, and what the district may disclose',
    jurisdiction: 'tx',
    topics: ['confidentiality'],
    authority: ['Tax Code 22.27', 'Tax Code 22.27(b)'],
    keywords: [
      'confidential',
      'disclosure',
      'public records',
      'who can see',
      'why is this not public',
      'open records',
    ],
    body: `Tax Code 22.27 makes rendition statements, real and personal property reports, and the information they contain confidential in the hands of the appraisal district. They are not public records, which is why a rendition's contents never appear on the public appraisal roll and why account-level BPP detail cannot simply be looked up.

22.27(b) lists the exceptions — including disclosure to the person who filed the statement or that person's representative authorized in writing to receive the information. Form 50-144 asks about this directly, and the answer decides whether the district may show the client's file to us.

Two working consequences. Client register data, filed renditions, and the engagements around them are confidential and stay out of anything published. And a district refusing to discuss an account with us is usually an authorization problem on our side rather than an obstruction on theirs.`,
    related: ['agents-form-50-162', 'county-data-what-the-roll-holds'],
  },
  {
    id: 'county-data-what-the-roll-holds',
    title: 'What the public appraisal roll contains — and what it leaves out',
    topics: ['county-data'],
    authority: ['HCAD public data exports', 'Tax Code 22.27'],
    keywords: [
      'public data',
      'appraisal roll',
      'county file',
      'market data',
      'accounts',
      'owners',
      'what data do we have',
      'coverage',
    ],
    body: `The market side of this product reads county-published appraisal roll extracts, not district internals. For a Texas district that generally means, per account per year: the account number, the owner name and mailing address, the situs address, a state class code, the assessed value, whether an exemption applies, and — in the districts that publish it — a code recording whether the account rendered and whether it rendered late.

What it does not contain is the rendition itself. Tax Code 22.27 keeps the contents confidential, so there is no asset detail, no cost, no schedule, no acquisition year anywhere in the public files. Anything about what an account actually reported is an inference from the value and the rendition code, not a reading of the return.

Coverage is uneven by design of the publishers, not of this product. Texas districts vary in whether they publish a rendition flag at all; other states differ more sharply — Florida publishes no filing field, Virginia treats the accounts as confidential by statute, Maryland assesses centrally. A question about an account in a county with nothing loaded has no answer here, and saying so is the correct answer.

Estimated tax and penalty figures on the market screens are modelled from a jurisdiction tax rate, not read from a bill. They are for ranking and sizing, not for quoting to a client.`,
    related: ['confidentiality-22-27', 'product-two-wings'],
  },
  {
    id: 'product-two-wings',
    title: 'The Workspace and the Market are two different questions',
    topics: ['product', 'county-data'],
    authority: [],
    keywords: [
      'workspace',
      'market',
      'navigation',
      'where do I find',
      'scope',
      'county selector',
      'which screen',
    ],
    body: `Tangible has two wings and they are scoped differently.

The Workspace is client engagements: clients, sites, registers, classifications, findings, renditions, filings, notices, protests, corrections, and the season board across all of them. It is scoped by client and tax year. The county selectors at the top of the screen do not apply to it — a client engagement's numbers do not change when you change the county selector, and showing the selectors over a client page would imply they do.

The Market is the public appraisal roll analysis: the overview, the account list, the owner rollup, and the data-source catalogue. It is scoped by state, county, and year, which is what those selectors set.

Numbers do not cross between the wings by accident. A client's assessed value on the public roll comes from the Market data and is labelled as the district's figure; the corrected position on a savings report comes from the client's own register. Comparing them is useful; treating them as the same quantity is not.`,
    related: ['county-data-what-the-roll-holds', 'product-findings-and-dispositions'],
  },
  {
    id: 'product-findings-and-dispositions',
    title: 'What a finding is, and what accepting one does',
    topics: ['product'],
    authority: [],
    keywords: [
      'finding',
      'disposition',
      'accepted',
      'rejected',
      'savings',
      'leakage',
      'screening question',
      'committed set',
    ],
    body: `A finding is a claim about a client's register that the analysis can support with evidence: cost that appears to be real property, assets that look disposed, duplicated lines, a category that appears wrong.

Some findings carry a dollar figure — the cost that would come off. Others are screening questions with no figure attached, because the answer depends on something the record does not hold. A screening question is never priced; what it carries instead is what would settle it.

Findings are committed into sets, and a disposition — accepted or rejected, with a reason — outlives the set it was made against. Re-running the analysis does not erase the decisions already made.

Accepting a finding does not always change the form, and that is not an oversight. Ghost assets and non-taxable property are already off the rendition: the register marks one disposed and the classification puts the other out of scope, both before anybody decided anything. What a decision adds there is a cross-check — a finding rejected against property the form is still dropping means the decision log and the register disagree, and one of them is wrong.

Freeport is the exception worth stating: accepting a Freeport finding does not take inventory off the rendition. The inventory stays and the exemption is applied for separately.`,
    related: ['classification-what-is-not-bpp', 'exemptions-freeport-and-allocation'],
  },
  {
    id: 'product-ready-and-blockers',
    title: 'What "ready" means on the returns board',
    topics: ['product'],
    authority: [],
    keywords: [
      'ready',
      'blocked',
      'blocker',
      'cannot file',
      'why is this not ready',
      'returns board',
      'season',
    ],
    body: `A return on the season board is ready when the record gate would accept it — the same check that runs when a filing is recorded, not a second, looser definition kept for display. Three definitions of ready that agree today would not agree in a month.

A blocker is a specific, named reason the gate refuses: property placed at no site, an asset with no acquisition year so nothing can be valued, a missing signer capacity, no effective agent appointment for the site, a filing profile with a required field unset. Blockers are printed rather than hidden, including on exports, because a workbook that silently omits the blocked returns reads as though everything is fine.

Site-level, not client-level. One client can have a ready return at one location and a blocked one at another; the board counts sites, not drafts.

A filed return stays on the board after it is filed rather than disappearing, because the season's work continues past the filing — the notice, the window, the ending.`,
    related: ['rendition-one-form-per-location', 'product-two-wings'],
  },
];
