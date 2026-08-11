import type { Jurisdiction, SourceFile } from '@tangible/types';
import type { CompanionFile, Connector, FileFormat } from '../connector.js';

export const TARRANT_COUNTY: Jurisdiction = {
  id: 'tx-tarrant',
  name: 'Tarrant County',
  cadCode: 'TAD',
  state: 'TX',
  county: 'Tarrant',
  fips: '48439',
  connectorId: 'tad',
  blendedTaxRate: 0.025,
  availableYears: [],
  homepageUrl: 'https://www.tad.org',
  dataPortalUrl: 'https://www.tad.org/resources/data-downloads',
  dataNotes: [
    'Tarrant publishes no rendition or filing status, so non-filer segments are empty here by design rather than zero. This county contributes market size, value trends and frozen-value signal only.',
    'The main file carries no exemption codes, so fully exempt accounts are not screened out of the taxable count.',
    'Tax agent and situs city come from the separate Supplemental file. Load it alongside the main roll or both stay unknown; the 2026 roll has no supplemental published yet.',
  ],
};

/**
 * Tarrant County — manual acquisition.
 *
 * TAD publishes pipe-delimited PropertyData files but serves them to people
 * rather than scripts, so there is no discovery step here. Download the
 * Personal Property files from the portal and point the ingester at each one:
 *
 *   pnpm ingest --jurisdiction tx-tarrant --years 2025,2026 \
 *     --url "2025=$HOME/Downloads/PropertyData_P_2025(Certified).ZIP" \
 *     --url "2026=$HOME/Downloads/PropertyData(Delimited)_P.ZIP"
 *
 * Everything after acquisition is identical to any other county.
 */
export class TadConnector implements Connector {
  readonly id = 'tad';
  readonly jurisdiction = TARRANT_COUNTY;

  readonly format: FileFormat = {
    delimiter: '|',
    hasHeader: true,
    encoding: 'utf-8',
    // Bare quotes appear inside address fields; the pipe delimiter cannot occur
    // in the data, so quoting is not needed and only causes damage.
    quote: '',
    escape: '',

    /**
     * Pinned against the real 2021–2026 files. The current-year "Delimited"
     * export adds two building-area columns at the end; because resolution is by
     * header name rather than position, both layouts load unchanged.
     */
    defaultLayout: {
      accountId: 'Account_Num',
      ownerName: 'Owner_Name',
      siteAddress: 'Situs_Address',
      mailAddress: 'Owner_Address',
      mailZip: 'Owner_Zip',
      // Property_Class and State_Use_Code carry identical values; either works.
      // Codes are L1 / L1C / L2 / S / J4C and so on, which prefix-match the
      // standard Texas groups.
      stateClass: 'State_Use_Code',
      assessedValue: 'Total_Value',
      appraisedValue: 'Appraised_Value',
    },

    expressions: {
      /** Owner_CityState is a single "CITY ,  ST" field with padding. */
      mailCity: () =>
        `nullif(trim(split_part(CAST("Owner_CityState" AS VARCHAR), ',', 1)), '')`,
      mailState: () =>
        `nullif(trim(split_part(CAST("Owner_CityState" AS VARCHAR), ',', 2)), '')`,

      /**
       * None of these are published in the personal property file. Left
       * explicitly unknown so Tarrant contributes no filing signal at all
       * rather than a false one, and so no account is silently treated as
       * having an agent or an exemption it may well have.
       */
      renditionFiled: () => 'NULL',
      renditionLate: () => 'NULL',
      isExempt: () => 'NULL',
    },
  };

  /**
   * TAD splits personal property across two archives: the main roll and a
   * Supplemental file carrying the tax agent, situs city and NAICS code. Both
   * are passed with `--url` for the same year and unpacked together.
   */
  readonly companionFiles: readonly CompanionFile[] = [
    {
      label: 'supplemental',
      patterns: [/PropertyDataSupplemental.*\.txt$/i, /supplemental.*\.txt$/i],
      accountColumn: 'AccountNumber',
      fields: {
        // 25% of accounts carry an agent — Ryan LLC, Altus, Grant Thornton and
        // the rest of the protest firms. This is what makes the agent-screening
        // half of the ICP definition work for Tarrant.
        agentName: `nullif(trim(CAST("AgentName" AS VARCHAR)), '')`,
        // The main roll publishes only the owner's mailing city.
        siteCity: `upper(nullif(trim(CAST("SitusCity" AS VARCHAR)), ''))`,
        // NAICS, which is more useful than the SIC codes other districts carry.
        businessCode: `nullif(trim(CAST("NAICSCd" AS VARCHAR)), '')`,
      },
    },
  ];

  /**
   * Deliberately empty. The engine then reports that a source must be supplied
   * with `--url`, which is the supported route for this county.
   */
  async discover(_taxYear: number): Promise<SourceFile[]> {
    return [];
  }

  pickAccountFile(extractedPaths: string[]): string | null {
    // Both archives unpack to `PropertyData*_P*.txt`, so the supplemental has to
    // be excluded explicitly or it would be mistaken for the account roll.
    const candidates = extractedPaths.filter(
      (p) => /\.txt$/i.test(p) && !/supplemental/i.test(p),
    );
    return candidates.find((p) => /propertydata.*_p/i.test(p)) ?? candidates[0] ?? null;
  }

  /** Every file carries its appraisal year; trust it over the filename. */
  rawTransformSql(_rawTable: string, taxYear: number): string {
    return `try_cast("Appraisal_Year" AS INTEGER) = ${taxYear}`;
  }
}

export const tadConnector = new TadConnector();
