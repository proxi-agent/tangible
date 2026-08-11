import { exemptionForYear, type Jurisdiction, type SourceFile } from '@tangible/types';
import type { Connector, FileFormat } from '../connector.js';

export const DALLAS_COUNTY: Jurisdiction = {
  id: 'tx-dallas',
  name: 'Dallas County',
  cadCode: 'DCAD',
  state: 'TX',
  county: 'Dallas',
  fips: '48113',
  connectorId: 'dcad',
  blendedTaxRate: 0.025,
  availableYears: [],
  homepageUrl: 'https://www.dallascad.org',
  dataPortalUrl: 'https://www.dallascad.org/dataproducts.aspx',
  dataNotes: [
    'DCAD publishes no late-filing indicator, so penalty exposure here counts only accounts that did not render at all. Treat it as a floor — Harris shows late filers adding roughly a third again on top.',
    'BPP detail files go back to 2022, so trend and chronic-non-filer analysis has a shorter window than Harris.',
  ],
};

/**
 * DCAD serves its data products through an ASP.NET file handler whose `id`
 * parameter is a UNC path on their file server. The path has to be URL-encoded,
 * backslashes and all.
 */
const DATA_PRODUCT_PATH = '\\\\DCAD.ORG\\WEB\\WEBDATA\\WEBFORMS\\DATA PRODUCTS\\';

function dataProductUrl(fileName: string): string {
  const id = encodeURIComponent(`${DATA_PRODUCT_PATH}${fileName}`);
  return `https://www.dallascad.org/ViewPDFs.aspx?type=3&id=${id}`;
}

/**
 * Dallas County business personal property.
 *
 * A single comma-delimited CSV per tax year, properly quoted, one row per
 * account. Richer than Harris in one respect — it breaks value out by asset
 * category (inventory, furniture, machinery, computers, vehicles) — and poorer
 * in another: there is no late-filing flag.
 */
export class DcadConnector implements Connector {
  readonly id = 'dcad';
  readonly jurisdiction = DALLAS_COUNTY;

  readonly format: FileFormat = {
    delimiter: ',',
    hasHeader: true,
    encoding: 'utf-8',
    // Properly quoted CSV — unlike the tab-delimited dumps, quoting must stay on
    // or a comma inside an owner name splits the row.
    quote: '"',
    escape: '"',

    defaultLayout: {
      accountId: 'ACCOUNT_NUM',
      ownerName: 'OWNER_NAME',
      siteCity: 'CITY',
      mailAddress: 'MAIL_ADDRESS1',
      mailCity: 'MAIL_CITY',
      mailState: 'MAIL_STATE',
      mailZip: 'MAIL_ZIP',
      // L10 / L20 / S10 / J*0 — the same state classes as Harris with a
      // trailing digit, which the prefix matching already handles.
      stateClass: 'PROPERTY_CLASS',
      businessCode: 'BUSINESS_TYPE',
      // Total value before exemptions, the analogue of Harris's asd_val.
      assessedValue: 'TOT_VAL_CURRENT',
      renditionFiled: 'RENDERED_CURRENT',
      agentName: 'TAX_CONSULTANT',
    },

    expressions: {
      /**
       * A zero county-taxable value on an account whose total value clears that
       * year's exemption is the signature of a full exemption. Testing against
       * the threshold matters: without it every account below the exemption
       * would be misread as an exempt charity.
       */
      isExempt: (taxYear) =>
        `try_cast("TOT_VAL_CURRENT" AS DOUBLE) >= ${exemptionForYear(taxYear)}
         AND coalesce(try_cast("CNTY_TAXABLE_VAL_CURRENT" AS DOUBLE), 0) = 0`,

      /** The consultant field holds an id; '0' and blank both mean nobody. */
      agentName: () =>
        `nullif(nullif(trim(CAST("TAX_CONSULTANT" AS VARCHAR)), ''), '0')`,

      /**
       * Not published. Left explicitly unknown rather than FALSE so late filers
       * are absent from the penalty base instead of being counted as compliant.
       */
      renditionLate: () => 'NULL',
    },
  };

  async discover(taxYear: number): Promise<SourceFile[]> {
    // The "CURRENT" file is refreshed through the year; the certified snapshot
    // is frozen at certification. Current is the better basis for outreach.
    const names = [
      `DCAD${taxYear}_BPP_DETAIL_CURRENT.zip`,
      `DCAD${taxYear}_BPP_DETAIL_CURRENT.ZIP`,
    ];

    return names.map((fileName) => ({
      jurisdictionId: this.jurisdiction.id,
      taxYear,
      kind: 'accounts',
      url: dataProductUrl(fileName),
      fileName: `bpp_${taxYear}.zip`,
      sizeBytes: null,
      checksum: null,
    }));
  }

  pickAccountFile(extractedPaths: string[]): string | null {
    return extractedPaths.find((p) => /BPP_DETAIL.*\.csv$/i.test(p)) ?? null;
  }

  /** The file carries its own appraisal year; trust it over the folder name. */
  rawTransformSql(_rawTable: string, taxYear: number): string {
    return `try_cast("APPRAISAL_YR" AS INTEGER) = ${taxYear}`;
  }
}

export const dcadConnector = new DcadConnector();
