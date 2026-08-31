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

`pnpm lint` runs **oxlint** with `--type-aware` over the whole workspace, in
about a second and a half. `pnpm lint:fix` applies the fixable subset.

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
