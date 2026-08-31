/**
 * Create the client role, apply sql/tenancy.sql, and print the connection
 * string the web app needs.
 *
 * Separate from the SQL file for one reason: this step invents a password, and
 * a password does not belong in a file that gets committed. Run it once per
 * environment; run it again any time tenancy.sql changes, which is safe — every
 * statement in there is idempotent.
 *
 * The policies are not in tenancy.sql and not created here — they are declared
 * in `src/policies.ts` so that `drizzle-kit push` maintains them rather than
 * dropping them. On a fresh database the order is: this script, then push, then
 * `verify-tenancy.mjs`.
 *
 *   cd packages/db && set -a && . ../../.env && set +a && node scripts/apply-tenancy.mjs
 *
 * Pass --rotate to issue a new password for an existing role.
 */
import { randomBytes } from 'node:crypto';
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

const rotate = process.argv.includes('--rotate');
const sql = postgres(url, { prepare: false, max: 1 });

try {
  const [existing] = await sql`select rolname from pg_roles where rolname = 'tangible_client'`;
  let password = null;

  if (!existing || rotate) {
    // Base64url so the value survives a URL without percent-encoding.
    password = randomBytes(24).toString('base64url');
    if (existing) {
      await sql.unsafe(`alter role tangible_client with password '${password}'`);
      console.log('Rotated the password on tangible_client.');
    } else {
      await sql.unsafe(
        `create role tangible_client with login nobypassrls nosuperuser nocreatedb nocreaterole noinherit password '${password}'`,
      );
      console.log('Created role tangible_client.');
    }
  } else {
    console.log(
      'Role tangible_client already exists; leaving its password alone (--rotate to change it).',
    );
  }

  await sql.unsafe(readFileSync(join(here, '..', 'sql', 'tenancy.sql'), 'utf8'));

  const [{ count: policies }] = await sql`
    select count(*)::int as count from pg_policies
    where schemaname = 'public' and policyname = 'client_tenancy'`;
  console.log(`Applied tenancy.sql — role, app.client_id(), grants.`);
  console.log(
    policies === 0
      ? 'No policies exist yet. They live in src/policies.ts; run `npx drizzle-kit push` to create them, then scripts/verify-tenancy.mjs.'
      : `${policies} tables carry a client_tenancy policy.`,
  );

  if (password) {
    const target = new URL(url);
    target.username = 'tangible_client';
    target.password = password;
    console.log('\nAdd this to .env and to the deployment environment:\n');
    console.log(`CLIENT_DATABASE_URL="${target.toString()}"\n`);
  }
} finally {
  await sql.end();
}
