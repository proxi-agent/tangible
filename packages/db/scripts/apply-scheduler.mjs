/**
 * Seed the vault with CRON_SECRET, then apply sql/scheduler.sql.
 *
 * Separate from the SQL file for the same reason `apply-tenancy.mjs` is: this
 * step handles a secret, and a secret does not belong in a committed file. The
 * value is read from the environment and passed as a bound parameter, so it
 * never appears in a statement anybody can read back out of `pg_stat_activity`
 * or a log.
 *
 * It must be the *same* value that is set on Vercel, because that is the one
 * the handlers compare against. `.env` and the Vercel project setting are the
 * two places it lives; this script copies whichever one you sourced.
 *
 *   cd packages/db && set -a && . ../../.env && set +a && node scripts/apply-scheduler.mjs
 *
 * Safe to re-run. The secret is updated in place rather than duplicated, every
 * statement in the SQL file is idempotent, and `cron.schedule` upserts on the
 * job name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Source .env first.');
  process.exit(1);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error(
    'CRON_SECRET is not set. It must match the value on Vercel, or every\n' +
      'scheduled call will be refused by the handler it reaches.',
  );
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

try {
  // Vault first: the SQL file creates a function that refuses to run without
  // it, and applying the schedules before the secret exists would give us
  // three jobs whose first act is to raise.
  const existing = await sql`select id from vault.secrets where name = 'cron_secret'`;
  if (existing.length === 0) {
    await sql`select vault.create_secret(
      ${secret}, 'cron_secret',
      'Bearer token for the scheduled endpoints. Must match CRON_SECRET on Vercel.'
    )`;
    console.log('vault: created cron_secret');
  } else {
    await sql`select vault.update_secret(${existing[0].id}, ${secret})`;
    console.log('vault: updated cron_secret');
  }

  await sql.unsafe(readFileSync(join(here, '..', 'sql', 'scheduler.sql'), 'utf8'));

  const jobs = await sql`
    select jobname, schedule, active from cron.job
     where jobname in ('drain-runs', 'health-probe', 'engine-digest')
     order by jobname`;
  console.log('');
  for (const job of jobs) {
    console.log(
      `  ${job.jobname.padEnd(14)} ${job.schedule.padEnd(14)} ${job.active ? 'active' : 'INACTIVE'}`,
    );
  }
  if (jobs.length !== 3) {
    console.error(`\nExpected 3 jobs, found ${jobs.length}.`);
    process.exitCode = 1;
  } else {
    console.log('\nScheduled. Watch ops.recent_runs and ops.recent_calls.');
  }
} finally {
  await sql.end();
}
