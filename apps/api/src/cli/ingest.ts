/**
 * Pull a jurisdiction's public roll into the warehouse.
 *
 *   pnpm ingest --jurisdiction tx-harris --years 2021,2022,2023,2024,2025,2026
 *   pnpm ingest --jurisdiction tx-harris --years 2026 --force
 *
 * When the connector's URL patterns all miss (portals reorganize), copy the real
 * link off the download page and pass it directly:
 *
 *   pnpm ingest --jurisdiction tx-harris --years 2026 \
 *     --url 2026=https://download.hcad.org/data/CAMA/2026/Personal_advanced.zip
 */
import { resolve } from 'node:path';
import { migrate, Warehouse } from '@tangible/analytics';
import { consoleLogger, getConnectorForJurisdiction, listConnectors, runIngest } from '@tangible/ingest';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';

interface Args {
  jurisdiction: string;
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
  const args: Args = { jurisdiction: '', years: [], force: false, urls: {} };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--jurisdiction':
      case '-j':
        args.jurisdiction = argv[++i] ?? '';
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

async function main(): Promise<void> {
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!args.jurisdiction) {
    console.error('Usage: pnpm ingest --jurisdiction <id> --years 2024,2025,2026 [--force]');
    console.error('\nAvailable jurisdictions:');
    for (const c of listConnectors()) {
      console.error(`  ${c.jurisdiction.id.padEnd(16)} ${c.jurisdiction.name} (${c.jurisdiction.cadCode})`);
    }
    process.exit(1);
  }

  const connector = getConnectorForJurisdiction(args.jurisdiction);
  if (!connector) {
    console.error(`No connector registered for '${args.jurisdiction}'.`);
    process.exit(1);
  }

  const years = args.years.length ? args.years : [2021, 2022, 2023, 2024, 2025, 2026];

  const warehouse = new Warehouse({
    path: env.DUCKDB_PATH,
    memoryLimit: env.DUCKDB_MEMORY_LIMIT,
    threads: env.DUCKDB_THREADS,
  });
  await migrate(warehouse);

  const result = await runIngest({
    warehouse,
    connector,
    taxYears: years,
    dataDir: env.DATA_DIR,
    force: args.force,
    logger: consoleLogger,
    urlOverrides: args.urls,
  });

  console.log('\nSummary');
  for (const year of result.years) {
    const status = year.skipped ? `skipped (${year.reason ?? 'unknown'})` : `${year.rowsLoaded.toLocaleString()} rows`;
    console.log(`  ${year.taxYear}  ${status}`);
  }
  console.log(`  total: ${result.totalRows.toLocaleString()} account-years`);

  await warehouse.close();

  // A run where nothing loaded is a failure, even though each year was handled.
  const loadedAnything = result.years.some((y) => !y.skipped && y.rowsLoaded > 0);
  if (!loadedAnything) process.exit(1);
}

void main().catch(reportAndExit);
