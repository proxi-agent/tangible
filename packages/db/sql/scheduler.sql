-- ===========================================================================
--  The schedule, moved into the database.
-- ===========================================================================
--
--  `vercel.json` has declared three cron jobs since the day the engine grew
--  something worth running on a timer, and not one of them has ever fired.
--  Six hours of production runtime logs contained only hand-made requests; a
--  further fifteen hours added nothing, so this is not a schedule running late
--  or degraded to daily. It is a schedule that does not run. The account is on
--  Vercel's hobby plan, which caps both how many cron jobs a project may have
--  and how often they may run, and the failure is silent in the worst way: the
--  build is green, the deployment is READY, the routes are reachable, and
--  nothing is ever invoked.
--
--  The way out is cheap because of a decision made earlier for a different
--  reason. The three endpoints authenticate on `Authorization: Bearer
--  $CRON_SECRET`, checked by the handler itself — not on Vercel's
--  `x-vercel-cron` header. They were never coupled to Vercel's scheduler, so
--  any caller that can present the bearer will do, and the database is already
--  running, already paid for, and already the thing all three jobs act on.
--
--  ---------------------------------------------------------------------------
--  What this costs us, stated plainly
--  ---------------------------------------------------------------------------
--
--  The health probe now runs on the database it is partly there to watch. If
--  Postgres is down the probe does not fail — it goes quiet, which is a weaker
--  signal than a failure and the exact blind spot a probe is supposed to close.
--  This was accepted deliberately rather than overlooked. Read `health_probes`
--  going silent as an outage, not as calm; the row's absence is the alarm.
--
--  The drain and the digest carry no such caveat. Both operate on this
--  database, so a database that cannot schedule them could not serve them
--  either.
--
--  ---------------------------------------------------------------------------
--  Why a function instead of three inline statements
--  ---------------------------------------------------------------------------
--
--  `cron.job.command` is an ordinary readable column. A bearer token pasted
--  into a schedule would sit there in clear text for anyone with a connection,
--  which is most of the ways this database gets looked at. So the token lives
--  in Supabase's vault, one `security definer` function reads it, and the
--  schedules name a path and nothing else.
--
--  Everything here lives in `ops`, deliberately not in `public`. The tenancy
--  verifier reads `pg_class` for `public` and fails on any table it cannot
--  account for, which is a guard worth keeping sharp; firm plumbing that holds
--  no client data should not have to be added to its lists to keep it quiet.
--  (`pg_net` agrees, as it happens — it puts its queue and response tables in
--  its own `net` schema regardless of where the extension is registered.)
--
--  Idempotent throughout. Re-run it after any change; `cron.schedule` upserts
--  on the job name.
--
--    cd packages/db && set -a && . ../../.env && set +a \
--      && node scripts/apply-scheduler.mjs
--
--  The vault secret is seeded by that script and not by this file, for the
--  same reason `apply-tenancy.mjs` invents the role password: a secret does
--  not belong in a committed file.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists ops;
comment on schema ops is
  'Firm plumbing: scheduling and its diagnostics. Holds no client data, which '
  'is why it is not public and why verify-tenancy.mjs does not look at it.';

-- ---------------------------------------------------------------------------
--  The one call
-- ---------------------------------------------------------------------------
--
--  `timeout_milliseconds` is generous on purpose. The probe alone took 5.8
--  seconds on its first real run — most of it a warehouse count over 2.27
--  million account-years — and the drain's work is unbounded by nature. pg_net
--  aborts the connection when it times out, and an aborted connection to a
--  serverless function can cancel the work it was doing, so a tight timeout
--  here would not merely mis-report a slow job, it would truncate one.
--
--  The call is fire-and-forget: this returns a request id immediately and the
--  response lands in `net._http_response` later. `ops.recent_calls` below is
--  where to look, and pg_net drops those rows after about six hours.
create or replace function ops.call_scheduled(path text, timeout_ms integer default 120000)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  secret text;
  request_id bigint;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets
   where name = 'cron_secret';

  -- Fail loudly. A missing secret would otherwise send an unauthenticated
  -- request, collect a 401 into a table nobody reads, and look like success
  -- from here.
  if secret is null or secret = '' then
    raise exception 'no cron_secret in the vault: run scripts/apply-scheduler.mjs';
  end if;

  select net.http_post(
    -- The production alias, and it has to be this one. Vercel Authentication
    -- is enabled for `all_except_custom_domains` on this project, so
    -- `tangible-kajmeris-projects.vercel.app` answers a 302 to the SSO wall
    -- and never reaches the app. `tangible-two.vercel.app` is the production
    -- domain and reaches the handler. If that alias ever changes, this line is
    -- the single place to change it — and the thing to verify is that the
    -- reply is our own 401, not a redirect to vercel.com.
    url := 'https://tangible-two.vercel.app' || path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := timeout_ms
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function ops.call_scheduled(text, integer) from public;

-- ---------------------------------------------------------------------------
--  The schedules
-- ---------------------------------------------------------------------------
--
--  Same three jobs and the same three cadences `vercel.json` asks for, kept in
--  step on purpose: that file stays as written, so moving to a plan whose crons
--  actually run is a matter of deleting these three rows, not of remembering
--  what the schedule used to be.
--
--  `cron.timezone` is GMT here, which is what Vercel's crons assume, so the
--  Monday-14:00 digest keeps the hour it was written for.
select cron.schedule('drain-runs',    '*/10 * * * *', $job$select ops.call_scheduled('/api/runs/drain')$job$);
select cron.schedule('health-probe',  '*/15 * * * *', $job$select ops.call_scheduled('/api/health/probe')$job$);
select cron.schedule('engine-digest', '0 14 * * 1',   $job$select ops.call_scheduled('/api/quality/digest/send')$job$);

-- ---------------------------------------------------------------------------
--  Where to look when it misbehaves
-- ---------------------------------------------------------------------------
--
--  Two different questions, two views. `recent_runs` answers "did the schedule
--  fire" — pg_cron's own log, which records that the statement ran and says
--  nothing about what the endpoint replied. `recent_calls` answers "and what
--  came back", which is the one that matters, because a job can succeed at
--  making a request that the far end refused.
create or replace view ops.recent_runs as
  select j.jobname,
         d.status,
         d.return_message,
         d.start_time,
         d.end_time
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   order by d.start_time desc;

create or replace view ops.recent_calls as
  select r.id,
         r.status_code,
         r.error_msg,
         r.created,
         left(r.content, 500) as body
    from net._http_response r
   order by r.created desc;

comment on view ops.recent_calls is
  'What the endpoints actually replied. Empty is not calm: pg_net expires '
  'these rows after roughly six hours.';
