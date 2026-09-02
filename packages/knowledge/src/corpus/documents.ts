import type { KnowledgeArticle } from '../types.js';

/**
 * What arrives in the mail, and what this product does with it.
 *
 * A client sends whatever the accountant had to hand: a depreciation report,
 * a scan of last year's form, a photograph of a notice, a trial balance. The
 * assistant gets asked which of those Tangible can read, and what it will and
 * will not do with the ones it can. These articles answer that from the code's
 * own rules rather than from optimism, and they carry no authority for the same
 * reason the `product` articles do not: the source is this repository.
 *
 * They are untagged. Which spreadsheet dialect a register arrived in is not a
 * question either state has a view on.
 */
export const DOCUMENT_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'documents-what-tangible-reads',
    title: 'Which documents Tangible reads, and which it turns away',
    topics: ['product', 'method'],
    authority: [],
    keywords: [
      'upload',
      'what can I upload',
      'file types',
      'supported files',
      'spreadsheet',
      'pdf',
      'scan',
      'photo',
      'trial balance',
      'general ledger',
      'GL export',
      'rollforward',
      'depreciation report',
      'depreciation schedule',
      'invoice',
      'tax bill',
      'ARB order',
      'intake',
      'triage',
      'other',
    ],
    body: `Tangible reads four kinds of document, each through its own door, and it names the ones it does not read rather than accepting them and doing nothing.

A fixed asset register arrives as a spreadsheet or delimited text: .xlsx, .xls, .xlsm, .csv or .tsv. The file is stored before it is parsed, so a workbook the reader cannot open is still kept and shown as failed rather than lost. The register is the only document that creates assets.

A prior rendition, a Florida return, or a notice of appraised value arrives as a PDF or an image, .png, .jpg or .jpeg, including a photograph of the page. A rendition is read as lines, not assets, because that is how the form is filed: Schedule E by type and year, the others as totals. The printed totals are read separately from the lines and the two are footed against each other, and a form that does not foot is kept and flagged, since a filer's own arithmetic error is a finding rather than a reason to discard the page. A notice is matched to a site by account number, with no model in the loop, and where the number is unreadable or matches two sites the draft says so instead of guessing.

A supplier invoice arrives as a PDF or image through the invoices screen, and is read line by line so that freight, installation, training and sales tax can each be treated as what they are. Subtotals and balances due are never captured as lines.

An evidence export, a maintenance system, device inventory, insurance schedule of values, lease subledger or barcode count, arrives as a spreadsheet or delimited text through the evidence screen, and can corroborate or contradict an asset but never create one.

The intake drop takes up to twenty files at once and sorts them into register, rendition, notice, or other, trusting what the document says about itself over what its filename says. Other is the honest list of what is not handled: trial balances, general ledger exports, depreciation rollforwards, policy memos, photographs of equipment, and correspondence are recognised by name and routed nowhere. Dismissing one is recorded rather than deleted, so a later question about why no return is on file for a year has an answer. Tax bills, appraisal review board orders and collector account statements are not read at all; their dates and amounts are entered by hand on the resolution and billing screens. An invoice dropped into intake is also other, because the invoice pipeline has its own door and needs to know which asset the purchase became.`,
    related: [
      'documents-reading-a-register',
      'documents-evidence-exports',
      'product-two-wings',
      'method-register-limits',
    ],
  },
  {
    id: 'documents-reading-a-register',
    title: 'How a register is read: the columns, the dates, and the words that mean gone',
    topics: ['product', 'method', 'classification'],
    authority: [],
    keywords: [
      'column mapping',
      'map the columns',
      'header row',
      'net book value',
      'NBV',
      'original cost',
      'historical cost',
      'cost column',
      'accumulated depreciation',
      'acquisition date',
      'in service date',
      'placed in service',
      'fiscal year',
      'excel date',
      'serial number',
      'disposal',
      'disposed',
      'status column',
      'sold',
      'retired',
      'scrapped',
      'negative',
      'credit',
      'subtotal',
      'total row',
      'band',
      'category heading',
      'sage',
      'netsuite',
      'xero',
      'prosystem',
      'encoding',
    ],
    body: `A register is a depreciation report, and reading it as a list of taxable property means undoing the choices a depreciation report makes. The rules below are the ones the reader applies, and each exists because a file broke the naive version.

The header row is found, not assumed: the first row with several filled cells, none of which looks like a number. A row carrying a cost or a date is data however many words sit beside it. The words in the header are what is remembered between uploads, not the column positions, because positions move between exports of the same report and the words stay put; and two columns both headed Cost teach nothing, so that file is not learned from.

Cost is historical cost when new. Net book value, market value and any basis after write-downs are mapped to their own fields and never into cost, and a register that carries only net book value is held for a person rather than filed, because filing net book value as cost is the error a mapping confirmed by nobody would make. Accumulated depreciation is kept beside cost so that a fully depreciated line is recognised as still on the books.

Age can come from an acquisition date, an acquisition year, or an in-service date, in that order of preference, and any of the three lets the asset be valued. A year written as FY20 is a year; whether the client's fiscal years are calendar years is a question that goes to the client. A bare Excel serial number is refused as a date because it is indistinguishable from a cost, and a value like Mar-20 is refused because it is either March 2020 or the twentieth of March in an unstated year. An unreadable date becomes a visible gap, never a guess.

Money is read with its sign. Parentheses and a trailing minus both mean negative, since several ERPs write the sign after the number, and a negative line is flagged as a possible credit or adjustment rather than netted silently against its neighbours. A single comma with three digits after it reads as thousands.

Gone means one of two things: a disposal date, or a status column whose text says disposed, sold, retired, scrapped, traded in, transferred out or written off. Absence from a later export is neither, and is never recorded as a disposal. Where the register keeps disposals in a notes column in prose, the mapping asks.

Rows that are not assets are set aside by shape: subtotal and total lines, repeated page headers in a print-to-file report, and category bands that name every row beneath them. A band is only believed when a subtotal later closes it, because a heading and an asset with no cost look identical in the cell. Descriptions that end in a comma or an and are read as wrapped, not as headings.

Encoding is decided before any of this. A file whose accented characters have become replacement marks parses, foots and maps perfectly, and every proper noun in it is wrong, so the byte order mark and then the bytes themselves are checked first. The dialects this has been rehearsed on are Xero, NetSuite, Sage Fixed Assets and Sage 50, CCH ProSystem fx, a green-screen print-to-file, a hand-kept workbook with one tab per location, and two files that were not registers at all: a fleet valuation at net book value only, and a pivot table sent in place of the detail.`,
    related: ['documents-what-tangible-reads', 'method-register-limits', 'method-ghost-assets'],
  },
  {
    id: 'documents-evidence-exports',
    title: 'Evidence exports: what a maintenance log, a device inventory or an insurance schedule proves',
    topics: ['product', 'method'],
    authority: [],
    keywords: [
      'evidence',
      'corroborate',
      'proof',
      'prove it exists',
      'prove it is gone',
      'maintenance',
      'CMMS',
      'work order',
      'Maximo',
      'ServiceNow',
      'Jamf',
      'Intune',
      'device inventory',
      'ITAM',
      'insurance',
      'schedule of values',
      'SOV',
      'lease schedule',
      'ASC 842',
      'physical count',
      'barcode',
      'RFID',
      'real property record',
      'match',
      'serial number',
      'asset tag',
    ],
    body: `A register says what the accountant booked. An evidence export says what some other system saw, and the value of it is that nobody in the finance department wrote it. Six kinds are read, and for each the useful question is what a hit proves and what a silence proves, because those are different.

A maintenance system export, from Maximo, Fiix, UpKeep or SAP PM, proves a work order was raised against the asset. Its silence is the stronger signal: machinery that is running gets serviced, and machinery that is gone stops appearing in the maintenance record long before it comes off the register.

A device management export, from ServiceNow, Jamf, Intune or Lansweeper, proves a laptop or server checked in on a date. For computers this is the strongest negative evidence available anywhere, because the check-in is automatic and nobody has to remember to do it.

An insurance schedule of values proves the asset was listed for cover. Its silence proves nothing at all: a schedule is built to a materiality threshold and often lists locations rather than items, so an asset missing from it is merely an asset below the line. This is the one source whose absence is never held against the register.

A lease subledger, the ASC 842 or IFRS 16 schedule, proves the asset is a right-of-use asset the client does not own. Its silence is what stops a leased-asset finding before it reaches a client.

The county's real property record proves an improvement is already assessed as real property, which is the whole of the leasehold double-tax argument, and covers leasehold improvements only.

A physical count, a barcode or RFID scan file, proves that somebody stood in front of the asset on a named date and scanned its tag. Nothing else in the product is evidence of that kind. Leasehold improvements are out of its scope because they are not tagged.

Matching runs in a fixed order and a weaker match never overrides a stronger one: asset tag, then serial number, then model together with cost, then description alone. A description match is a reason to look and never a reason to file. The kind of export is declared by the person uploading it, not sniffed from the columns, because the same list of serial numbers proves an asset exists if it came from a device manager and proves the client does not own it if it came from a lease schedule. An export with no identifier column and no description is refused at the door, since a wrong evidence mapping manufactures a negative statement about a client's property.`,
    related: [
      'documents-what-tangible-reads',
      'method-suspected-retired',
      'method-ghost-assets',
      'method-confidence-tiers',
    ],
  },
];
