# Tangible

Public appraisal-roll analysis for business personal property (BPP), across
Texas and Florida.

The question this repo exists to answer: **is there a business in filing
rendition paperwork for companies that never file it?** Texas Tax Code Sec.
22.28 charges 10% of the taxes due when a business fails to render, and it
recurs every year they skip. County appraisal districts publish who is on the
roll, what they are assessed at, and whether a rendition was recorded — so the
size of that problem is measurable from public records before a single customer
is contacted.

This is a feasibility instrument first and a product skeleton second. Every
number it shows carries the caveat that qualifies it.

## What it does

1. **Ingests** a county appraisal district's public personal-property roll for
   multiple tax years.
2. **Normalizes** each jurisdiction's file into one canonical account-year shape.
3. **Derives** the segments that matter — chronic non-filers, intermittent
   non-filers, late filers, frozen-value accounts, agent-represented accounts —
   and dollarizes the penalty exposure of each.
4. **Presents** it as a dashboard you can filter, drill into, and export.

## Quick start

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm seed 25000
```

```bash
pnpm dev
```

The dashboard comes up on `http://localhost:3000`, serving its own API from
`/api`. The ingest server comes up on `http://localhost:3001` — the dashboard
forwards `/api/ingest/*` to it, and needs it only to load new data.

One thing to know: DuckDB allows **one writer or many readers, never both**, and
the dashboard and the ingest server are separate processes on the same file. The
ingest server therefore opens the warehouse only while it is actually writing,
and the dashboard releases its read handle when it forwards an ingest request —
so starting a run from the Data sources page works, while `pnpm ingest` from a
second terminal will refuse until you stop the dashboard. Both paths say which
it is rather than surfacing a lock error.

The seed step generates a **synthetic** county with the same statistical shape as
a real roll — a heavy-tailed value distribution, mixed filing behavior, frozen
values, agent-represented accounts, and the 2026 exemption cliff. It is labelled
as synthetic everywhere it surfaces. It exists so the analysis is explorable
before you have downloaded anything.

### Loading a real county

```bash
pnpm ingest --jurisdiction tx-harris --years 2021,2022,2023,2024,2025,2026
```

That pulls ~1.1M account-years (about 200MB of archives) into the warehouse.
Files are cached under `data/raw/`, so a re-run reloads without re-downloading.

To load in bulk, select by state or take everything:

```bash
pnpm ingest --state fl --years 2026
```

```bash
pnpm ingest --all
```

`--jurisdiction` also accepts a comma-separated list. Bulk runs are sequential
by design — DuckDB takes a single writer, and county portals are not
infrastructure worth hammering in parallel. A county whose portal is down is
reported at the end rather than aborting the other 70, and a run where
everything was already current exits 0, so `--all` is safe on a schedule.

Stop the dev server first: it holds a read handle on the warehouse, and the
ingest needs the write lock.

Portals reorganize, so if every candidate URL misses, copy the real link off the
district's download page and pass it directly:

```bash
pnpm ingest --jurisdiction tx-harris --years 2026 --url 2026=https://download.hcad.org/data/CAMA/2026/Personal_advanced.zip
```

The HCAD column mapping is pinned against the real 2021–2026 archives. For a new
county, the loader sniffs the header row and resolves columns by alias; when it
cannot, it **stops and prints every column with sample values** plus the exact
entry to add to the connector's layout. That is deliberate — guessing which
column is "assessed value" would produce confident, wrong analysis.

## Layout

```
apps/
  api/          NestJS — ingest orchestration and CLI entry points
  web/          Next.js — the dashboard and the read API it serves
packages/
  types/        Zod schemas + TypeScript types; the contract both apps import
  analytics/    DuckDB warehouse, segment SQL, every analytical query
  ingest/       Connector framework, the HCAD connector, the synthetic fixture
  db/           Drizzle schema + Supabase clients for application state
```

### Why two databases

They hold different things and have opposite access patterns.

**DuckDB** holds the public roll — hundreds of thousands of account-years per
county, queried by full scan with heavy aggregation. It is embedded and
columnar, which is exactly that workload, and it keeps a multi-hundred-megabyte
county file from ever passing through JavaScript: files are read with
`read_csv` and normalized in SQL.

**Supabase Postgres** holds application state — ingest history, saved views,
lead lists, notes. Row-level, transactional, shared between users, and the thing
you want durable and backed up. Nothing here duplicates the warehouse.

Supabase is optional in local development. Without `DATABASE_URL` the app runs
entirely off the warehouse and simply does not persist ingest history.

DuckDB reads the roll from one of two places, decided by environment alone: the
warehouse file locally, or the published Parquet export in a deployment. See
[Deploying](#deploying).

## County coverage

Loaded today — **3.53M account-years across 71 counties in two states**:

| County | State | CAD | Years | Account-years | Acquisition | Filing status |
|---|---|---|---|---|---|---|
| Harris | TX | HCAD | 2021–2026 | 1,130,423 | Automatic | Full, including late renditions |
| Dallas | TX | DCAD | 2021–2026 | 607,277 | Automatic | Filed / did not file; no late flag |
| Tarrant | TX | TAD | 2021–2026 | 420,519 | Manual download (2 files/yr) | **None published** |
| Collin | TX | CCAD | 2020–2025 | 213,656 | Automatic (state portal) | **None published** |
| All 67 counties | FL | — | 2026 only | 1,158,330 | Automatic (state portal) | **None published** |

Texas contributes 2.37M account-years with 1.74M of them carrying a filing
status; Florida contributes 1.16M with none, worth $257.9B assessed. Florida is
complete — every county the state publishes is loaded.

Florida's twenty largest, by account count:

| County | Accounts | Assessed | County | Accounts | Assessed |
|---|---|---|---|---|---|
| Miami-Dade | 116,061 | $25.2B | Volusia | 33,041 | $5.9B |
| Broward | 89,919 | $13.4B | Duval | 30,491 | $18.8B |
| Polk | 87,967 | $9.5B | Manatee | 28,120 | $5.3B |
| Lee | 79,644 | $8.0B | Osceola | 27,977 | $4.5B |
| Orange | 62,991 | $22.0B | Sarasota | 22,383 | $4.4B |
| Palm Beach | 57,371 | $16.8B | Marion | 21,477 | $3.4B |
| Pinellas | 56,315 | $8.1B | Collier | 18,256 | $3.9B |
| Brevard | 47,347 | $12.9B | Pasco | 18,129 | $4.2B |
| Hillsborough | 42,711 | $14.4B | Escambia | 13,547 | $4.9B |
| Lake | 33,346 | $3.2B | Seminole | 13,519 | $3.8B |

Account count and value rank differently on purpose: Polk has nearly three times
Duval's accounts and half its value, while Duval carries $7B in one municipal
utility account. Ranking Florida by account count alone would put the wrong
counties at the top.

### Florida

Florida does not work like Texas. Every property appraiser submits their
tangible personal property roll to the Department of Revenue, which reformats
all 67 counties onto one 36-field CSV — the NAP file — and republishes it. One
connector therefore serves the whole state, and the county table in
`connectors/florida.ts` is the only thing that grows.

Two limits are worth knowing before reading any Florida number:

- **Only the current roll is posted.** The DOR holds NAP files back to 2002 but
  releases earlier years by public-records request, so a Florida county shows a
  single year until the back years are requested and loaded with `--url`. Some
  counties spare you the request — Pasco republishes its own final rolls back to
  2020 at `ftp01.pascopa.com/historic/tangible/`, same format, free.
- **There is no filing-status field**, and whether the nearest substitute can
  stand in for one is a per-county question. See below.

### Florida's filing signal: ten counties, by test

`PEN_RATE` carries the s.193.072 penalty percentage, and 25% is specifically the
failure-to-file penalty. Whether that can be read as compliance depends entirely
on the appraiser. Measured across all 67 rolls: **20 counties report a penalty
rate of zero on every single account**, and Polk reports 45.8% of its roll as
penalised while placing exactly **2** accounts at the 25% rate.

So it is read as compliance only where it earns it. A county qualifies if it has
at least 100 accounts at the 25% rate, and that rate **declines monotonically as
accounts get larger**, measured over accounts that actually owe tax. Ten pass:

| County | Taxable accounts | Did not file | 25% share by value band |
|---|---|---|---|
| Palm Beach | 16,750 | 3,163 | 27.0% → 9.6% → 3.9% |
| Manatee | 6,165 | 2,004 | 43.0% → 21.5% → 13.5% |
| Lee | 10,194 | 1,352 | 17.0% → 10.2% → 3.0% |
| Lake | 6,128 | 1,224 | 26.3% → 9.0% → 3.4% |
| Pasco | 5,619 | 1,207 | 28.1% → 11.2% → 6.2% |
| Escambia | 4,028 | 786 | 26.2% → 14.1% → 4.1% |
| Charlotte | 4,387 | 622 | 18.6% → 1.2% → 0.7% |
| Sumter / Putnam / Citrus | 5,097 | 730 | all declining |

**58,368 taxable account-years with a filing status, 11,088 apparent non-filers.**
The declining gradient is the whole argument — a real non-filer population thins
out at the top, and it is the same test that rejected the Williamson proxy below.

Three caveats travel with those numbers. The rate cannot separate a business that
never filed from one that filed five or more months late, since late filing
accrues 5% a month to the same 25% ceiling. The rates are never comparable
*between* counties. And accounts below the $25,000 exemption are left unknown
rather than compliant — the penalty is a share of tax levied, so an account
owing nothing is penalised nothing either way. Including them made every county
look flat and nearly caused the signal to be discarded.

**The state file is not always faithful to the county.** Duval's own tangible
roll records 3,879 accounts at the 25% rate; the DOR copy of the same roll
renders nearly 2,000 of them as 15% and the rest as zero. That is why Duval is
absent from the table above despite being one of the better-documented counties
— its own file, free and monthly at jacksonville.gov, would need its own
connector.

Florida still contributes the widest market picture here: account-level owner,
location, NAICS and value for every business account in the state, with
exemption detail good enough to separate genuinely exempt bodies from the many
small businesses sitting under the $25,000 exemption.

Statutory policy is keyed by **state and year** in `tax_policy`, because the
exemption decides which accounts count as taxable and the two states are an
order of magnitude apart — $125,000 in Texas for 2026 against $25,000 in
Florida. A state with no codified policy gets no rows rather than inheriting
another state's statute.

**Twelve of the 71 counties yield the field this product is built on**, and only
two of them publish it outright. Harris and Dallas record rendition status
directly; the ten Florida counties above have it inferred from a penalty rate
that had to pass a test first. The other 59 — Tarrant, Collin and 57 Florida
counties — say nothing.

Where it is absent, non-filer segments are empty *by design* rather than zero,
and the filing rate reads as unknown rather than 0%. A two-valued boolean would
have declared every business in 59 counties a chronic non-filer and invented
hundreds of millions in exposure. Those counties still contribute market size,
value trends and frozen-value signal.

Views that would open on a filing filter check `publishesFilingStatus` on the
jurisdiction — computed from whether the loaded rows actually carry the field,
not from what a connector claims — and fall back to a value-based view where it
is absent. That indirection is what let ten Florida counties start behaving like
Harris without a line changing in the pages themselves.

Each connector declares its gaps as `dataNotes`, which the UI shows on every
page for that jurisdiction.

Measurable non-filer exposure is therefore Harris and Dallas only: **12,891
non-filers, $29.8M/yr in penalties, 2,965 core ICP accounts.** Tarrant adds
$41.9B of taxable BPP value to the market picture — it is absent from the
Comptroller's 2024 study, so that figure is not in the ranking below.

### Beyond Texas: what the other states publish

Maryland, Florida, Virginia and Georgia were surveyed together. Only Florida is
ingestible today, and the reasons the others are not differ enough to matter —
two are process problems, one is a statute. Maryland is the one worth working:
the data exists at account level, carries a real filing flag, and simply is not
published. The same survey is in the app behind **What each state publishes**,
with the specific steps for each.

| State | Account-level BPP | Filing status | Obstacle |
|---|---|---|---|
| Florida | **Yes — all 67 counties** | No | Current roll only; back years by request |
| Georgia | No — county totals only | No | Per-county Open Records Act request |
| Maryland | Exists, layout published, not downloadable | **Yes — SDAT's estimated-assessment code** | Sent to counties for billing; needs a records request |
| Virginia | No | No | **Va. Code §58.1-3 makes it confidential**, and FOIA-exempt |

- **Georgia** publishes 35 years of county-level digest consolidations through
  the DOR — genuine, long-running data that sizes a market and cannot name a
  taxpayer. Account-level personal property exists only county by county, mostly
  through qPublic, which is searchable one parcel at a time rather than
  downloadable.
- **Maryland** turned out to be the strongest of the three on a second look. SDAT
  assesses BPP centrally and then certifies the assessments to the counties as a
  file — the MBES billing extract, a 2,000-byte fixed-width record per account
  whose [layout SDAT publishes](https://dat.maryland.gov/businesses/Pages/newppmbes.aspx).
  It carries an **Estimated Code**, `E` or blank, marking accounts valued by
  estimate because no return was filed, and Maryland assesses those at twice the
  estimated value. That is the same fact HCAD's rendition flag records, stated by
  the assessor rather than inferred from a penalty rate, and it is the only field
  of its kind found outside Texas. The record also carries county, district and
  town codes, so the county-shaped model fits after all. What is missing is a
  download: the file goes to the 17 levying jurisdictions for billing and is not
  posted, so Maryland is a records request — to SDAT, and to the large counties
  in parallel, since each holds its own copy. The good-standing proxy is dropped;
  the E flag supersedes it.
- **Virginia** is the one hard stop. Each of 133 localities assesses its own BPP
  with its own rate and schedule, there is no state aggregation, and account
  detail is secret by statute rather than merely unpublished. A FOIA request
  should be expected to be refused on those grounds. Treat Virginia as a
  market-sizing exercise via the Auditor of Public Accounts' comparative report.

### The constraint is data, not engineering

Ten Texas counties' portals have been checked. **Only Harris and Dallas publish
whether a rendition was filed.** That field is the product; without it a county
can be sized but not sold to.

| County | Access | Rendition status |
|---|---|---|
| Harris | Automatic | **Full**, including late |
| Dallas | Automatic | **Filed / did not file** |
| Tarrant | Manual download | None |
| Collin | Automatic (state open-data portal) | None |
| Williamson | Automatic (own Socrata portal) | None — all 84 datasets swept |
| Fort Bend | Automatic (direct zip) | **Penalty flag, partial coverage** |
| El Paso | Blocks automation; free file, manual | Unknown |
| Denton | Single-page portal, no static links | Unknown |
| Travis | Public information request | Unknown |
| Bexar | Sold commercially | Unknown |

Notes on the three worth revisiting:

- **Williamson** publishes through its own Socrata portal at `data.wcad.org`,
  with agent-of-record and exemption datasets that Tarrant and Collin lack. It
  has no rendition flag. A candidate proxy — `vtsgppseg_renderedtotal` — was
  tested and **rejected**; see below. Its live datasets are also current-year
  only, so multi-year analysis would need extra work regardless.
- **Fort Bend** publishes `RenditionPenaltyPct` — the district's own record that
  it charged the Sec. 22.28 penalty. That is arguably better than a filing flag,
  because it is the assessed penalty rather than an estimate. The catch is
  coverage: it appears only in the "Orion Supplement" exports, whose owner file
  has 48 columns, while the full "PropertyDataExport" owner file is redacted to
  19 and omits it. Supplements cover only accounts that changed — 2,231 owner
  rows against 425,966 in the full export — so it is ground truth on a sample,
  never the whole roll. Useful for *validating* signals; not a substitute for a
  filing flag. Data also lags: newest is a January 2025 supplement of the 2024
  roll.
- **El Paso** blocks automated requests on both its hosts. Its personal property
  file is free and `~`-delimited, so it fits the manual `--url` route.

Before writing another connector, check for a rendition field first. That check
takes minutes and decides whether a county can support the product or only
measure it.

### Validating a filing proxy

When a county lacks a rendition flag it is tempting to derive one. Williamson
offered a plausible candidate: `vtsgppseg_renderedtotal`, populated on 19.6% of
its personal-property accounts. It was tested against Harris and Dallas and it
does not hold up.

Filing rate by account value, 2026:

| Band | Harris | Dallas | Williamson proxy |
|---|---|---|---|
| < $10K | 29.5% | 27.5% | 13.8% |
| $10–50K | 28.8% | 40.3% | 19.9% |
| $50–125K | 47.4% | 53.2% | 22.4% |
| $125–500K | 68.0% | 69.8% | 26.9% |
| $500K–2M | 74.6% | 81.1% | 27.1% |
| **$2M+** | **89.9%** | **90.1%** | **21.5%** |

Harris and Dallas are independent counties with published flags, and they track
each other within a few points at every band while rising steeply with account
size. That is the signature of real filing behavior: large accounts have tax
departments and agents, and they render.

The proxy is nearly flat and, decisively, **non-monotonic — it falls at the top
band**. No filing regime has the largest accounts rendering least often. The
field is measuring an appraisal workflow step, not receipt of a rendition.

Used anyway, it would have claimed 5,036 non-filers and **$32.8M/yr** of
exposure in Williamson against a benchmark-implied ~1,670 and ~$10.9M — a **3x
overstatement, ~$21.9M/yr of phantom exposure**, concentrated in exactly the
large accounts a pitch would lead with.

The method generalizes: **compare a candidate signal's filing-rate-by-value
curve against Harris and Dallas.** They agree closely enough to serve as ground
truth for the shape, and a proxy that does not reproduce the gradient is not
measuring filing.

### Counties that need a manual download

Tarrant publishes personal property files but serves them to people rather than
scripts. **This repo does not try to get around that.** Instead the manual route
is a first-class path.

1. Open <https://www.tad.org/resources/data-downloads> and download, per year,
   both the **PropertyData** and the **PropertyDataSupplemental** personal
   property files. The main roll carries values and state class; the
   supplemental carries the tax agent, situs city and NAICS code.
2. Pass both for the same year — `--url` repeats and accumulates:

```bash
pnpm ingest --jurisdiction tx-tarrant --years 2025 --url "2025=$HOME/Downloads/PropertyData_P_2025(Certified).ZIP" --url "2025=$HOME/Downloads/PropertyDataSupplemental_P_2025(Certified).ZIP"
```

`--url` takes a plain path (absolute or relative to where you ran the command),
a `file://` URL, or an HTTP URL. So any county you can obtain a file for —
including one that arrives by email from a records request — loads through
exactly the same pipeline as an automated one.

### Companion files

Districts routinely split a roll across several files — exemptions in one, tax
agents in another. A connector declares each as a `CompanionFile`: which file,
which column holds the account number, and which canonical fields it supplies.
The loader joins them at load time and companion values win over the main file.
Harris's exemption table and Tarrant's supplemental both go through this.

A companion that is declared but missing is reported by name along with the
fields that will be unknown, rather than passing silently.

Tarrant's layout is pinned, so those files load directly. For a county nobody
has mapped yet, the first load stops and prints every column it found with
sample values, plus the mapping to paste into the connector.

Two things make a county cheap or expensive to add. Cheap: a stable public URL
and a header row. Expensive: a manual download step, a records request, or a
headerless fixed layout that has to be pinned by hand.

### Where the value is

Ranking Texas districts by L1 + L2 (commercial + industrial personal property)
appraised value, from the Comptroller's 2024 CAD Summary Worksheet:

```
Dallas $51.1B · Travis $18.6B · Bexar $17.1B · Collin $14.7B · El Paso $9.0B
Fort Bend $7.8B · Midland $7.2B · Williamson $5.4B · Jefferson $5.3B
```

The top four are half the reported base; the top fifteen are three quarters. So
a handful of connectors covers most of the market — this does not need all 254
counties.

**Caveat:** the Property Value Study rotates, so only 125 of 254 districts
appear in any given year's worksheet. Harris and Tarrant are both absent from
2024 and are not reflected in those figures.

### Adding a jurisdiction

Write a `Connector` (see `packages/ingest/src/connectors/hcad.ts` for a
headerless tab dump with a companion exemption file, or `dcad.ts` for a quoted
CSV with derived fields) and register it. Everything downstream — normalization,
segments, metrics, the dashboard — is jurisdiction-agnostic, so a new county is
a connector, not a migration.

Districts differ in what they publish, and those gaps change what a number
means. A connector declares them as `dataNotes`, which the UI shows on every
page for that jurisdiction — Dallas's missing late-filing flag is the current
example.

Two portal quirks are handled centrally because they are unlikely to be unique:
archives served with the page's HTML appended after the zip payload are trimmed
back to the real end-of-central-directory record, and files that DuckDB's
latin-1 reader rejects are read as UTF-8.

## The analysis

`packages/types/src/segments.ts` is the vocabulary; `packages/analytics/src/predicates.ts`
is the SQL for each segment. The predicate map is typed as a total record over
`SegmentKey`, so adding a segment to the shared types fails the build until its
SQL is written.

Three modeling decisions worth knowing:

- **Filing status is three-valued.** A year counts as unfiled only when the
  source explicitly says so. Years where a district publishes no filing flag are
  counted separately as unknown, so a source that omits the field produces no
  non-filer signal rather than a spurious one.
- **Penalty applies to late filings too**, not just missing ones — Sec. 22.28
  penalizes a rendition that is not *timely* filed.
- **Below-exemption accounts are excluded from exposure.** An account under the
  threshold owes no tax, so it can owe no percentage of that tax.

**Frozen value is a ranking signal, not proof.** An assessed value that never
moves has three possible causes: ghost assets, capex that exactly offsets
depreciation, or the district carrying forward its own estimate because nobody
filed anything. The tool sizes and ranks; it does not establish that any single
account is over-assessed.

Renditions themselves are confidential in Texas. Everything here comes from the
public roll and reflects only whether a district recorded a filing — never its
contents.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Both apps, watching |
| `pnpm build` | Build everything |
| `pnpm typecheck` | Typecheck every package |
| `pnpm ingest --jurisdiction <id[,id]> --years <list>` | Pull one or more county rolls |
| `pnpm ingest --state <tx\|fl>` | Pull every county in a state |
| `pnpm ingest --all` | Pull every registered jurisdiction |
| `pnpm seed [accounts]` | Regenerate the synthetic county |
| `pnpm export:parquet [dir]` | Publish the warehouse as Parquet for deployment |
| `pnpm db:push` | Push the Drizzle schema to Supabase |

## Deploying

The dashboard runs on Vercel. What cannot go with it is ingest: a county archive
is hundreds of megabytes, takes minutes to load, and ends by writing a DuckDB
file — none of which survives a read-only filesystem and a duration cap. So the
split follows the seam the system already has. Ingest writes; the dashboard
reads; only the reading half deploys.

The warehouse file is 516 MB and cannot ship in a function bundle. The same
tables as zstd Parquet are 95 MB, and DuckDB reads them over HTTP with range
requests, pulling only the row groups a query touches. Every query in
`@tangible/analytics` runs unchanged against them, because they are mounted
under the same table names.

**1. Publish the data.**

```bash
pnpm ingest --jurisdiction tx-harris --years 2021,2022,2023,2024,2025,2026
```

```bash
pnpm export:parquet
```

That writes `data/parquet/` — partitioned by jurisdiction and year, plus a
`manifest.json` naming every file. The manifest is not optional: object storage
has no directory listing, so `read_parquet` cannot glob over HTTP and the files
have to be named. The export reads itself back through the same code path the
deployment uses and fails if the counts disagree.

```bash
pnpm publish:parquet --dry-run   # names the destination, writes nothing
```

```bash
pnpm publish:parquet
```

Any host that serves plain HTTP GETs with `Range` and preserves paths will do.
**Cloudflare R2 is the one to pick**, because egress is free and this workload is
egress-shaped: every cold instance downloads the whole 95 MB export. On
Supabase's free plan the same pattern spends its 5 GB monthly allowance in about
fifty cold starts, which is a bill or a throttle rather than a design. (Vercel
Blob works only with `addRandomSuffix: false`; random suffixes break the
manifest's paths.)

Set up R2 once:

1. **dash.cloudflare.com → R2 → Create bucket**, e.g. `tangible-warehouse`.
2. On the bucket, **Settings → Public access → enable the r2.dev URL**, or
   connect a custom domain. DuckDB reads these unauthenticated, so the bucket
   must be public. That is appropriate here — it is county appraisal roll data,
   already public record — but nothing derived from a private source should ever
   be published this way. A custom domain is worth it beyond a prototype: the
   r2.dev URL is rate-limited and not meant for production traffic.
3. **R2 → API → Create API token**, Object Read & Write, scoped to the bucket.
   Put the account id, access key id and secret in `.env`, with
   `R2_PUBLIC_BASE_URL` set to the URL from step 2.

`pnpm publish:parquet` then uploads and prints the `PARQUET_BASE_URL` to set on
Vercel. Re-running skips objects already stored at the right size, so an
interrupted publish resumes.

**2. Point a Vercel project at it.**

Set the project's Root Directory to `apps/web`; Vercel detects the turborepo and
builds the workspace dependencies. Then set one environment variable:

```
PARQUET_BASE_URL=https://<host>/<prefix>
```

With it set, the app reads the export. Without it, it reads `DUCKDB_PATH`
locally. Nothing else changes between the two.

**3. Refresh by re-uploading.** New data is `pnpm ingest && pnpm export:parquet`
and an upload — no redeploy, because the function reads the manifest at startup.

Two details that are easy to get wrong and fail only at runtime: DuckDB's native
addon links a ~70 MB shared library that nothing in the JavaScript references,
so it is force-included via `outputFileTracingIncludes`; and `httpfs` installs
into a directory that is read-only on a serverless host, so the extension
directory is pointed at `/tmp`. Both are handled in `next.config.ts` and
`packages/analytics/src/remote.ts`. The traced function comes to ~115 MB against
a 250 MB limit.

### The local cache

Reading Parquet straight over HTTP works, but a page load makes on the order of
2,000 range requests and every one pays the round trip. So on first use the
function copies the export to its own temp disk and queries from there. The
difference, measured against a server with 30ms of injected latency:

| | overview | facets | owners | accounts |
|---|---|---|---|---|
| HTTP direct | 2.35s | 7.69s | 2.73s | 2.67s |
| Local cache | 1.00s | 3.30s | 1.11s | 1.11s |

That is the same speed as reading the DuckDB file off local disk, so the cost of
serving from object storage becomes one ~95 MB copy per instance rather than
latency on every query.

It is a cache, not a dependency. Too little disk, no write access, a failed
fetch — each falls back to reading over HTTP and says so in the logs. Files are
verified against the size recorded in the manifest, written to a scratch name
and renamed, so a partial download is never mistaken for a complete one. Each
export is cached under its own directory keyed on the publish timestamp, and
superseded ones are removed — a republished dataset can never be read as a mix
of old and new files.

The copy is fetched **in the background**. An instance starts serving over HTTP
immediately and re-points its views at the local files when they land, so the
95 MB never sits in front of the first visitor. The alternative — waiting — is
`PARQUET_CACHE=blocking`, and it is only the better trade where cold starts are
rare and bandwidth to the bucket is fast. Worth knowing: on a LAN-speed link
blocking wins, because the download is nearly free and the first query is then a
local read. Over a real network the download dominates, and blocking means one
unlucky visitor waits for all of it. Check `cache.durationMs` on `/api/health`
in your own deployment before changing this — that is the number that decides it,
and it cannot be measured from a laptop.

`PARQUET_CACHE=off` disables the copy entirely; `PARQUET_CACHE_MAX_MB` changes
the 400 MB budget (Vercel gives each function 512 MB of temp space).

### The series is precomputed

The export also carries `account_series` — the per-account series, already
collapsed, one partition per jurisdiction and as-of year.

This is where the time was. Profiling an overview query put **907ms of 976ms in
the series CTE and 5ms in the scan**: two window functions across every
account-year in the jurisdiction, rebuilt on every request, though nothing in it
depends on the request. Moving it into the export:

| query | rebuilt per request | precomputed |
|---|---|---|
| overview | 947ms | 104ms |
| facets | 3051ms | 10ms |
| owners | 1119ms | 27ms |
| accounts | 1065ms | 34ms |
| **total** | **6225ms** | **218ms** |

The materialized table is generated *by running the same CTE the queries would
have run*, which is what keeps the two column-for-column identical — drift would
be a silently wrong answer, not an error. An export without it still works;
`accountSeriesCte` falls back to computing, and the local warehouse always does.

Anything derived from `jurisdiction` or `tax_policy` — the blended rate, the
exemption threshold — is frozen at export time, so changing a tax rate takes
effect on the next `pnpm export:parquet` rather than the next request.

It costs 85 MB, taking the export to ~180 MB. That is paid once per instance in
the background; the queries above are paid on every request.

One thing the cache does not do is fetch selectively. Parquet is columnar, so
reading over HTTP pulls only the columns a query touches — for the segment
analysis, about 35% of `account_year`. And with the series precomputed, most
queries never open `account_year` at all; only the account detail page and the
CSV export do. Caching just `account_series` is the obvious next saving if
warm-up ever matters.

### Function limits

`maxDuration` is 60s, declared in each route file as App Router segment config:

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
```

`apps/web/vercel.json` deliberately contains only `"framework": "nextjs"`.

It does **not** use the `functions` property. Those globs match Pages Router
files and standalone `/api` directories, not App Router routes — pointed at
`src/app/api/**/*.ts` the deploy fails with *"doesn't match any Serverless
Functions inside the `api` directory"*. Segment config is the supported route,
and it lands in `.next/server/functions-config-manifest.json`, which is what
Vercel reads.

The `framework` line pins the preset, because with it left as "Other" the build
succeeds and then fails looking for a `public` directory — "Other" expects
static output, so it never looks for `.next`. Pinning it here means the setting
cannot drift in the dashboard. Note that `vercel.json` is read from the
project's Root Directory, so this file only takes effect with Root Directory set
to `apps/web` — that part is a project setting and cannot be committed.

Memory has no segment-config equivalent; set it in the project's
Settings → Functions if the default is not enough. Keep `DUCKDB_MEMORY_LIMIT`
under whatever that is — DuckDB treats it as a hard ceiling. Queries spill to
the temp directory rather than failing when they reach it, so a tight limit
costs speed instead of correctness.

To run ingest against a deployed dashboard, set `INGEST_API_URL` to a reachable
NestJS instance. Left unset, the Data page reports that ingest is local-only
rather than failing.

## Validation

Running the pipeline against the real 2021–2026 Harris County archives
reproduces the independent hand analysis of the same data:

| 2026, accounts ≥ $125K | Hand analysis | This pipeline |
|---|---|---|
| Taxable accounts | 28,544 | 28,749 |
| Did not file | 7,207 → $18.7M/yr | 7,223 → $18.77M/yr |
| Chronic (never filed, 4+ yrs) | 1,584 → $6.3M/yr | 1,587 → $6.29M/yr |
| Core ICP | 910 → $1.6M/yr | 912 → $1.58M/yr |
| Median ICP penalty | $804 | $803 |
| Large accounts with an agent | 39% | 41% |

The named examples line up too — the $78K events company, the $54K machine shop
and the $45K tree service all appear at the top of the Core ICP list.

Residual differences come from exemption screening: the pipeline excludes only
the `TOT` (total exemption) category, where the hand analysis also screened
several partial categories.

## Status

Early, but running on real data. The warehouse, segment analysis, dashboard, and
the HCAD connector are working end to end across all six tax years. Harris is
the only county wired up; the connector interface is the extension point.
