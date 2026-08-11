import { BPP_EXEMPTION_BY_YEAR, RENDITION_PENALTY_RATE } from '@tangible/types';
import { lit } from './sql.js';
import type { Warehouse } from './warehouse.js';

/**
 * The warehouse holds three things: a dimension table of jurisdictions, a
 * policy table of statutory thresholds by year, and one wide fact table of
 * account-years. Everything analytical is derived from those at query time —
 * there are no materialized rollups to keep in sync.
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

CREATE TABLE IF NOT EXISTS tax_policy (
  tax_year              INTEGER PRIMARY KEY,
  exemption_threshold   DOUBLE NOT NULL,
  penalty_rate          DOUBLE NOT NULL
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
  const rows = Object.entries(BPP_EXEMPTION_BY_YEAR).map(
    ([year, exemption]) => `(${lit(Number(year))}, ${lit(exemption)}, ${lit(RENDITION_PENALTY_RATE)})`,
  );
  return /* sql */ `
    INSERT OR REPLACE INTO tax_policy (tax_year, exemption_threshold, penalty_rate)
    VALUES ${rows.join(', ')};
  `;
}

/**
 * Policy rows are only defined for years we have codified. Any tax year present
 * in the data but missing from the table inherits the most recent known rule,
 * so a newly published year still analyzes instead of silently dropping out.
 */
export const BACKFILL_POLICY_SQL = /* sql */ `
INSERT OR IGNORE INTO tax_policy (tax_year, exemption_threshold, penalty_rate)
SELECT DISTINCT
  ay.tax_year,
  (SELECT exemption_threshold FROM tax_policy ORDER BY tax_year DESC LIMIT 1),
  (SELECT penalty_rate FROM tax_policy ORDER BY tax_year DESC LIMIT 1)
FROM account_year ay
WHERE ay.tax_year NOT IN (SELECT tax_year FROM tax_policy);
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
