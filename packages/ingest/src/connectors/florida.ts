import type { Jurisdiction, SourceFile } from '@tangible/types';
import type { Connector, FileFormat } from '../connector.js';

/**
 * Florida tangible personal property (TPP) rolls, via the Department of Revenue.
 *
 * Florida is the first state here that does not work like Texas. Rather than 67
 * county portals with 67 file layouts, every property appraiser submits their
 * roll to the DOR, which reformats it into one statewide schema — the
 * "Name – Address – Property" (NAP) file — and republishes it as a CSV with a
 * header row. One connector class therefore serves every county, and adding a
 * county is a row in the table below.
 *
 * Two consequences of that centralization are worth knowing before reading any
 * Florida number in this app:
 *
 *  1. Only the *current* roll is posted for download. The DOR keeps NAP files
 *     back to 2002, but everything before the current year is released by
 *     public-records request only, so a Florida county shows a single year here
 *     until someone requests the back years and loads them with `--url`.
 *
 *  2. There is no filing-status field anywhere in the schema. The roll's
 *     penalty rate is the nearest thing, and whether it can be read as
 *     compliance turns out to be a per-county question rather than a Florida
 *     one — see FILING_SIGNAL_COUNTIES, which is the whole argument.
 */

const NAP_FOLDER = '/property/dataportal/Documents/PTO Data Portal/Tax Roll Data Files/NAP';

const PORTAL_URL =
  'https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx';

/**
 * Statewide stand-in for the blended millage.
 *
 * Unlike the Texas connectors, this is not a researched per-county figure.
 * Florida millage is set by each county, municipality, school board and special
 * district independently and typically lands between 15 and 22 mills; 19 is the
 * middle of that range. Every county below carries the same number and a note
 * saying so, because a made-up per-county rate would look researched.
 */
const STATEWIDE_MILLAGE = 0.019;

interface FloridaCounty {
  /** The two-digit number the DOR assigns; it keys the published file name. */
  dorCode: string;
  /** County name as we display it. */
  name: string;
  fips: string;
}

/**
 * All 67 counties, keyed by DOR county number.
 *
 * The DOR assigned these before Dade County was renamed, so its files are still
 * published as "Dade" while the county is Miami-Dade — the file lookup keys on
 * the number rather than the name for exactly this reason.
 */
const COUNTIES: readonly FloridaCounty[] = [
  { dorCode: '11', name: 'Alachua', fips: '12001' },
  { dorCode: '12', name: 'Baker', fips: '12003' },
  { dorCode: '13', name: 'Bay', fips: '12005' },
  { dorCode: '14', name: 'Bradford', fips: '12007' },
  { dorCode: '15', name: 'Brevard', fips: '12009' },
  { dorCode: '16', name: 'Broward', fips: '12011' },
  { dorCode: '17', name: 'Calhoun', fips: '12013' },
  { dorCode: '18', name: 'Charlotte', fips: '12015' },
  { dorCode: '19', name: 'Citrus', fips: '12017' },
  { dorCode: '20', name: 'Clay', fips: '12019' },
  { dorCode: '21', name: 'Collier', fips: '12021' },
  { dorCode: '22', name: 'Columbia', fips: '12023' },
  { dorCode: '23', name: 'Miami-Dade', fips: '12086' },
  { dorCode: '24', name: 'DeSoto', fips: '12027' },
  { dorCode: '25', name: 'Dixie', fips: '12029' },
  { dorCode: '26', name: 'Duval', fips: '12031' },
  { dorCode: '27', name: 'Escambia', fips: '12033' },
  { dorCode: '28', name: 'Flagler', fips: '12035' },
  { dorCode: '29', name: 'Franklin', fips: '12037' },
  { dorCode: '30', name: 'Gadsden', fips: '12039' },
  { dorCode: '31', name: 'Gilchrist', fips: '12041' },
  { dorCode: '32', name: 'Glades', fips: '12043' },
  { dorCode: '33', name: 'Gulf', fips: '12045' },
  { dorCode: '34', name: 'Hamilton', fips: '12047' },
  { dorCode: '35', name: 'Hardee', fips: '12049' },
  { dorCode: '36', name: 'Hendry', fips: '12051' },
  { dorCode: '37', name: 'Hernando', fips: '12053' },
  { dorCode: '38', name: 'Highlands', fips: '12055' },
  { dorCode: '39', name: 'Hillsborough', fips: '12057' },
  { dorCode: '40', name: 'Holmes', fips: '12059' },
  { dorCode: '41', name: 'Indian River', fips: '12061' },
  { dorCode: '42', name: 'Jackson', fips: '12063' },
  { dorCode: '43', name: 'Jefferson', fips: '12065' },
  { dorCode: '44', name: 'Lafayette', fips: '12067' },
  { dorCode: '45', name: 'Lake', fips: '12069' },
  { dorCode: '46', name: 'Lee', fips: '12071' },
  { dorCode: '47', name: 'Leon', fips: '12073' },
  { dorCode: '48', name: 'Levy', fips: '12075' },
  { dorCode: '49', name: 'Liberty', fips: '12077' },
  { dorCode: '50', name: 'Madison', fips: '12079' },
  { dorCode: '51', name: 'Manatee', fips: '12081' },
  { dorCode: '52', name: 'Marion', fips: '12083' },
  { dorCode: '53', name: 'Martin', fips: '12085' },
  { dorCode: '54', name: 'Monroe', fips: '12087' },
  { dorCode: '55', name: 'Nassau', fips: '12089' },
  { dorCode: '56', name: 'Okaloosa', fips: '12091' },
  { dorCode: '57', name: 'Okeechobee', fips: '12093' },
  { dorCode: '58', name: 'Orange', fips: '12095' },
  { dorCode: '59', name: 'Osceola', fips: '12097' },
  { dorCode: '60', name: 'Palm Beach', fips: '12099' },
  { dorCode: '61', name: 'Pasco', fips: '12101' },
  { dorCode: '62', name: 'Pinellas', fips: '12103' },
  { dorCode: '63', name: 'Polk', fips: '12105' },
  { dorCode: '64', name: 'Putnam', fips: '12107' },
  { dorCode: '65', name: 'Saint Johns', fips: '12109' },
  { dorCode: '66', name: 'Saint Lucie', fips: '12111' },
  { dorCode: '67', name: 'Santa Rosa', fips: '12113' },
  { dorCode: '68', name: 'Sarasota', fips: '12115' },
  { dorCode: '69', name: 'Seminole', fips: '12117' },
  { dorCode: '70', name: 'Sumter', fips: '12119' },
  { dorCode: '71', name: 'Suwannee', fips: '12121' },
  { dorCode: '72', name: 'Taylor', fips: '12123' },
  { dorCode: '73', name: 'Union', fips: '12125' },
  { dorCode: '74', name: 'Volusia', fips: '12127' },
  { dorCode: '75', name: 'Wakulla', fips: '12129' },
  { dorCode: '76', name: 'Walton', fips: '12131' },
  { dorCode: '77', name: 'Washington', fips: '12133' },
];

/**
 * Counties whose `PEN_RATE` column is trustworthy enough to read as filing
 * compliance.
 *
 * Florida has no filing-status field. `PEN_RATE` is the closest thing — it
 * carries the s.193.072 penalty percentage, where 25% is specifically the
 * failure-to-file penalty — but each appraiser decides whether to populate it,
 * and the spread across the state is enormous. Measured across all 67 rolls:
 * 20 counties report a penalty rate of zero on every single account, and Polk
 * reports 45.8% of its roll as penalised while placing exactly 2 accounts at
 * the 25% rate. Reading the column everywhere would rank counties by their
 * clerical conventions.
 *
 * The counties below earned their place by a two-part test, applied to the 2026
 * rolls:
 *
 *  1. At least 100 accounts at the 25% failure-to-file rate, so the signal is
 *     not a rounding error.
 *  2. That rate declines monotonically as accounts get larger, measured only
 *     over accounts that actually owe tax.
 *
 * The second is the one that matters, and it is the same test that rejected the
 * Williamson County proxy in Texas. A real non-filer population thins out at
 * the top — small businesses miss the deadline, large ones have accountants —
 * while an artifact of the filing system does not. All ten pass it clearly:
 * Palm Beach runs 27.0% / 9.6% / 3.9% across the value bands, Lee 17.0% /
 * 10.2% / 3.0%.
 *
 * Restricting to taxable accounts is not a nicety. The penalty is a percentage
 * of the tax levied, so an account under the $25,000 exemption owes nothing and
 * is therefore penalised nothing whether or not it filed. Leaving those in made
 * every county look flat or inverted and nearly caused this whole signal to be
 * thrown away.
 */
const FILING_SIGNAL_COUNTIES: ReadonlySet<string> = new Set([
  'Palm Beach',
  'Manatee',
  'Escambia',
  'Lee',
  'Lake',
  'Pasco',
  'Charlotte',
  'Sumter',
  'Putnam',
  'Citrus',
]);

function hasFilingSignal(county: FloridaCounty): boolean {
  return FILING_SIGNAL_COUNTIES.has(county.name);
}

/**
 * Caveats. Most are properties of the DOR's format and true of every county;
 * the first depends on whether this county's penalty column survived the test
 * above, because that changes what the numbers on the page mean.
 */
function dataNotesFor(county: FloridaCounty): string[] {
  const filing = hasFilingSignal(county)
    ? "Florida publishes no filing-status field. Non-filers here are inferred from the roll's penalty rate (PEN_RATE), where 25% is the s.193.072 penalty for failing to file — this is one of ten counties whose penalty column is populated consistently enough to read that way. Two limits: the rate cannot distinguish a business that never filed from one that filed five or more months late, since late filing accrues 5% a month to the same 25% ceiling, and it says nothing about accounts below the $25,000 exemption, which are penalised nothing either way and are left as unknown rather than counted as compliant."
    : "Florida publishes no filing-status field, so non-filer segments are empty here by design rather than zero. The roll's penalty rate (PEN_RATE) is the only candidate and this county does not populate it consistently — across the state 20 counties report zero penalised accounts on every record, and Polk reports 45.8% penalised while placing 2 accounts at the failure-to-file rate. It is deliberately not read as compliance here.";

  return [
    filing,
    'The Department of Revenue posts only the current roll for download; earlier years are released by public-records request. Unless the back years have been requested and loaded by hand, this county has a single year of data and no trend.',
    'Values are the preliminary roll submitted on 1 July, before the value adjustment board rules on appeals. Final certified values move down, not up.',
    'Florida has no equivalent of the Texas state class code, so class-based segments are blank. NAICS is loaded instead and is the way to slice Florida by industry.',
    `Tax at risk uses a statewide 19-mill approximation rather than the millage ${county.name} County actually levies, which this file does not carry. Treat the dollar figures as an order of magnitude.`,
  ];
}

function jurisdictionFor(county: FloridaCounty): Jurisdiction {
  return {
    id: `fl-${county.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name: `${county.name} County`,
    // Florida has no appraisal-district code; the DOR county number is the
    // stable identifier that appears in the file names and in the roll itself.
    cadCode: `FL-${county.dorCode}`,
    state: 'FL',
    county: county.name,
    fips: county.fips,
    connectorId: `fl-dor-${county.dorCode}`,
    blendedTaxRate: STATEWIDE_MILLAGE,
    availableYears: [],
    homepageUrl: 'https://floridarevenue.com/property',
    dataPortalUrl: PORTAL_URL,
    dataNotes: dataNotesFor(county),
  };
}

interface SharePointListing {
  value?: { Name?: string }[];
}

/**
 * Folder listings, memoized for the life of the process.
 *
 * All 67 counties live in the same handful of folders, so without this a run
 * across the state asks the portal for the identical listing 67 times per year
 * — around 800 requests to learn 12 distinct answers. The promise is cached
 * rather than the result so concurrent callers share one request.
 *
 * Safe to hold for a whole run: the DOR publishes a roll once and does not
 * revise it mid-session, and a single ingest is minutes rather than days.
 */
const folderCache = new Map<string, Promise<string[]>>();

/**
 * Ask the portal what is actually in a folder.
 *
 * The published file names are not derivable. They mostly follow
 * `<County> <NN> Preliminary TPP <YYYY>.zip`, but a dozen of them carry a
 * stray double space in a different position each time — "Duval 26 Preliminary
 * TPP  2026.zip", "Polk 63  Preliminary TPP 2026.zip" — so constructing the
 * name guesses wrong for whichever counties the DOR happened to fat-finger.
 * Listing the folder and matching on the county number sidesteps all of it.
 */
function listFolder(folder: string): Promise<string[]> {
  const cached = folderCache.get(folder);
  if (cached) return cached;

  const url =
    `https://floridarevenue.com/property/dataportal/_api/web/` +
    `GetFolderByServerRelativeUrl('${encodeURIComponent(folder)}')/Files?$select=Name`;

  const pending = (async () => {
    const response = await fetch(url, {
      headers: { Accept: 'application/json;odata=nometadata' },
    });
    // A missing folder is the normal answer for a year the DOR has not posted,
    // and it is worth caching too — otherwise every county re-asks about 2021.
    if (!response.ok) return [];
    const body = (await response.json()) as SharePointListing;
    return (body.value ?? []).map((f) => f.Name ?? '').filter(Boolean);
  })();

  // A rejected lookup must not be cached, or one network blip poisons the whole
  // run for that folder.
  folderCache.set(
    folder,
    pending.catch((error) => {
      folderCache.delete(folder);
      throw error;
    }),
  );
  return folderCache.get(folder)!;
}

export class FloridaConnector implements Connector {
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  private readonly county: FloridaCounty;
  /** Whether this county's `PEN_RATE` is read as filing compliance. */
  readonly filingSignal: boolean;

  constructor(county: FloridaCounty) {
    this.county = county;
    this.jurisdiction = jurisdictionFor(county);
    this.id = this.jurisdiction.connectorId;
    this.filingSignal = hasFilingSignal(county);
    // Built after the flag is set: the filing expressions branch on it.
    this.format = this.buildFormat();
  }

  /**
   * Pinned against the real 2026 NAP files rather than alias-matched.
   *
   * The DOR's own user guide is a field-by-field spec, and the published
   * headers do not quite match it — the guide calls field 16 `OWN_NAME` and the
   * file says `OWN_NAM`, likewise `PHY_ZIP` against `PHY_ZIPCD`. The names below
   * are the ones in the files.
   */
  readonly format: FileFormat;

  private buildFormat(): FileFormat {
    return {
      delimiter: ',',
      hasHeader: true,
      // Verified across Glades, Duval and Hillsborough 2026: the only bytes above
      // 0x7F in nine megabytes of Hillsborough are valid UTF-8 sequences, and the
      // other two files are pure ASCII.
      encoding: 'utf-8',
      quote: '"',
      escape: '"',

      defaultLayout: {
        accountId: 'ACCT_ID',
        ownerName: 'OWN_NAM',
        // Where the property physically sits, which for TPP is the business
        // location rather than the owner's mailing address.
        siteAddress: 'PHY_ADDR',
        siteCity: 'PHY_CITY',
        siteZip: 'PHY_ZIPCD',
        mailAddress: 'OWN_ADDR',
        mailCity: 'OWN_CITY',
        mailState: 'OWN_STATE',
        mailZip: 'OWN_ZIPCD',
        businessCode: 'NAICS_CD',
        // Florida's value ladder is just → assessed → taxable. `JV_TOTAL` is the
        // market figure and `AV_TOTAL` is assessed before exemptions come off,
        // which is the number the exemption test wants; `TAX_VAL` is deliberately
        // not loaded, because it is already net of the $25,000 exemption that the
        // analysis applies itself.
        marketValue: 'JV_TOTAL',
        appraisedValue: 'JV_TOTAL',
        assessedValue: 'AV_TOTAL',
      },

      expressions: {
        /**
         * Filing status, where this county's penalty column earns the reading.
         * See FILING_SIGNAL_COUNTIES for the test; everywhere else these stay
         * NULL, which reads as "this county does not say" rather than as a roll
         * of compliant businesses.
         *
         * The `TAX_VAL > 0` guard is load-bearing. The penalty is a percentage of
         * the tax levied, so an account under the $25,000 exemption is penalised
         * nothing whether it filed or not — a zero penalty there is the absence
         * of a lever, not evidence of compliance. Those accounts are left unknown,
         * which keeps them out of the filing rate entirely instead of padding it
         * with businesses whose status was never recorded.
         */
        renditionFiled: this.filingSignal
          ? () => `CASE
                   WHEN try_cast("TAX_VAL" AS DOUBLE) IS NULL
                     OR try_cast("TAX_VAL" AS DOUBLE) <= 0 THEN NULL
                   WHEN try_cast("PEN_RATE" AS DOUBLE) = 25 THEN FALSE
                   ELSE TRUE
                 END`
          : () => 'NULL',

        /**
         * Anything penalised but short of the 25% ceiling was filed late or filed
         * wrong — 5% a month under s.193.072(1)(b), or 15% for property left off
         * a return that was otherwise submitted. Both filed something and both
         * are penalty-exposed, which is the same reading Harris County's
         * `I-Invalid Rendition` gets.
         */
        renditionLate: this.filingSignal
          ? () => `CASE
                   WHEN try_cast("TAX_VAL" AS DOUBLE) IS NULL
                     OR try_cast("TAX_VAL" AS DOUBLE) <= 0 THEN NULL
                   WHEN coalesce(try_cast("PEN_RATE" AS DOUBLE), 0) BETWEEN 1 AND 24 THEN TRUE
                   ELSE FALSE
                 END`
          : () => 'NULL',

        /**
         * Left unknown even where the rate is trusted. `PEN_RATE` is a
         * percentage and this column is a dollar amount everywhere else in the
         * warehouse; the exposure figures are modelled from the statutory rate
         * downstream, so storing a 25 here would only wait to be summed as money.
         */
        renditionPenalty: () => 'NULL',

        /**
         * `EXMPT` is a semicolon-delimited list of code/value pairs, e.g.
         * `A;90000; M;25000`. Only `M` — the $25,000 exemption every account gets
         * — is generic; the rest are institutional, governmental or charitable
         * and mean the account is genuinely off the tax base.
         *
         * Matching on "a code that is not M" rather than on a zero taxable value
         * matters: the great majority of Florida TPP accounts are worth less than
         * $25,000 and so have a taxable value of zero while being ordinary small
         * businesses, not exempt organizations.
         */
        isExempt: () =>
          `regexp_matches(upper(coalesce(CAST("EXMPT" AS VARCHAR), '')), '(^|; *)[A-LN-T];')`,
      },
    };
  }

  /**
   * Locate this county's archive in whichever roll folders the DOR has posted.
   *
   * Preliminary and final submissions live in sibling `<year>P` and `<year>F`
   * folders. Final is preferred when both exist — it incorporates the value
   * adjustment board's rulings — but in practice only the current preliminary
   * roll is up.
   */
  async discover(taxYear: number): Promise<SourceFile[]> {
    const sources: SourceFile[] = [];

    for (const suffix of ['F', 'P']) {
      const folder = `${NAP_FOLDER}/${taxYear}${suffix}`;
      let names: string[];
      try {
        names = await listFolder(folder);
      } catch {
        continue;
      }

      // Match on " <dorCode> " — the county number is the one token in the file
      // name the DOR is consistent about.
      const match = names.find((name) =>
        new RegExp(`(^|\\s)${this.county.dorCode}(\\s|_)`).test(name),
      );
      if (!match) continue;

      sources.push({
        jurisdictionId: this.jurisdiction.id,
        taxYear,
        kind: 'accounts',
        url: `https://floridarevenue.com${encodeURI(folder)}/${encodeURIComponent(match)}`,
        fileName: `nap_${taxYear}.zip`,
        sizeBytes: null,
        checksum: null,
      });
    }

    return sources;
  }

  pickAccountFile(extractedPaths: string[]): string | null {
    // The archive holds exactly one CSV, named NAP<county><submission><year><seq>.
    const napFile = extractedPaths.find((p) =>
      new RegExp(`NAP${this.county.dorCode}[PF]?\\d*\\.csv$`, 'i').test(p),
    );
    return napFile ?? extractedPaths.find((p) => /\.csv$/i.test(p)) ?? null;
  }

  /**
   * The roll carries its own assessment year and its own county number. Both
   * are checked: a mis-filed archive on the portal would otherwise load one
   * county's accounts under another county's name.
   */
  rawTransformSql(_rawTable: string, taxYear: number): string {
    return (
      `try_cast("ASMNT_YR" AS INTEGER) = ${taxYear} ` +
      `AND try_cast("CO_NO" AS INTEGER) = ${Number(this.county.dorCode)}`
    );
  }
}

export const floridaConnectors: readonly FloridaConnector[] = COUNTIES.map(
  (county) => new FloridaConnector(county),
);
