import type { Jurisdiction, SourceFile } from '@tangible/types';
import type { CompanionFile, Connector, FileFormat, UnitFile } from '../connector.js';

export const HARRIS_COUNTY: Jurisdiction = {
  id: 'tx-harris',
  name: 'Harris County',
  cadCode: 'HCAD',
  state: 'TX',
  county: 'Harris',
  fips: '48201',
  connectorId: 'hcad',
  // Blended total rate across overlapping taxing units (county, city, ISD, MUD).
  blendedTaxRate: 0.025,
  availableYears: [],
  homepageUrl: 'https://hcad.org',
  dataPortalUrl: 'https://hcad.org/pdata/pdata-property-downloads.html',
  dataNotes: [],
};

/**
 * HCAD's download page renders its links with JavaScript and the file naming
 * has changed across years, so every known location is tried in turn. When all
 * of them miss, the operator copies the real link off the portal and passes it
 * through `urls.txt` — see the ingest CLI.
 */
const URL_PATTERNS: readonly string[] = [
  // Confirmed working for 2021–2026 as of Aug 2026. The others are kept as
  // fallbacks for years published under the older naming.
  'https://download.hcad.org/data/CAMA/{year}/PP_files.zip',
  'https://download.hcad.org/data/CAMA/{year}/Personal_advanced.zip',
  'https://download.hcad.org/data/CAMA/{year}/Personal.zip',
  'http://pdata.hcad.org/data/cama/{year}/Personal.zip',
  'http://pdata.hcad.org/data/cama/{year}/Personal_advanced.zip',
  'http://pdata.hcad.org/download/{year}/Personal.zip',
];

/** Files inside the archive that plausibly hold the account roll, best first. */
const ACCOUNT_FILE_PATTERNS: readonly RegExp[] = [
  /t_business_acct\.txt$/i,
  /business.*acct.*\.txt$/i,
  /personal.*acct.*\.txt$/i,
  /\bpp.*acct.*\.txt$/i,
  /_acct\.txt$/i,
];

export class HcadConnector implements Connector {
  readonly id = 'hcad';
  readonly jurisdiction = HARRIS_COUNTY;

  readonly format: FileFormat = {
    delimiter: '\t',
    hasHeader: 'auto',
    // The archives are plain ASCII with CRLF line endings. DuckDB's latin-1
    // reader rejects them outright, and UTF-8 reads them losslessly — verified
    // across 2021–2026, none of which contain a byte above 0x7F.
    encoding: 'utf-8',

    /**
     * Pinned against the real 2021–2026 `t_business_acct.txt`. The header names
     * are stable across those years, but they are pinned rather than
     * alias-matched because two of them would otherwise resolve wrongly:
     * `class_code` is the Texas state class here (L1/L2/S1/J*) though it means
     * something else in HCAD's real-property files, and `name` is the owner
     * while `bus_name` is the trading name.
     */
    defaultLayout: {
      accountId: 'acct',
      ownerName: 'name',
      siteAddress: 'site_addr',
      siteCity: 'site_city',
      siteZip: 'site_zip',
      mailAddress: 'mail_addr_1',
      mailCity: 'mail_city',
      mailState: 'mail_state',
      mailZip: 'mail_zip',
      stateClass: 'class_code',
      businessCode: 'sic',
      // Pre-exemption assessed value. The $125K grouped exemption is applied
      // downstream, so this is the number the exemption test compares against.
      assessedValue: 'asd_val',
      agentName: 'agent_id',
      renditionFiled: 'return_cd',
      renditionLate: 'return_cd',
    },

    /**
     * `return_cd` carries the filing status: blank (the most common value),
     * `Y-Rendered`, `L-Late Rendition`, or `I-Invalid Rendition`. A blank is a
     * real signal — the district recorded no rendition — so it maps to FALSE
     * rather than unknown.
     *
     * An invalid rendition counts as filed but penalty-exposed: something was
     * submitted, so it is not a non-filer, but it did not satisfy the
     * requirement either.
     */
    booleanRules: {
      renditionFiled: [
        { match: '', value: false },
        { match: 'Y-%', value: true },
        { match: 'L-%', value: true },
        { match: 'I-%', value: true },
      ],
      renditionLate: [
        { match: '', value: false },
        { match: 'Y-%', value: false },
        { match: 'L-%', value: true },
        { match: 'I-%', value: true },
      ],
    },
  };

  /**
   * `t_jur_exempt.txt` lists exemptions per account per taxing unit. Only the
   * `TOT` category means the account owes nothing at all — the memo's exempt
   * hospitals and charities. Everything else (Freeport, pollution control, and
   * the blanket `PEX` grouped exemption) is partial and stays in scope.
   */
  readonly companionFiles: readonly CompanionFile[] = [
    {
      label: 'exemptions',
      patterns: [/t_jur_exempt\.txt$/i, /jur.*exempt.*\.txt$/i],
      accountColumn: 'acct',
      where: `upper(trim(CAST("exempt_cat" AS VARCHAR))) = 'TOT'`,
      fields: { isExempt: 'TRUE' },
    },
  ];

  /**
   * `t_jur_value.txt` is one row per account per taxing unit, carrying the
   * value that unit appraises. Present in every archive from 2021 on, at
   * roughly 1.5 million rows a year.
   *
   * `tax_dist` is the same three-digit code the district uses in
   * `t_jur_tax_dist_exempt_value_rate.txt`, which is where the adopted rates
   * come from — so the join between an account and its rate is a code match
   * with nothing inferred in between.
   *
   * `appraised_val` rather than `taxable_val`: taxable is net of exemptions,
   * and an account whose exemption wipes out one unit's taxable value has not
   * left that unit's jurisdiction. Using the taxable column would drop units
   * from the blend and understate the rate — and understating the rate is the
   * only direction here that flatters a finding.
   */
  readonly unitFile: UnitFile = {
    label: 'taxing units',
    patterns: [/t_jur_value\.txt$/i, /jur.*value.*\.txt$/i],
    accountColumn: 'acct',
    unitColumn: 'tax_dist',
    valueColumn: 'appraised_val',
  };

  /**
   * The account file carries its own `tax_year`, and a handful of rows per year
   * arrive corrupted with a garbage value. Trusting the column and discarding
   * disagreeing rows is safer than trusting the folder the archive landed in.
   */
  rawTransformSql(_rawTable: string, taxYear: number): string {
    return `try_cast("tax_year" AS INTEGER) = ${taxYear}`;
  }

  async discover(taxYear: number): Promise<SourceFile[]> {
    return URL_PATTERNS.map((pattern) => {
      const url = pattern.replace('{year}', String(taxYear));
      return {
        jurisdictionId: this.jurisdiction.id,
        taxYear,
        kind: 'accounts',
        url,
        fileName: `personal_${taxYear}.zip`,
        sizeBytes: null,
        checksum: null,
      };
    });
  }

  pickAccountFile(extractedPaths: string[]): string | null {
    const textFiles = extractedPaths.filter((p) => /\.(txt|csv|dat)$/i.test(p));
    if (textFiles.length === 0) return null;

    for (const pattern of ACCOUNT_FILE_PATTERNS) {
      const match = textFiles.find((p) => pattern.test(p));
      if (match) return match;
    }
    // No name match — the engine falls back to the largest file, which for a
    // personal-property archive is reliably the account roll.
    return null;
  }
}

export const hcadConnector = new HcadConnector();
