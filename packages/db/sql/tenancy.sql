-- ===========================================================================
--  Tenancy, enforced by the database.
-- ===========================================================================
--
--  Every table in this schema has had row-level security switched on since it
--  was created, and until now not one of them had a policy behind it. That is
--  not a half-measure, it is a no-op: RLS with no policy denies everything, and
--  the application connects as `postgres`, which carries BYPASSRLS. Nothing was
--  ever being checked.
--
--  So the boundary between one business and another has rested entirely on two
--  layers of application code: the whole-path allowlist in `proxy.ts`, and a
--  `require*Scope` call in each of the handlers a client can reach. Both are
--  carefully written. Both are code that a person has to remember to write, and
--  the failure mode of forgetting is not an error — it is another business's
--  data rendered into a page.
--
--  What this file adds is the backstop underneath them. A second database role
--  that does not bypass RLS, one setting that says which client is asking, and
--  a policy on every table that carries a business's data.
--
--  ---------------------------------------------------------------------------
--  The rule, stated once
--  ---------------------------------------------------------------------------
--
--  **These policies enforce tenancy, and nothing else.** A client connection
--  can reach the rows belonging to its own client and no others, ever. What
--  subset of its own data the portal chooses to *show* — the report yes, our
--  unblock plan no, the asset profile with the firm's working notes withheld —
--  stays an application decision, made by `CLIENT_ROUTES` and by the handlers.
--
--  Keeping those two apart is deliberate. Tenancy is an invariant and belongs
--  somewhere it cannot be forgotten. Which of a client's own records we put in
--  front of them is an editorial judgment that changes with the product, and
--  encoding it here would mean every product decision needing a migration.
--
--  ---------------------------------------------------------------------------
--  Where the rest of it is
--  ---------------------------------------------------------------------------
--
--  The policies themselves are in `src/policies.ts`, not here. They started in
--  this file, and the first `drizzle-kit push` afterwards dropped all forty-two
--  of them uninvited: push reconciles row-level security along with everything
--  else, and a policy the schema never declared is one it removes. It printed
--  the DROPs, applied them, and the application carried on working perfectly
--  with the boundary gone. Declaring them in the schema is what makes push
--  maintain them instead.
--
--  What stays here is what drizzle does not model — the role, the setting it
--  reads, and the grants — plus the reasoning above, which belongs next to the
--  arrangement rather than inside a TypeScript file.
--
--  Order matters exactly once, on a database that has neither yet: this file
--  first, because a policy cannot name a role that does not exist.
--
--  `scripts/verify-tenancy.mjs` proves the whole thing against live data. Run
--  it after every push.

begin;

create schema if not exists app;

-- ---------------------------------------------------------------------------
--  Who is asking
-- ---------------------------------------------------------------------------
--
--  Set per transaction by the application, from the signed-in session, never
--  from anything a caller supplies. Unset, it is NULL, and every comparison
--  against it is NULL — so a connection that forgets to say who it is sees
--  nothing at all rather than everything. That is the whole reason the setting
--  is read this way instead of defaulting to something.
--
--  `current_setting(..., true)` is the missing_ok form: without it, a
--  connection that never set the value raises rather than returning NULL, and
--  the fail-closed case would surface as an error instead of an empty result.
create or replace function app.client_id() returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('app.client_id', true), '')::uuid $$;

comment on function app.client_id() is
  'The client whose session this transaction is serving, or NULL. Every tenancy policy is written against it.';

-- ---------------------------------------------------------------------------
--  The role the client wing connects as
-- ---------------------------------------------------------------------------
--
--  Created by `apply-tenancy.mjs`, which owns the password. Everything below
--  assumes it exists and refuses to run if it does not, because silently
--  applying policies for a role nobody connects as is the same no-op this file
--  exists to end.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tangible_client') then
    raise exception
      'The tangible_client role does not exist. Run packages/db/scripts/apply-tenancy.mjs, which creates it with a password and writes CLIENT_DATABASE_URL.';
  end if;
  if (select rolbypassrls from pg_roles where rolname = 'tangible_client') then
    raise exception
      'tangible_client has BYPASSRLS, which would make every policy in this file decorative.';
  end if;
end
$$;

grant usage on schema public to tangible_client;
grant usage on schema app to tangible_client;
grant execute on function app.client_id() to tangible_client;

-- ===========================================================================
--  Grants
-- ===========================================================================
--
--  The policies decide *whose* rows. The grants decide *whether* a write is
--  possible at all, and they are deliberately narrow: reading is granted on
--  everything a client's session may reach, writing only on the seven tables
--  the portal actually writes to.
--
--  Adding a write to the client wing therefore means adding a grant here. That
--  is the same intended friction as adding a line to CLIENT_ROUTES, and it
--  fails the way it should — `permission denied for table rendition_filings`
--  names the table and the mistake in one sentence.
--
--  DELETE is granted nowhere. Nothing a client does through the portal removes
--  a row; even a rejected finding is a disposition written down, not an
--  erasure. Deleting a business is a firm action with its own receipt.

do $$
declare t text;
begin
  foreach t in array array[
    'clients','engagements','agent_appointments','assets','client_filing_profiles',
    'client_locations','notifications','portal_settings','portal_users',
    'analysis_runs','assessment_notices','asset_classifications','asset_versions',
    'correction_motions','evidence_exports','far_files','finding_dispositions',
    'finding_row_decisions','finding_sets','findings','graph_answers','import_batches',
    'intake_files','invoice_asset_links','invoice_documents','mapping_asks','motion_drafts',
    'prior_documents','protest_briefs','protest_resolutions','recovery_claims',
    'recovery_outcomes','rendition_extensions','rendition_filings','result_letters',
    'unblock_plans','asset_events','asset_positions','invoice_lines','prior_return_lines',
    'evidence_records','jurisdictions'
  ] loop
    execute format('grant select on public.%I to tangible_client', t);
  end loop;

  -- Sending a register, answering a question, asking one, deciding rows,
  -- asking for a report, and setting the confidence threshold. That is the
  -- whole of what the portal writes.
  foreach t in array array[
    'intake_files',
    'mapping_asks',
    'graph_answers',
    'finding_row_decisions',
    'analysis_runs',
    'portal_settings',
    'portal_users'
  ] loop
    execute format('grant insert, update on public.%I to tangible_client', t);
  end loop;
end
$$;

commit;
