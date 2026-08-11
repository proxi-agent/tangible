import { lit, num, stateClassGroupSql, type Warehouse } from '@tangible/analytics';
import type { Jurisdiction } from '@tangible/types';
import { OWNER_KEY_SQL } from './loader.js';

export const FIXTURE_JURISDICTION: Jurisdiction = {
  id: 'demo-county',
  name: 'Demo County (synthetic)',
  cadCode: 'DEMO',
  state: 'TX',
  county: 'Demo',
  fips: null,
  connectorId: 'fixture',
  blendedTaxRate: 0.025,
  availableYears: [],
  homepageUrl: null,
  dataPortalUrl: null,
  dataNotes: ['Synthetic data generated for demonstration. It means nothing about any real place.'],
};

const CITIES = ['HOUSTON', 'SPRING', 'KATY', 'PASADENA', 'BAYTOWN', 'CYPRESS', 'HUMBLE'];
const OWNER_HEADS = [
  'LONE STAR',
  'GULF COAST',
  'BAYOU CITY',
  'PRECISION',
  'SUMMIT',
  'IRONWOOD',
  'CLEARWATER',
  'RED OAK',
  'TIDEWATER',
  'NORTHLINE',
];
/**
 * A middle word so distinct business names number in the thousands rather than
 * the dozens. Without it every account collapses onto a handful of owner keys
 * and the multi-account rollup looks nothing like a real roll.
 */
const OWNER_MIDDLES = [
  'ALLIED',
  'BRAZOS',
  'CENTRAL',
  'DELTA',
  'EASTGATE',
  'FRONTIER',
  'GRANITE',
  'HERITAGE',
  'INDEPENDENCE',
  'JUNCTION',
  'KEYSTONE',
  'LIBERTY',
  'MERIDIAN',
  'NAVIGATION',
  'OAKMONT',
  'PIONEER',
  'QUARRY',
  'RIVERBEND',
  'STERLING',
  'TRINITY',
  'UNION',
  'VANGUARD',
  'WESTPARK',
  'YORKTOWN',
  'ZENITH',
];
const OWNER_TAILS = [
  'MACHINE WORKS INC',
  'EVENTS & RENTALS LLC',
  'LOGISTICS LP',
  'FABRICATION CO',
  'TREE SERVICE LLC',
  'MEDICAL SUPPLY INC',
  'PRINTING CORP',
  'AUTO GROUP',
  'PIPELINE CO',
  'HOSPITAL DISTRICT',
];

export interface FixtureOptions {
  accounts?: number;
  years?: number[];
  jurisdictionId?: string;
}

/**
 * Generate a synthetic roll with the same shape as a real Texas county file:
 * a long-tailed value distribution, a mix of filing behaviors, frozen-value
 * accounts, agent-represented accounts, exempt entities, and the 2026 exemption
 * cliff.
 *
 * Built entirely in DuckDB from `range()` and `hash()`, so it is deterministic,
 * needs no network, and generates hundreds of thousands of rows in a moment.
 * This is what makes the dashboard explorable before a single county file has
 * been downloaded — it is clearly labelled synthetic everywhere it surfaces.
 */
export async function seedFixture(
  warehouse: Warehouse,
  options: FixtureOptions = {},
): Promise<number> {
  const accounts = options.accounts ?? 25_000;
  const years = options.years ?? [2021, 2022, 2023, 2024, 2025, 2026];
  const jurisdictionId = options.jurisdictionId ?? FIXTURE_JURISDICTION.id;

  const j = FIXTURE_JURISDICTION;

  return warehouse.withWriteLock(async () => {
    await warehouse.exec(/* sql */ `
      INSERT OR REPLACE INTO jurisdiction (
        jurisdiction_id, name, cad_code, state, county, fips,
        connector_id, blended_tax_rate, homepage_url, data_portal_url
      ) VALUES (
        ${lit(jurisdictionId)}, ${lit(j.name)}, ${lit(j.cadCode)}, ${lit(j.state)},
        ${lit(j.county)}, NULL, ${lit(j.connectorId)}, ${lit(j.blendedTaxRate)}, NULL, NULL
      );
    `);

    await warehouse.exec(
      `DELETE FROM account_year WHERE jurisdiction_id = ${lit(jurisdictionId)};`,
    );

    // Deterministic pseudo-randomness: every draw is a hash of the account
    // index and a salt, so the same fixture regenerates identically.
    const draw = (salt: number) => `((hash(i * 1000003 + ${salt}) % 10000)::DOUBLE / 10000.0)`;

    const ownerHead = `list_extract([${OWNER_HEADS.map((o) => lit(o)).join(', ')}], (hash(i * 31 + 7) % ${OWNER_HEADS.length})::INT + 1)`;
    const ownerMiddle = `list_extract([${OWNER_MIDDLES.map((o) => lit(o)).join(', ')}], (hash(i * 97 + 43) % ${OWNER_MIDDLES.length})::INT + 1)`;
    const ownerTail = `list_extract([${OWNER_TAILS.map((o) => lit(o)).join(', ')}], (hash(i * 17 + 3) % ${OWNER_TAILS.length})::INT + 1)`;
    const city = `list_extract([${CITIES.map((c) => lit(c)).join(', ')}], (hash(i * 13 + 5) % ${CITIES.length})::INT + 1)`;

    const sql = /* sql */ `
      INSERT INTO account_year (
        jurisdiction_id, tax_year, account_id,
        owner_name, owner_key,
        site_address, site_city, site_zip,
        mail_address, mail_city, mail_state, mail_zip,
        state_class, state_class_group, business_code,
        market_value, appraised_value, assessed_value,
        rendition_filed, rendition_late, rendition_penalty,
        has_agent, agent_name, is_exempt,
        source_file
      )
      WITH accounts AS (
        SELECT
          i,
          ${ownerHead} || ' ' || ${ownerMiddle} || ' ' || ${ownerTail}
                                                                  AS owner_name,
          ${city}                                                 AS site_city,
          ${draw(11)}                                             AS r_class,
          ${draw(23)}                                             AS r_filing,
          ${draw(37)}                                             AS r_trend,
          ${draw(41)}                                             AS r_agent,
          -- Heavy-tailed value distribution: most accounts are small and a few
          -- are enormous, so roughly a quarter clear the $125K exemption — the
          -- same shape a real county roll has after HB 9.
          2000 * pow(10, 3.6 * pow(${draw(59)}, 2.5))             AS base_value
        FROM range(1, ${lit(accounts + 1)}) t(i)
      ),
      classified AS (
        SELECT
          *,
          CASE
            WHEN r_class < 0.030 THEN 'X'          -- exempt (hospitals, charities)
            WHEN r_class < 0.055 THEN 'J6'         -- pipelines / utilities
            WHEN r_class < 0.110 THEN 'S1'         -- dealer special inventory
            WHEN r_class < 0.300 THEN 'L2'         -- industrial personal property
            ELSE 'L1'                              -- commercial personal property
          END                                                     AS state_class,
          -- Filing behavior cohorts, tuned to the ~40% post-HB 9 filing rate.
          CASE
            WHEN r_filing < 0.30 THEN 'never'
            WHEN r_filing < 0.50 THEN 'intermittent'
            WHEN r_filing < 0.58 THEN 'late'
            ELSE 'always'
          END                                                     AS filing_cohort,
          CASE
            WHEN r_trend < 0.09 THEN 'frozen'
            WHEN r_trend < 0.28 THEN 'growing'
            ELSE 'depreciating'
          END                                                     AS value_trend
        FROM accounts
      ),
      expanded AS (
        SELECT
          c.*,
          y.yr                                                    AS tax_year,
          y.yr - ${lit(Math.min(...years))}                       AS age,
          CASE c.value_trend
            WHEN 'frozen'       THEN c.base_value
            WHEN 'growing'      THEN c.base_value * pow(1.07, y.yr - ${lit(Math.min(...years))})
            ELSE                     c.base_value * pow(0.90, y.yr - ${lit(Math.min(...years))})
          END                                                     AS value_for_year
        FROM classified c
        CROSS JOIN (SELECT unnest([${years.map((y) => lit(y)).join(', ')}]) AS yr) y
        -- Newer accounts appear part-way through the window, so years-on-roll varies.
        WHERE y.yr >= ${lit(Math.min(...years))} + (hash(c.i * 5 + 29) % 3)::INT
      )
      SELECT
        ${lit(jurisdictionId)},
        tax_year,
        printf('%07d', i),
        owner_name,
        ${OWNER_KEY_SQL('owner_name')},
        printf('%d %s ST', 100 + (hash(i * 3) % 8900)::INT, site_city),
        site_city,
        printf('77%03d', (hash(i * 19) % 400)::INT),
        NULL, site_city, 'TX', NULL,
        state_class,
        ${stateClassGroupSql('state_class')},
        NULL,
        round(value_for_year * 1.05, 0),
        round(value_for_year, 0),
        round(value_for_year, 0),
        CASE filing_cohort
          WHEN 'never'  THEN FALSE
          WHEN 'always' THEN TRUE
          WHEN 'late'   THEN TRUE
          ELSE (hash(i * 101 + tax_year) % 2 = 0)
        END,
        CASE WHEN filing_cohort = 'late' THEN TRUE ELSE FALSE END,
        NULL,
        (r_agent < 0.22 AND value_for_year > 500000),
        CASE WHEN r_agent < 0.22 AND value_for_year > 500000
             THEN 'MARVIN POER & CO' ELSE NULL END,
        (state_class = 'X'),
        'synthetic-fixture'
      FROM expanded;
    `;

    await warehouse.exec(sql);

    const row = await warehouse.queryOne<{ n: unknown }>(
      `SELECT count(*) AS n FROM account_year WHERE jurisdiction_id = ${lit(jurisdictionId)};`,
    );
    return num(row?.n);
  });
}
