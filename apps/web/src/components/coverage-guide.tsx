'use client';

import { BookOpen, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { cn } from '@/lib/cn';

/**
 * What each state actually publishes, and how to get it.
 *
 * This is reference material rather than a view of the warehouse: it is the
 * difference between "this county is empty" and "this state does not publish
 * the thing that would fill it", which is a question the dashboard itself
 * cannot answer. It lives behind a button because a reader needs it once, when
 * they first wonder why Virginia is not in the county list, and never again.
 */

type Availability = 'loaded' | 'partial' | 'closed';

interface StateGuide {
  code: string;
  name: string;
  availability: Availability;
  /** One line: what you can get, in the plainest terms. */
  headline: string;
  /** Who publishes it and in what shape. */
  source: { label: string; url: string | null; detail: string };
  /** Fields the roll carries that matter to this analysis. */
  has: string[];
  /** What is missing, and what that costs the analysis. */
  lacks: string[];
  /** Concrete, ordered actions. */
  steps: { title: string; detail: string }[];
}

const AVAILABILITY: Record<Availability, { label: string; tone: 'good' | 'warning' | 'critical' }> =
  {
    loaded: { label: 'Account-level data, wired up', tone: 'good' },
    partial: { label: 'Aggregate only — needs a records request', tone: 'warning' },
    closed: { label: 'Account detail is confidential by statute', tone: 'critical' },
  };

const GUIDES: StateGuide[] = [
  {
    code: 'TX',
    name: 'Texas',
    availability: 'loaded',
    headline:
      'Four county appraisal districts, each publishing its own file, and the only state here that says who failed to render.',
    source: {
      label: 'County appraisal districts (HCAD, DCAD, TAD, CCAD)',
      url: 'https://data.texas.gov',
      detail:
        'Every district publishes independently, so every district has its own layout, its own column order and its own idea of what a filing code means. That is why Texas is four connectors rather than one.',
    },
    has: [
      'Rendition status per account — Harris records whether a return was filed and whether it was late, Dallas records filed / did not file',
      'State class codes (L1, L2, J-series) for slicing by property type',
      'Six years of history, 2020–2025, and 2026 where the district has posted it',
      'Total-exemption flags, so exempt hospitals and charities can be taken out of the base',
    ],
    lacks: [
      'Tarrant and Collin publish no rendition field at all, so their non-filer segments are empty rather than zero — only two of the four Texas counties carry the field this product is built on',
      'Rendition penalty amounts are not in the public files; penalty exposure is modelled from the statutory rate',
    ],
    steps: [
      {
        title: 'Pick the county and press Download data',
        detail:
          'Data sources → Download data. The connector knows each district’s URL patterns and file layout; nothing needs to be typed.',
      },
      {
        title: 'If a district has reorganized its portal, pass the link directly',
        detail:
          'Copy the real link off the download page and run: pnpm ingest --jurisdiction tx-harris --years 2026 --url 2026=<link>',
      },
    ],
  },
  {
    code: 'FL',
    name: 'Florida',
    availability: 'loaded',
    headline:
      'All 67 counties on one statewide schema. No filing-status field exists — but in ten counties the penalty rate stands in for one, and survives testing.',
    source: {
      label: 'Department of Revenue, Property Tax Oversight — NAP roll',
      url: 'https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx',
      detail:
        'Every property appraiser submits their tangible personal property roll to the DOR, which reformats all 67 onto a single 36-field CSV — the "Name – Address – Property" file — and republishes it. One layout covers the state, which is why Florida arrived as 67 counties at once rather than four.',
    },
    has: [
      'Account ID, owner name and mailing address, and the physical location of the property',
      'NAICS code on essentially every account — the way to slice Florida by industry',
      'Just, assessed and taxable value, plus exemption codes and amounts per account',
      'Exemption detail good enough to separate genuinely exempt bodies from small businesses under the $25,000 threshold',
      'A usable non-filer signal in ten counties — Palm Beach, Manatee, Escambia, Lee, Lake, Pasco, Charlotte, Sumter, Putnam and Citrus — covering 58,368 taxable accounts and 11,088 apparent non-filers. It is inferred from the 25% s.193.072 failure-to-file penalty rate, and those ten were chosen by testing rather than by reputation: each has at least 100 accounts at that rate and shows the rate declining as accounts get larger, which is what a real non-filer population looks like and what the rejected Williamson proxy in Texas did not.',
    ],
    lacks: [
      'No filing-status field in the schema. Florida assesses non-filers by estimate and does not record in this file that it did.',
      'PEN_RATE, the penalty column the signal above is built on, is populated at each appraiser’s discretion — 20 of the 67 counties report a penalty rate of zero on every single account, and Polk reports 45.8% of its roll penalised while placing exactly 2 accounts at the failure-to-file rate. It is read as compliance only in the ten counties that pass the test, and the resulting rates are never comparable between counties.',
      'Even where it is read, the rate cannot separate a business that never filed from one that filed five or more months late — late filing accrues 5% a month to the same 25% ceiling. Both are non-compliant; they are not the same population.',
      'It says nothing about accounts below the $25,000 exemption. The penalty is a share of tax levied, so an account owing nothing is penalised nothing either way; those are left unknown rather than counted as compliant.',
      'Only the current roll is posted. Everything back to 2002 exists but is released by request, so a Florida county shows one year and no trend until the back years are fetched.',
      'No Texas-style state class code, so class-based segments are blank; use NAICS instead.',
      'Millage is not in the file. Tax-at-risk figures use a statewide 19-mill approximation, not the county’s real rate.',
    ],
    steps: [
      {
        title: 'Pick a Florida county and press Download data',
        detail:
          'The connector lists the DOR’s folder for the current roll and matches your county by its DOR number, which is the only part of the published file name the department is consistent about.',
      },
      {
        title: 'Request the back years to get a trend',
        detail:
          'Email PTOTechnology@floridarevenue.com naming the years, the counties, and "final NAP". Files under 10MB come back by email, larger ones as a temporary download link. This is the single highest-value follow-up for Florida — one year cannot distinguish a chronic non-filer from someone who missed once.',
      },
      {
        title: 'Load what they send you',
        detail:
          'pnpm ingest --jurisdiction fl-duval --years 2024 --url 2024=<path-to-zip>. A local path works as well as a URL. Some counties save you the request entirely — Pasco republishes its own final rolls back to 2020 at ftp01.pascopa.com/historic/tangible/, in the same format, free.',
      },
      {
        title: 'Check the county’s own portal before trusting the state file',
        detail:
          'The DOR submission is not always faithful. Duval’s own tangible file records 3,879 accounts at the 25% failure-to-file rate; the state copy of the same roll renders nearly 2,000 of them as 15% and the rest as zero, which is why Duval is not in the ten above. Its file is free at jacksonville.gov, monthly, and would need its own connector.',
      },
    ],
  },
  {
    code: 'GA',
    name: 'Georgia',
    availability: 'partial',
    headline:
      'The state publishes county totals, not accounts. Account-level personal property exists only county by county, mostly on request.',
    source: {
      label: 'Georgia DOR tax digest consolidation sheets',
      url: 'https://georgiadata.org/depofrevdata',
      detail:
        'Annual digest files from 1990 to 2024 as Excel workbooks, giving parcel counts and assessed value by property class per taxing jurisdiction. It is genuine, long-running data — but it is county totals, so it sizes a market and cannot name a single taxpayer.',
    },
    has: [
      'Thirty-five years of consistent county-level assessed value and parcel counts, which is more history than any account-level source here',
      'Enough to rank Georgia counties by personal property base and pick where to spend a records request',
    ],
    lacks: [
      'No account-level personal property roll anywhere at state level',
      'No filing or return flag published in any form',
      'Most county assessors publish through qPublic, which is searchable one parcel at a time and not downloadable in bulk',
    ],
    steps: [
      {
        title: 'Size the market from the digest first',
        detail:
          'Pull the DOR consolidation sheets and rank counties by personal property assessed value. Fulton, Gwinnett, Cobb, DeKalb and Chatham are where the base is; that ranking is what makes the next step worth the effort.',
      },
      {
        title: 'Try Gwinnett’s bulk download as the pilot',
        detail:
          'Gwinnett’s Board of Assessors publishes a quarterly ZIP of property data. Confirm whether the extract includes personal property accounts or real property only before building a connector around it.',
      },
      {
        title: 'File an Open Records Act request with the county board of assessors',
        detail:
          'Under O.C.G.A. §50-18-70, ask a named county for its personal property digest extract for the years you want, as a delimited file with a layout document. Ask for the layout explicitly — an extract without one costs more time than it saves.',
      },
    ],
  },
  {
    code: 'MD',
    name: 'Maryland',
    availability: 'partial',
    headline:
      'Assessed centrally by the state rather than by counties, so the county-shaped model this app is built on does not fit without adaptation.',
    source: {
      label: 'State Department of Assessments and Taxation (SDAT)',
      url: 'https://dat.maryland.gov/businesses/pages/business-personal-property.aspx',
      detail:
        'Businesses file one return with SDAT — Form 1 for registered entities, Form 2 for sole proprietors and partnerships — due 15 April. SDAT values the property and certifies assessments to the counties, which only set rates and bill. The taxpayer, not the parcel, is the unit.',
    },
    has: [
      'A single statewide filing regime rather than 24 county ones, which makes any dataset that does exist immediately statewide',
      'A per-entity filing obligation tied to good standing, which is conceptually much closer to a rendition flag than anything Florida or Georgia has',
    ],
    lacks: [
      'The Maryland open data portal carries real property assessments only. A search of its catalogue for personal property returns nothing relevant — there is no published business personal property extract.',
      'The $20,000 total-original-cost exemption in force since 2022 removed most small filers from valuation entirely, so any extract undercounts small businesses by design',
      'No county partition in the source data, so "county" here would have to be derived from the business address rather than read off the record',
    ],
    steps: [
      {
        title: 'Confirm whether the entity registry can stand in for a filing flag',
        detail:
          'SDAT’s business entity records carry a good-standing status that reflects whether the annual report and personal property return were filed. Before building anything on it, check on a sample of known filers whether that status separates non-filers from entities in bad standing for unrelated reasons — this is exactly the kind of proxy that looks right until it is tested.',
      },
      {
        title: 'File a Public Information Act request with SDAT',
        detail:
          'Ask for the business personal property assessment extract by assessment year, with a field layout. Name the years and ask specifically whether filing status and assessment date are included — that answer determines whether Maryland is worth a connector at all.',
      },
      {
        title: 'Decide the unit before writing code',
        detail:
          'If the extract is per-entity and statewide, Maryland does not slot into the county selector as it stands. That is a modelling decision to take deliberately rather than by mapping addresses to counties and hoping.',
      },
    ],
  },
  {
    code: 'VA',
    name: 'Virginia',
    availability: 'closed',
    headline:
      'Account-level business personal property is confidential by statute. This is a legal wall, not a missing portal.',
    source: {
      label: 'Commissioners of the Revenue, 133 counties and independent cities',
      url: 'https://law.lis.virginia.gov/vacode/title58.1/chapter0/section58.1-3/',
      detail:
        'Each locality assesses its own business tangible personal property, with its own rate, its own depreciation schedule and its own form. There is no state aggregation of account-level data, and Va. Code §58.1-3 makes local tax return information secret, with penalties for disclosure. Information whose release §58.1-3 prohibits is also exempt from FOIA.',
    },
    has: [
      'Aggregate personal property levy and revenue by locality, through the Auditor of Public Accounts',
      'Published tax rates and depreciation schedules per locality, which are enough to model exposure even without account detail',
    ],
    lacks: [
      'Any account-level roll. A FOIA request for one should be expected to be refused on §58.1-3 grounds rather than on cost or effort.',
      'Any filing or return flag',
      'Any single source covering more than one locality at account level',
    ],
    steps: [
      {
        title: 'Take the aggregate route and stop there for now',
        detail:
          'The Auditor of Public Accounts’ Comparative Report of Local Government Revenues and Expenditures covers all 133 cities and counties and is published on the Virginia Open Data Portal. It gives personal property levy by locality — enough to size Virginia, not to work it.',
      },
      {
        title: 'If you pursue account detail, ask for what is not confidential',
        detail:
          'A commissioner of the revenue may be able to release assessed totals by class or by NAICS without releasing returns. Ask for aggregates at the finest grain they will give, rather than for records §58.1-3 forbids them to hand over.',
      },
      {
        title: 'Do not budget for a Virginia connector',
        detail:
          'Unlike Georgia and Maryland, where the data exists and the obstacle is process, the obstacle here is a statute. Treat Virginia as a market-sizing exercise unless the legal position changes.',
      },
    ],
  },
];

export function CoverageGuideButton({ className }: { className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Esc and the backdrop both close a native dialog for free; the only thing
  // left to manage is the page behind it not scrolling underneath.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const sync = () => {
      document.body.style.overflow = dialog.open ? 'hidden' : '';
    };
    dialog.addEventListener('close', sync);
    return () => {
      dialog.removeEventListener('close', sync);
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <>
      <Button
        variant="secondary"
        className={className}
        onClick={() => {
          ref.current?.showModal();
          document.body.style.overflow = 'hidden';
        }}
      >
        <BookOpen size={14} />
        What each state publishes
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="coverage-guide-title"
        onClick={(e) => {
          // Clicking the backdrop lands on the dialog element itself; clicking
          // the panel lands on a child.
          if (e.target === ref.current) ref.current?.close();
        }}
        className={cn(
          'm-auto w-[min(64rem,calc(100vw-2rem))] rounded-xl border p-0',
          'border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink)]',
          'shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm',
        )}
      >
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start gap-4 border-b border-[var(--color-hairline)] px-6 py-4">
            <div className="min-w-0 flex-[1_1_0%]">
              <h2 id="coverage-guide-title" className="text-base font-semibold tracking-tight">
                Business personal property, state by state
              </h2>
              <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
                What each state publishes, what it withholds, and what it would take to get the
                rest. Whether a county is empty here is usually a fact about the state, not about
                the ingest.
              </p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]"
            >
              <X size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-[1_1_0%] space-y-5 overflow-y-auto px-6 py-5">
            {GUIDES.map((guide) => (
              <StateSection key={guide.code} guide={guide} />
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}

function StateSection({ guide }: { guide: StateGuide }) {
  const status = AVAILABILITY[guide.availability];

  return (
    <section className="rounded-lg border border-[var(--color-hairline)]">
      <header className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{guide.name}</h3>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">{guide.headline}</p>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div>
          <Label>Where it comes from</Label>
          <p className="mt-1 text-sm">
            {guide.source.url ? (
              <a
                href={guide.source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--color-series-1)] hover:underline"
              >
                {guide.source.label} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="font-medium">{guide.source.label}</span>
            )}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
            {guide.source.detail}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>What the data carries</Label>
            <List items={guide.has} marker="text-[var(--color-good)]" />
          </div>
          <div>
            <Label>What it does not</Label>
            <List items={guide.lacks} marker="text-[var(--color-warning)]" />
          </div>
        </div>

        <div>
          <Label>How to get it</Label>
          <ol className="mt-2 space-y-2.5">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="tabular mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-plane)] text-[11px] font-semibold ring-1 ring-[var(--color-hairline)]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
      {children}
    </h4>
  );
}

function List({ items, marker }: { items: string[]; marker: string }) {
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-relaxed">
          <span className={cn('mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-current', marker)} />
          <span className="text-[var(--color-ink-secondary)]">{item}</span>
        </li>
      ))}
    </ul>
  );
}
