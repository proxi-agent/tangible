/**
 * Seed the synthetic demo county so the dashboard is explorable immediately.
 *
 *   pnpm --filter @tangible/api seed          # 25,000 accounts x 6 years
 *   pnpm --filter @tangible/api seed 100000   # bigger, to feel real scale
 */
import { migrate, Warehouse } from '@tangible/analytics';
import { seedFixture } from '@tangible/ingest';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const accounts = Number(process.argv[2] ?? 25_000);

  const warehouse = new Warehouse({ path: env.DUCKDB_PATH });
  await migrate(warehouse);

  console.log(`Seeding ${accounts.toLocaleString()} synthetic accounts into ${env.DUCKDB_PATH}...`);
  const rows = await seedFixture(warehouse, { accounts });
  console.log(`Done — ${rows.toLocaleString()} account-year rows in 'demo-county'.`);

  await warehouse.close();
}

void main().catch(reportAndExit);
