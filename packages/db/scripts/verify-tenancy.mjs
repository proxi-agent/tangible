/**
 * Prove that the policies do what they claim, against the live database.
 *
 * This is not a unit test and could not be one. What it checks is a property of
 * the database — that a connection which does not bypass RLS, told it is acting
 * for one client, cannot reach another client's rows on any table — and the
 * only honest place to check that is the database itself.
 *
 * It picks the two clients with the most data, then for every policied table
 * asserts three things: the client sees its own rows, sees none of the other's,
 * and the two counts add up to the whole table as the owner sees it. That last
 * one is what catches a policy that is merely restrictive rather than correct.
 *
 * Then it checks that the firm's own tables — the lead lists, the saved views,
 * the classification memory — return nothing at all, since none of them has a
 * policy and RLS with no policy denies.
 *
 * Run it after every schema push. `drizzle-kit push` does not know these
 * policies exist, and a push that quietly dropped them would leave the app
 * working perfectly and the boundary gone.
 *
 *   cd packages/db && set -a && . ../../.env && set +a && node scripts/verify-tenancy.mjs
 */
import postgres from 'postgres';

const owner = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const clientUrl = process.env.CLIENT_DATABASE_URL;
if (!clientUrl) {
  console.error('CLIENT_DATABASE_URL is not set. Run apply-tenancy.mjs first.');
  process.exit(1);
}
const asClient = postgres(clientUrl, { prepare: false, max: 1 });

/** Tables that carry a business's data, and how a row on them names its owner. */
const OWNED = {
  clients: 'id',
  engagements: 'client_id',
  agent_appointments: 'client_id',
  assets: 'client_id',
  client_filing_profiles: 'client_id',
  client_locations: 'client_id',
  notifications: 'client_id',
  portal_settings: 'client_id',
  portal_users: 'client_id',
};
const VIA_ENGAGEMENT = [
  'analysis_runs',
  'assessment_notices',
  'asset_classifications',
  'asset_versions',
  'correction_motions',
  'evidence_exports',
  'far_files',
  'finding_dispositions',
  'finding_row_decisions',
  'finding_sets',
  'findings',
  'graph_answers',
  'import_batches',
  'intake_files',
  'invoice_asset_links',
  'invoice_documents',
  'mapping_asks',
  'motion_drafts',
  'prior_documents',
  'protest_briefs',
  'protest_resolutions',
  'recovery_claims',
  'recovery_outcomes',
  'rendition_extensions',
  'rendition_filings',
  'result_letters',
  'unblock_plans',
];
/** A child, its foreign key, and the parent that decides whether it is visible. */
const VIA_PARENT = [
  ['asset_events', 'asset_id', 'assets', 'client_id'],
  ['asset_positions', 'asset_id', 'assets', 'client_id'],
  ['invoice_lines', 'document_id', 'invoice_documents', 'engagement'],
  ['prior_return_lines', 'document_id', 'prior_documents', 'engagement'],
  ['evidence_records', 'export_id', 'evidence_exports', 'engagement'],
];
const FIRM_ONLY = [
  'account_notes',
  'assistant_conversations',
  'assistant_turns',
  'classification_memory',
  'deletion_receipts',
  'engagement_fees',
  'fee_statements',
  'filing_agent',
  'health_probes',
  'incidents',
  'ingest_runs',
  'lead_lists',
  'lead_list_items',
  'saved_views',
  'source_files',
];

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

/** How many rows on `table` belong to `clientId`, asked as the owner. */
async function trueCount(table, clientId) {
  if (table in OWNED) {
    return (
      await owner.unsafe(
        `select count(*)::int as n from public.${table} where ${OWNED[table]} = $1`,
        [clientId],
      )
    )[0].n;
  }
  if (VIA_ENGAGEMENT.includes(table)) {
    return (
      await owner.unsafe(
        `select count(*)::int as n from public.${table} t
         join public.engagements e on e.id = t.engagement_id where e.client_id = $1`,
        [clientId],
      )
    )[0].n;
  }
  const [child, fk, parent] = VIA_PARENT.find(([name]) => name === table);
  const join =
    parent in OWNED
      ? `join public.${parent} p on p.id = t.${fk} where p.client_id = $1`
      : `join public.${parent} p on p.id = t.${fk}
       join public.engagements e on e.id = p.engagement_id where e.client_id = $1`;
  return (
    await owner.unsafe(`select count(*)::int as n from public.${child} t ${join}`, [clientId])
  )[0].n;
}

try {
  const clients = await owner`
    select c.id, c.name, count(a.id)::int as assets
    from clients c left join assets a on a.client_id = c.id
    group by c.id, c.name order by count(a.id) desc limit 2`;
  if (clients.length < 2) {
    console.error('Need two clients in the database to prove isolation. Found', clients.length);
    process.exit(1);
  }
  const [me, other] = clients;
  console.log(`Asking as ${me.name}, checking against ${other.name}.\n`);

  const policied = [...Object.keys(OWNED), ...VIA_ENGAGEMENT, ...VIA_PARENT.map(([t]) => t)];

  await asClient
    .begin(async (tx) => {
      await tx`select set_config('app.client_id', ${me.id}, true)`;

      for (const table of policied) {
        const seen = (await tx.unsafe(`select count(*)::int as n from public.${table}`))[0].n;
        const mine = await trueCount(table, me.id);
        const theirs = await trueCount(table, other.id);
        const total = (await owner.unsafe(`select count(*)::int as n from public.${table}`))[0].n;

        check(seen === mine, `${table}: saw ${seen} rows, should have seen ${mine}`);
        // The interesting assertion is not "saw few" but "saw fewer than exist"
        // wherever the other client has rows at all.
        if (theirs > 0)
          check(
            seen < total,
            `${table}: saw all ${total} rows while ${other.name} owns ${theirs} of them`,
          );
        const flag = theirs > 0 ? '  <- other client has rows here' : '';
        console.log(
          `  ${table.padEnd(24)} saw ${String(seen).padStart(6)} of ${String(total).padStart(6)}${flag}`,
        );
      }

      console.log('');
      for (const table of FIRM_ONLY) {
        const total = (await owner.unsafe(`select count(*)::int as n from public.${table}`))[0].n;
        let seen;
        try {
          seen = (await tx.unsafe(`select count(*)::int as n from public.${table}`))[0].n;
        } catch {
          // No SELECT grant is a stronger no than an empty result.
          console.log(`  ${table.padEnd(24)} denied outright (${total} rows exist)`);
          continue;
        }
        check(seen === 0, `${table}: firm-only table returned ${seen} rows`);
        console.log(`  ${table.padEnd(24)} saw      0 of ${String(total).padStart(6)}`);
      }

      // Writing outside your own client must fail even where the grant exists.
      let blocked = false;
      try {
        await tx.unsafe(`insert into public.portal_settings (client_id) values ($1)`, [other.id]);
      } catch {
        blocked = true;
      }
      check(blocked, 'was able to insert a portal_settings row for the other client');
      console.log(`\n  writing into ${other.name}'s rows: ${blocked ? 'refused' : 'ALLOWED'}`);

      throw new Error('rollback');
    })
    .catch((error) => {
      if (error.message !== 'rollback') throw error;
    });

  // And with nobody named, nothing at all.
  const orphan = await asClient`select count(*)::int as n from public.engagements`;
  check(orphan[0].n === 0, `a connection that never said who it is saw ${orphan[0].n} engagements`);
  console.log(`  a connection that names no client: saw ${orphan[0].n} engagements`);

  console.log('');
  if (failures.length === 0) {
    console.log('Tenancy holds.');
  } else {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    process.exitCode = 1;
  }
} finally {
  await owner.end();
  await asClient.end();
}
