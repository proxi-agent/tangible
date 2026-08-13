import { POLICY_BY_STATE } from '@tangible/types';
import { lit } from './sql.js';
import type { Warehouse } from './warehouse.js';

/**
 * The warehouse holds three things: a dimension table of jurisdictions, a
 * policy table of statutory thresholds by state and year, and one wide fact
 * table of account-years. Everything analytical is derived from those at query
 * time — there are no materialized rollups to keep in sync.
 */
export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS jurisdiction (
  jurisdiction_id   VARCHAR PRIMARY KEY,
  name              VARCHAR NOT NULL,
  cad_code          VARCHAR NOT NULL,
  state             VARCHAR NOT NULL,
  county            VARCHAR NOT NULL,
  fips              VARCHAR,
  connector_id      VARCHAR NOT NULL,
  blended_tax_rate  DOUBLE  NOT NULL,
  homepage_url      VARCHAR,
  data_portal_url   VARCHAR
);

-- Dropped and reseeded on every migration rather than created if absent. It
-- holds no ingested data — every row is derived from the codified statutes — so
-- rebuilding it is free, and it is the one table whose shape has had to change
-- as states were added.
DROP TABLE IF EXISTS tax_policy;
CREATE TABLE tax_policy (
  state                 VARCHAR NOT NULL,
  tax_year              INTEGER NOT NULL,
  exemption_threshold   DOUBLE NOT NULL,
  penalty_rate          DOUBLE NOT NULL,
  PRIMARY KEY (state, tax_year)
);

CREATE TABLE IF NOT EXISTS account_year (
  jurisdiction_id    VARCHAR  NOT NULL,
  tax_year           INTEGER  NOT NULL,
  account_id         VARCHAR  NOT NULL,

  owner_name         VARCHAR,
  owner_key          VARCHAR,

  site_address       VARCHAR,
  site_city          VARCHAR,
  site_zip           VARCHAR,
  mail_address       VARCHAR,
  mail_city          VARCHAR,
  mail_state         VARCHAR,
  mail_zip           VARCHAR,

  state_class        VARCHAR,
  state_class_group  VARCHAR,
  business_code      VARCHAR,

  market_value       DOUBLE,
  appraised_value    DOUBLE,
  assessed_value     DOUBLE,

  rendition_filed    BOOLEAN,
  rendition_late     BOOLEAN,
  rendition_penalty  DOUBLE,

  has_agent          BOOLEAN,
  agent_name         VARCHAR,
  is_exempt          BOOLEAN,

  source_file        VARCHAR,
  ingested_at        TIMESTAMP DEFAULT current_timestamp,

  PRIMARY KEY (jurisdiction_id, tax_year, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_year_lookup
  ON account_year (jurisdiction_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_account_year_owner
  ON account_year (jurisdiction_id, owner_key);
`;

/** Seed the statutory policy table from the shared constants. */
export function taxPolicySeedSql(): string {
  const rows = Object.entries(POLICY_BY_STATE).flatMap(([state, policy]) =>
    Object.entries(policy.exemptionByYear).map(
      ([year, exemption]) =>
        `(${lit(state)}, ${lit(Number(year))}, ${lit(exemption)}, ${lit(policy.penaltyRate)})`,
    ),
  );
  return /* sql */ `
    INSERT OR REPLACE INTO tax_policy (state, tax_year, exemption_threshold, penalty_rate)
    VALUES ${rows.join(', ')};
  `;
}

/**
 * Policy rows are only defined for the years we have codified. A tax year
 * present in the data but missing from the table inherits that *same state's*
 * nearest known rule, so a newly published year still analyzes instead of
 * silently dropping out.
 *
 * Nearest, not newest. A year *after* the codified range should inherit the
 * latest rule, but a year before it must inherit the earliest — Texas ran a
 * $2,500 exemption until HB 9 raised it to $125,000 for 2026, and inheriting the
 * newest rule backwards priced a 2020 roll at the 2026 exemption, dropping
 * almost every account below the taxable line.
 *
 * The `EXISTS` guard is what keeps the inheritance honest. A state with no
 * codified policy at all — the next one someone adds a connector for — gets no
 * rows rather than borrowing Texas's, because the columns are NOT NULL and the
 * subqueries would otherwise return NULL. Falling back to the query defaults is
 * the right failure: it is visibly a default, where a borrowed exemption would
 * look like a researched number.
 */
export const BACKFILL_POLICY_SQL = /* sql */ `
INSERT OR IGNORE INTO tax_policy (state, tax_year, exemption_threshold, penalty_rate)
SELECT DISTINCT
  j.state,
  ay.tax_year,
  (SELECT p.exemption_threshold FROM tax_policy p
    WHERE p.state = j.state
    ORDER BY abs(p.tax_year - ay.tax_year) ASC, p.tax_year DESC LIMIT 1),
  (SELECT p.penalty_rate FROM tax_policy p
    WHERE p.state = j.state
    ORDER BY abs(p.tax_year - ay.tax_year) ASC, p.tax_year DESC LIMIT 1)
FROM account_year ay
JOIN jurisdiction j USING (jurisdiction_id)
WHERE EXISTS (SELECT 1 FROM tax_policy p WHERE p.state = j.state)
  AND NOT EXISTS (
    SELECT 1 FROM tax_policy p WHERE p.state = j.state AND p.tax_year = ay.tax_year
  );
`;

export async function migrate(warehouse: Warehouse): Promise<void> {
  await warehouse.withWriteLock(async () => {
    await warehouse.exec(DDL);
    await warehouse.exec(taxPolicySeedSql());
  });
}

/** Run after an ingest so late-arriving tax years pick up a policy row. */
export async function backfillPolicy(warehouse: Warehouse): Promise<void> {
  await warehouse.exec(BACKFILL_POLICY_SQL);
}
