/**
 * Pull public rolls into the warehouse.
 *
 *   pnpm ingest --jurisdiction tx-harris --years 2021,2022,2023,2024,2025,2026
 *   pnpm ingest --jurisdiction tx-harris --years 2026 --force
 *   pnpm ingest --state fl --years 2026
 *   pnpm ingest --all
 *
 * `--jurisdiction` also takes a comma-separated list. `--state` and `--all`
 * select in bulk and run sequentially, which is not a throughput choice: DuckDB
 * takes a single writer, and county portals are not infrastructure worth
 * hammering in parallel.
 *
 * When the connector's URL patterns all miss (portals reorganize), copy the real
 * link off the download page and pass it directly:
 *
 *   pnpm ingest --jurisdiction tx-harris --years 2026 \
 *     --url 2026=https://download.hcad.org/data/CAMA/2026/Personal_advanced.zip
 *
 * `--url` pins a specific file, so it only makes sense for a single
 * jurisdiction and is rejected alongside a bulk selector.
 */
import { resolve } from 'node:path';
import { migrate, Warehouse } from '@tangible/analytics';
import {
  consoleLogger,
  getConnectorForJurisdiction,
  listConnectors,
  runIngest,
  type Connector,
  type IngestResult,
} from '@tangible/ingest';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';

interface Args {
  jurisdictions: string[];
  state: string;
  all: boolean;
  years: number[];
  force: boolean;
  urls: Record<number, string[]>;
}

/**
 * A path typed at the shell means "relative to where I am", but pnpm runs this
 * script from `apps/api`. `INIT_CWD` is the directory the command was actually
 * invoked from, which is the only sensible anchor for a hand-typed path.
 */
function resolveSourceRef(ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return ref;
  return resolve(process.env.INIT_CWD ?? process.cwd(), ref);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    jurisdictions: [],
    state: '',
    all: false,
    years: [],
    force: false,
    urls: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--jurisdiction':
      case '-j':
        args.jurisdictions = (argv[++i] ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        break;
      case '--state':
      case '-s':
        args.state = (argv[++i] ?? '').trim().toUpperCase();
        break;
      case '--all':
        args.all = true;
        break;
      case '--years':
      case '-y':
        args.years = (argv[++i] ?? '')
          .split(',')
          .map((y) => Number(y.trim()))
          .filter((y) => Number.isInteger(y));
        break;
      case '--force':
      case '-f':
        args.force = true;
        break;
      case '--url': {
        const [year, ...rest] = (argv[++i] ?? '').split('=');
        if (year && rest.length) {
          // Repeating --url for the same year accumulates: an account roll and
          // its companion files often ship as separate archives.
          (args.urls[Number(year)] ??= []).push(resolveSourceRef(rest.join('=')));
        }
        break;
      }
    }
  }

  return args;
}

function usage(): never {
  console.error('Usage: pnpm ingest --jurisdiction <id[,id...]> --years 2024,2025,2026 [--force]');
  console.error('       pnpm ingest --state <tx|fl> [--years ...]');
  console.error('       pnpm ingest --all [--years ...]');
  console.error('\nAvailable jurisdictions:');
  for (const c of listConnectors()) {
    console.error(
      `  ${c.jurisdiction.id.padEnd(16)} ${c.jurisdiction.name} (${c.jurisdiction.cadCode})`,
    );
  }
  process.exit(1);
}

/** Resolve the selectors into the connectors to run, in registry order. */
function selectConnectors(args: Args): Connector[] {
  if (args.all) return [...listConnectors()];

  if (args.state) {
    const matched = listConnectors().filter((c) => c.jurisdiction.state === args.state);
    if (matched.length === 0) {
      const known = [...new Set(listConnectors().map((c) => c.jurisdiction.state))].sort();
      console.error(`No jurisdictions in '${args.state}'. Known states: ${known.join(', ')}`);
      process.exit(1);
    }
    return matched;
  }

  const selected: Connector[] = [];
  for (const id of args.jurisdictions) {
    const connector = getConnectorForJurisdiction(id);
    if (!connector) {
      console.error(`No connector registered for '${id}'.`);
      process.exit(1);
    }
    selected.push(connector);
  }
  return selected;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const selectors = [args.all, Boolean(args.state), args.jurisdictions.length > 0].filter(Boolean);
  if (selectors.length === 0) usage();
  if (selectors.length > 1) {
    console.error('Pick one of --all, --state or --jurisdiction, not several.');
    process.exit(1);
  }

  const connectors = selectConnectors(args);

  // A pinned URL names one specific file, so it cannot mean anything spread
  // across a batch — every jurisdiction would try to load the same archive.
  if (Object.keys(args.urls).length > 0 && connectors.length > 1) {
    console.error(
      '--url pins a single file, so it cannot be combined with a multi-jurisdiction run.',
    );
    process.exit(1);
  }

  const years = args.years.length ? args.years : [2021, 2022, 2023, 2024, 2025, 2026];

  const warehouse = new Warehouse({
    path: env.DUCKDB_PATH,
    memoryLimit: env.DUCKDB_MEMORY_LIMIT,
    threads: env.DUCKDB_THREADS,
  });
  await migrate(warehouse);

  const results: { connector: Connector; result?: IngestResult; error?: Error }[] = [];

  for (const [index, connector] of connectors.entries()) {
    if (connectors.length > 1) {
      console.log(
        `\n[${index + 1}/${connectors.length}] ${connector.jurisdiction.name} (${connector.jurisdiction.id})`,
      );
    }
    try {
      const result = await runIngest({
        warehouse,
        connector,
        taxYears: years,
        dataDir: env.DATA_DIR,
        force: args.force,
        logger: consoleLogger,
        urlOverrides: args.urls,
      });
      results.push({ connector, result });
    } catch (error) {
      // One county's portal being down is not a reason to abandon the other 70.
      // The failure is recorded and reported at the end rather than thrown.
      consoleLogger.error(`${connector.jurisdiction.id}: ${(error as Error).message}`);
      results.push({ connector, error: error as Error });
    }
  }

  await warehouse.close();

  report(results, connectors.length > 1);

  // With one jurisdiction, loading nothing is a failure — the operator asked for
  // that county and did not get it. Across a batch it is routine: most counties
  // are already loaded, and a run that reloads nothing is a successful no-op.
  // A batch fails only when every jurisdiction in it failed outright.
  const errored = results.filter((r) => r.error).length;
  if (connectors.length === 1) {
    const only = results[0];
    // Units count as work. A warehouse whose accounts predate the unit table
    // loads nothing but units on its next run, and that run succeeded.
    const loaded = only?.result?.years.some(
      (y) => (!y.skipped && y.rowsLoaded > 0) || (y.unitRowsLoaded ?? 0) > 0,
    );
    if (!loaded) process.exit(1);
  } else if (errored === results.length) {
    process.exit(1);
  }
}

function report(
  results: { connector: Connector; result?: IngestResult; error?: Error }[],
  batch: boolean,
): void {
  if (!batch) {
    const only = results[0];
    console.log('\nSummary');
    if (only?.error) {
      console.log(`  failed: ${only.error.message}`);
      return;
    }
    for (const year of only?.result?.years ?? []) {
      const status = year.skipped
        ? `skipped (${year.reason ?? 'unknown'})`
        : `${year.rowsLoaded.toLocaleString()} rows`;
      const units = year.unitRowsLoaded
        ? ` + ${year.unitRowsLoaded.toLocaleString()} taxing-unit rows`
        : '';
      console.log(`  ${year.taxYear}  ${status}${units}`);
    }
    console.log(`  total: ${(only?.result?.totalRows ?? 0).toLocaleString()} account-years`);
    return;
  }

  // `runIngest` reports the rows already in the warehouse for a year it
  // skipped, so a non-zero total does *not* mean anything was downloaded. What
  // separates the two is whether any year came back unskipped — without that
  // check a re-run of 67 already-current counties reports "67 loaded", which
  // reads as 67 fresh downloads.
  const ingested = (r: { result?: IngestResult }) =>
    r.result?.years.some(
      (y) => (!y.skipped && y.rowsLoaded > 0) || (y.unitRowsLoaded ?? 0) > 0,
    ) ?? false;

  const failed = results.filter((r) => r.error);
  const fresh = results.filter((r) => !r.error && ingested(r));
  const current = results.filter((r) => !r.error && !ingested(r) && (r.result?.totalRows ?? 0) > 0);
  const empty = results.filter((r) => !r.error && !ingested(r) && (r.result?.totalRows ?? 0) === 0);

  console.log(`\nSummary — ${results.length} jurisdictions`);

  // Only the jurisdictions that actually ingested get a line. A 71-county run
  // is mostly no-ops on a re-run, and listing all of them buries the few that
  // moved — but failures always print, however many there are.
  for (const r of fresh) {
    const rows = (r.result?.years ?? [])
      .filter((y) => !y.skipped)
      .reduce((sum, y) => sum + y.rowsLoaded, 0);
    console.log(
      `  ${r.connector.jurisdiction.id.padEnd(18)} ${rows.toLocaleString().padStart(11)} account-years ingested`,
    );
  }
  if (failed.length > 0) {
    console.log(`\n  ${failed.length} failed:`);
    for (const r of failed) {
      console.log(`    ${r.connector.jurisdiction.id.padEnd(18)} ${r.error?.message}`);
    }
  }

  const parts = [
    `${fresh.length} ingested`,
    `${current.length} already current`,
    `${empty.length} nothing published`,
    `${failed.length} failed`,
  ];
  const total = results.reduce((sum, r) => sum + (r.result?.totalRows ?? 0), 0);
  console.log(`\n  ${parts.join(', ')}`);
  console.log(`  ${total.toLocaleString()} account-years in the warehouse for this selection`);
}

void main().catch(reportAndExit);
