# Working in this repo

## Node

The repo builds on the **active LTS line**, pinned in `.nvmrc` (Node 24, "Krypton").
`engines.node` in `package.json` says the same thing so the deployment picks the
same major.

Neither of those actually stops a build, so `scripts/check-node.mjs` does: it
reads `.nvmrc` and exits non-zero on a mismatch, and it runs at the front of
both `pnpm build` (root) and `apps/web`'s own build. `engines` is advisory, and
pnpm's `engine-strict` only warns and still exits 0 — the `.npmrc` entry is kept
for the warning, not for enforcement.

When the LTS line moves, change `.nvmrc` and `engines.node` together. Nothing
else needs touching: `nvm use` and `actions/setup-node`'s `node-version-file`
both read `.nvmrc`.

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

### TanStack Table is on v9, and v9 is a different library

`@tanstack/react-table` 9 is a rewrite, not a bump. Everything that touches it
lives in one file — `apps/web/src/components/ui/data-table.tsx` — and that is
deliberate: no page imports `@tanstack/react-table`, and the five call sites that
need types import `DataTableColumn` and `SortingState` from the component
instead. A v10 should be one file's problem.

Three things about the migration are worth knowing before editing that file:

- **Features are declared once, statically.** `useTable` replaces
  `useReactTable`, and takes a `features` object built by `tableFeatures({...})`
  at module scope. Only the features registered there exist on the instance, and
  only they are bundled. Column visibility is deliberately absent — nothing here
  hides a column — which is why the body renders `row.getAllCells()` rather than
  `getVisibleCells()`, a method that moved into `columnVisibilityFeature`.
- **`sortFns` is a registry, and an unregistered name fails quietly.** A column's
  default `sortFn: 'auto'` resolves to one of the names `alphanumeric`,
  `datetime`, or `text`; if that name is not in the registry, v9 warns in dev and
  silently falls back to a plain `<`, which puts "Account 10" above "Account 2".
  All four are registered for that reason.
- **`RowData` is tighter.** v8 accepted effectively anything as a row type; v9
  narrows it to `Record<string, any> | Array<any>`, so the component's generics
  are constrained `T extends RowData`. Every row here is a record, so this costs
  nothing today.

### A sortable header needs an accessor, even when nothing sorts locally

`getCanSort()` is `enableSorting && !!column.accessorFn` — identical in v8 and
v9. The accounts and owners tables were built entirely from display columns
(`id` + `cell`, no accessor), so every header on them was inert and `aria-sort`
was never emitted: the roll was sorted, and the page said nothing about it. The
fix is an `accessorFn` on each sortable column reading the field the server
orders by. Nothing consumes the value — `manualSorting` sends the sort to the
endpoint — but it is what makes the column sortable at all, and pinning it to
the server's own field keeps the header and the `ORDER BY` naming one column.

The rule that falls out: on those two tables, **a column has an accessor
exactly when its id is in `ACCOUNT_SORT_FIELDS` / `OWNER_SORT_FIELDS`.** A
column the endpoint cannot order by stays a display column and its header stays
plain text, which is the honest thing for it to be.

Server-sorted tables also turn off two defaults, in `data-table.tsx`, keyed off
whether `sorting` is controlled:

- **`enableSortingRemoval`** — the default cycle is asc → desc → unsorted, but
  an endpoint always has an `ORDER BY`. The third click would announce "no
  order" and quietly land back on the default column. Two states is the truth.
  The browser-sorted tables keep all three, where "unsorted" really is the order
  the rows arrived in.
- **`enableMultiSort`** — these endpoints take one `sortBy`, so a shift-click
  would build a second sort that is silently dropped on the way out.

### Two dependencies that look wrong and are not

`xlsx` resolves to `file:../../vendor/xlsx-0.20.3.tgz`. SheetJS stopped
publishing to npm after 0.18.5 (2022), and that abandoned version carries
prototype-pollution and ReDoS advisories with no fix on the registry. The
vendored tarball is the _newer_, maintained 0.20.3 from SheetJS's own
distribution. Do not "fix" this by installing `xlsx` from npm — that is a
downgrade onto the vulnerable copy.

`pdf-lib` is aliased to `npm:@cantoo/pdf-lib` — an actively maintained fork with
the same API. Upstream `pdf-lib` last released in November 2021. The alias keeps
every `from 'pdf-lib'` import and every comment naming it accurate; only the
`packages/filing` dependency line changed.

## Linting

`pnpm lint` runs **oxlint** with `--type-aware` over the whole workspace, in
about a second and a half. `pnpm lint:fix` applies the fixable subset.

**It is not ESLint, and that is now a choice rather than a constraint.** It
started as a constraint: `typescript-eslint` refuses to load on TypeScript 7 —
not a warning, a thrown `typescript-eslint does not support TS 7.0` at config
time, with a peer range of `>=4.8.4 <6.1.0` on both the stable and canary lines.
The repo has since moved back to TypeScript 6.0.3 (see below), which falls
_inside_ that range, so ESLint would install and run again today. It is still
not what runs here. oxlint does the whole workspace type-aware in about a second
and a half against ESLint's minutes, `.oxlintrc.json` is already tuned to this
codebase's real false positives, and the current output is zero errors. Adding
ESLint back would buy rules nobody has asked for at a cost everybody would feel.
If TypeScript moves to 7 again, the constraint returns and this stops being a
choice — oxlint's type-aware backend (`oxlint-tsgolint`) is built on tsgo, which
_is_ the TypeScript 7 compiler, and would carry on either way.

Config is `.oxlintrc.json`. Two things about it are deliberate:

- **`correctness` and `suspicious` are errors; everything else is off.** The
  stylistic categories were tried and produced thousands of findings that were
  all correct about their rule and all wrong about this codebase — 5,271
  `react-in-jsx-scope` alone, a rule the modern JSX transform retired. A linter
  nobody can read the output of is the same as no linter.
- **Rules turned off by name have a reason, not a convenience.**
  `no-unstable-nested-components` fires on every TanStack Table `cell:` callback
  and every Recharts `content=` render prop, which is 24 out of 24 false
  positives here. `no-base-to-string` and `restrict-template-expressions` fire on
  defensive stringification that is doing its job.

Fourteen warnings are open on purpose — five `set-state-in-effect`, four `refs`,
five dependency-array notes. Each is a real observation about a real component
and each needs a decision about that component's behaviour, not a lint fix. CI
runs `--max-warnings 14`, so they cannot quietly become fifteen.

The fourteenth is worth a note, because it arrived without anyone writing it.
The react-table v9 migration changed the options object passed to `useTable` in
`data-table.tsx` and left the effect below it byte-identical — and oxlint then
reported an extra dependency on that effect that it had never reported before.
It is a real observation (`data` is in the dependency array and is not read
inside the effect) that the analysis previously could not reach, not a new
defect. The dependency stays: the effect re-measures the scroll box, which does
change when the page of data changes.

Reach for an inline `// oxlint-disable-next-line <rule>` only with a comment
above it saying why the rule is wrong _here_. There are two in the tree: bridging
yauzl's callbacks to stream `pipeline` in `packages/ingest/src/download.ts`, and
the deliberate `<a href>` in `apps/web/src/app/error.tsx`, which is a hard
navigation precisely because the React tree that a `<Link>` would need is the one
that just threw.

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
