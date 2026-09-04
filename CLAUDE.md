# Working in this repo

## Node

The repo builds on the **active LTS line**, pinned in `.nvmrc` (Node 24, "Krypton").
`engines.node` in `package.json` says the same thing so the deployment picks the
same major.

## TypeScript

The workspace is on **TypeScript 6.0.3**, pinned in the `catalog:` block of
`pnpm-workspace.yaml` so every package moves together. The root `package.json`
carries the version literally rather than through the catalog, because the
catalog protocol is not available to the root manifest itself — the two have to
be changed together.

It was briefly on 7.0.2. Nothing in the repo needed 7: no tsconfig option here
is 7-only, and `pnpm typecheck` is clean on both. What 7 buys is speed — it is
the Go compiler, and it took the 32-project typecheck from about sixteen seconds
to a couple. What it costs is the ecosystem: `typescript-eslint` throws at config
load on 7, and it is not the only tool with a `<7` peer range. Staying on the 6
line keeps those doors open at the price of a slower typecheck, which is a fair
trade while 7 is this young.

## Dependencies

**Do not add a library that is not maintained.** Before adding anything, check
the release history, the open-issue response time, and whether a released fix
exists for its known advisories. `pnpm audit` must stay clean.

Read "maintained" as _someone is still answering_, not _someone shipped
recently_. Small, complete libraries stop releasing because they are finished,
and time-since-last-release on its own would reject good ones and keep bad ones
— an abandoned package with a fresh dependabot bump looks newer than a stable
one. The signals that actually discriminate:

- an **unfixed advisory**, or a fix that exists upstream and was never released
- **open issues going unanswered** for months, especially crash and correctness reports
- **a dead peer range** — it has not been updated for the current major of React,
  Next, or TypeScript, so every install needs a manual override
- a **published deprecation**, or an archived repository

Any one of those disqualifies it. None of them is "the last release was a while
ago."

The rule the audit trail keeps proving, though, is the cheaper one: **check
whether a dependency already in the tree does the job.** `clsx` was removed
because `tailwind-merge`, imported on the line above it in the same file, already
accepted every value shape the 98 `cn()` call sites passed. The one feature
`clsx` added — object syntax — was used nowhere. It was not unmaintained; it was
redundant, which is the more common failure and the easier one to miss.

Where a transitive dependency carries an advisory with no upstream fix, force it
forward with an `overrides` entry in `pnpm-workspace.yaml` (**not** the `pnpm`
field in `package.json`, which pnpm 11 ignores), and write down why.

## Linting

`pnpm lint` builds the workspace packages through turbo and then runs
**oxlint** with `--type-aware` over the whole workspace in one pass — about
seven seconds cold, two once turbo's cache is warm. `pnpm lint:fix` does the
same and applies the fixable subset.

The build prefix is not optional. `--type-aware` needs the `.d.ts` files in
`packages/*/dist` to resolve cross-package imports; without them every
`@tangible/*` type becomes an `error` type acting as `any` and oxlint reports
around 200 `no-redundant-type-constituents` errors. Running plain
`oxlint --type-aware` is green on a working machine only because an earlier
build or `pnpm dev` left `dist/` behind — it fails in a clean clone, which is
what CI is, and that is why the Lint job was red on every run before this.

The prefix is `turbo run build --filter='./packages/*'`, not a turbo `lint`
task, for two reasons. A root task (`//#lint`) cannot express the dependency:
`//` has no workspace dependencies, so `dependsOn: ["^build"]` resolves to
nothing and turbo runs the lint alone. A per-package `lint` task would express
it, but it would turn one whole-workspace oxlint pass into eighteen, and the
type-aware pass is the expensive part. The `./packages/*` glob covers new
packages automatically and deliberately excludes the two apps, whose builds
lint does not need.

## CI

`.github/workflows/ci.yml` runs five jobs on every push to `main` and every pull
request: lint, typecheck, test, build, audit. They share `.github/actions/setup`,
which installs pnpm from the `packageManager` field, Node from `.nvmrc`, and the
workspace with `--frozen-lockfile`.

**CI holds no secrets, and should not need to.** The web build was checked with
`.env` removed entirely and still completes — every variable it reads is optional
or read at request time. If a change makes the build require an environment
variable, that is worth noticing before it becomes a deployment problem.

Two things are _not_ in CI and are not oversights:

- `pnpm --filter @tangible/db tenancy:verify` needs a live database and both
  roles' credentials. Run it by hand after any schema change.
- `drizzle-kit push` is never run from CI. Schema changes go out deliberately —
  and with `--force`, never `generate`.

The valuation gate needs no separate job: `packages/eval` runs its golden suites
as ordinary vitest files, so a schedule that stopped reproducing a district's
published numbers fails the `test` job like anything else.

## Scheduled work

**The crons in `vercel.json` do not run, and never have.** The account is on
Vercel's hobby plan, which limits both how many cron jobs a project may have and
how often each may fire. Nothing about this is loud: the build is green, the
deployment is READY, the three routes are reachable, and no invocation is ever
made. It was found by reading production runtime logs over a six-hour window and
finding only hand-made requests in them, then over a further fifteen hours and
finding nothing at all — `health_probes` had stood empty since the table was
created.

The schedule now lives in Postgres, via `pg_cron` and `pg_net`. Apply it with

```
cd packages/db && set -a && . ../../.env && set +a && node scripts/apply-scheduler.mjs
```

which seeds the bearer token into Supabase's vault and then runs
`packages/db/sql/scheduler.sql`. Both are idempotent; re-run after either
changes. The reasoning is all in the SQL file's header — read it before changing
a cadence.

Four things worth knowing before touching any of it:

- **`vercel.json` keeps its `crons` block on purpose.** It is the record of what
  the cadences are meant to be, so moving to a plan whose crons run means
  deleting three rows from `cron.job`, not reconstructing a schedule from
  memory. Change a cadence in both places or in neither.
- **The endpoints were never coupled to Vercel's scheduler.** They authenticate
  on `Authorization: Bearer $CRON_SECRET`, checked in the handler, not on the
  `x-vercel-cron` header. That is the whole reason this substitution costs
  nothing, and it is worth preserving for any future scheduled route.
- **The health probe now runs on the database it partly watches.** A Postgres
  outage makes it go quiet rather than fail. Read `health_probes` falling silent
  as an outage; the missing row is the alarm. This was accepted knowingly, and
  it is the one real cost of doing it this way.
- **Use the production alias, `tangible-proxi.vercel.app`.** Vercel
  Authentication is enabled for `all_except_custom_domains`, so
  `tangible-kajmeris-projects.vercel.app` answers a 302 to the SSO wall and
  never reaches the app. If the alias changes, `ops.call_scheduled` is the one
  line to edit — and the check is that the reply is our own 401, not a redirect
  to vercel.com. It has changed once already: the alias was
  `tangible-two.vercel.app` until 2026-09-02, and renaming it in Vercel broke
  nothing loudly — every job went on succeeding at a request the far end had
  started 404ing. Renaming the alias means editing that line, `NEXT_PUBLIC_APP_URL`,
  and the Supabase Site URL and redirect allowlist, in that order.

`ops.recent_runs` says whether a schedule fired; `ops.recent_calls` says what the
endpoint replied, which is the one that matters, since a job can succeed at
making a request the far end refused. pg_net expires those rows after about six
hours, so empty is not the same as calm.

None of this is visible to `drizzle-kit push` or to `tenancy:verify` — it lives
in `ops`, `cron` and `net`, and both of those tools look only at `public`. That
is deliberate, and it is also why nothing here will warn you if it breaks.
