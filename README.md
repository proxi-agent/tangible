# Tangible

Public appraisal-roll analysis for Texas business personal property (BPP).

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

Loaded today — **2.28M account-years across four counties**:

| County | CAD | Years | Account-years | Acquisition | Filing status |
|---|---|---|---|---|---|
| Harris | HCAD | 2021–2026 | 1,130,423 | Automatic | Full, including late renditions |
| Dallas | DCAD | 2022–2026 | 510,589 | Automatic | Filed / did not file; no late flag |
| Tarrant | TAD | 2021–2026 | 420,519 | Manual download (2 files/yr) | **None published** |
| Collin | CCAD | 2020–2025 | 213,656 | Automatic (state portal) | **None published** |

**Half the counties do not publish the field this product is built on.** Neither
Tarrant nor Collin records rendition status at all. Their non-filer segments are
empty *by design* rather than zero, and their filing rate reads as unknown
rather than 0% — a two-valued boolean would have declared every business in both
counties a chronic non-filer and invented tens of millions in exposure. They
still contribute market size, value trends and frozen-value signal.

Each connector declares its gaps as `dataNotes`, which the UI shows on every
page for that jurisdiction.

Measurable non-filer exposure is therefore Harris and Dallas only: **12,891
non-filers, $29.8M/yr in penalties, 2,965 core ICP accounts.** Tarrant adds
$41.9B of taxable BPP value to the market picture — it is absent from the
Comptroller's 2024 study, so that figure is not in the ranking below.

### The constraint is data, not engineering

Ten counties' portals have been checked. **Only Harris and Dallas publish
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
| `pnpm ingest --jurisdiction <id> --years <list>` | Pull a real county roll |
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

Upload the directory to any host that serves plain HTTP GETs with `Range`
support and preserves paths — Supabase Storage, S3, R2. (Vercel Blob works only
with `addRandomSuffix: false`; random suffixes break the manifest's paths.)

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

Set `PARQUET_CACHE=off` to disable it, `PARQUET_CACHE_MAX_MB` to change the
400 MB budget (Vercel gives each function 512 MB of temp space).

`maxDuration` is set to 60s in `apps/web/vercel.json`.

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
