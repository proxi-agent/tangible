import type { Jurisdiction, SourceFile } from '@tangible/types';
import type { Connector, FileFormat } from '../connector.js';

export const COLLIN_COUNTY: Jurisdiction = {
  id: 'tx-collin',
  name: 'Collin County',
  cadCode: 'CCAD',
  state: 'TX',
  county: 'Collin',
  fips: '48085',
  connectorId: 'ccad',
  blendedTaxRate: 0.025,
  availableYears: [],
  homepageUrl: 'https://collincad.org',
  dataPortalUrl: 'https://data.texas.gov/browse?q=Collin%20CAD',
  dataNotes: [
    'Collin publishes no rendition or filing status, so non-filer segments are empty here by design rather than zero. This county contributes market size, value trends and frozen-value signal only.',
    'The published rolls run 2020–2025; there is no 2026 file yet, so Collin does not show the post-HB 9 exemption change that Harris and Dallas do.',
  ],
};

/**
 * Collin publishes through the state open-data portal rather than its own site,
 * one dataset per tax year. Each is queried with a filter so only business
 * personal property crosses the wire — about 37K rows instead of 480K.
 */
const DATASET_BY_YEAR: Readonly<Record<number, string>> = {
  2020: 'hkzz-rrn8',
  2021: 'cwex-zmku',
  2022: 'vtby-uz4n',
  2023: 'khef-anha',
  2024: '6dqt-e958',
  2025: 'vffy-snc6',
};

/** Comfortably above the ~38K personal-property rows in the largest year. */
const ROW_LIMIT = 200_000;

export class CollinConnector implements Connector {
  readonly id = 'ccad';
  readonly jurisdiction = COLLIN_COUNTY;

  readonly format: FileFormat = {
    delimiter: ',',
    hasHeader: true,
    encoding: 'utf-8',
    quote: '"',
    escape: '"',

    defaultLayout: {
      accountId: 'propid',
      ownerName: 'ownername',
      siteAddress: 'situsconcatshort',
      siteCity: 'situscity',
      siteZip: 'situszip',
      mailAddress: 'owneraddrline1',
      mailCity: 'owneraddrcity',
      mailState: 'owneraddrstate',
      mailZip: 'owneraddrzip',
      // Plain Texas state class codes — L1, L2, J4 — no trailing digit here.
      stateClass: 'propcategorycode',
      businessCode: 'propsubtype',
      // Appraised value before exemptions, matching the other connectors.
      appraisedValue: 'currvalappraised',
      assessedValue: 'currvalassessed',
    },

    expressions: {
      /**
       * Exemption codes are a comma-separated list. Only the `EX` family is a
       * full exemption; Freeport, pollution control and solar are partial and
       * stay in scope.
       */
      isExempt: () => `upper(coalesce(CAST("exemptcodes" AS VARCHAR), '')) LIKE 'EX%'`,

      /**
       * Not published. Left unknown so Collin contributes no non-filer signal
       * at all rather than a false one — every account here would otherwise
       * read as having failed to render.
       */
      renditionFiled: () => 'NULL',
      renditionLate: () => 'NULL',
    },
  };

  async discover(taxYear: number): Promise<SourceFile[]> {
    const datasetId = DATASET_BY_YEAR[taxYear];
    if (!datasetId) return [];

    const query = new URLSearchParams({
      $where: "proptype='Personal'",
      $limit: String(ROW_LIMIT),
    });

    return [
      {
        jurisdictionId: this.jurisdiction.id,
        taxYear,
        kind: 'accounts',
        url: `https://data.texas.gov/resource/${datasetId}.csv?${query}`,
        fileName: `bpp_${taxYear}.csv`,
        sizeBytes: null,
        checksum: null,
      },
    ];
  }

  pickAccountFile(extractedPaths: string[]): string | null {
    return extractedPaths.find((p) => /\.csv$/i.test(p)) ?? null;
  }

  rawTransformSql(_rawTable: string, taxYear: number): string {
    return `try_cast("propyear" AS INTEGER) = ${taxYear}`;
  }
}

export const collinConnector = new CollinConnector();
