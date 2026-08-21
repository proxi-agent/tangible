/**
 * What has changed since the last return went out.
 *
 * The filing record has been an output for as long as it has existed: the app
 * builds a rendition, freezes it, and never reads it again. That closes the
 * wrong loop. A firm's second season with a client is where the margin is, and
 * the whole of what makes it cheap — what we swore to last year, and which
 * pieces of property it covered — is sitting in a column nothing consumes.
 *
 * So this is the subtraction: last season's returns against this season's
 * register, at the level of individual assets, which is the one comparison the
 * paper cannot do. A district reading the two renditions side by side sees two
 * totals. We can see that asset 4471 was on last year's and is not on this
 * year's book at all, and that asset 6620 has been owned since 2019 and has
 * never been on a return.
 *
 * **The one claim this file is careful about.** A filing freezes `assetIds`,
 * and that list is the slice of the register the form was *built from* — not
 * what landed on its schedules. The rendition then sets part of the slice
 * aside: disposed before January 1, intangible, removed by an accepted
 * finding. Those decisions are recorded, defensible, and none of this file's
 * business. So membership here is read the only way it can honestly be read:
 * an asset in the slice was *considered* for that return, and an asset outside
 * it was never on that return at all. Everything below says "considered" where
 * that is what it means, and the omission finding is worded against the return
 * rather than against its schedules, because that is the part we can prove.
 *
 * **And the claim it refuses to make.** Property is rendered per site, so
 * "never rendered" is only sayable about a site whose return we actually hold.
 * A client with two locations where one return was filed through this app has a
 * second location this file knows nothing about — and the first version of it
 * called that entire second site omitted property, which is an accusation built
 * out of our own missing records. Coverage is therefore computed per site
 * before any verdict is reached, and an asset at a site with no return on file
 * gets told apart from an asset at a site whose return demonstrably left it
 * out. One of those is a finding; the other is a gap in the filing cabinet.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A return as the filing record froze it. */
export interface PriorReturn {
  locationId: string;
  locationLabel: string;
  accountId: string | null;
  taxYear: number;
  /** 'filed' | 'superseded' | 'void'. Only 'filed' is compared against. */
  status: string;
  filedOn: string;
  /** The register slice the form was built from. See the note above. */
  assetIds: string[];
  /** What the schedules reported — fewer than `assetIds` where property was set aside. */
  assetCount: number;
  totalHistoricalCost: number;
}

/**
 * A rendition the client filed themselves, uploaded and read by the priors
 * pipeline.
 *
 * Second-best evidence, and the difference matters: a rendition reports in
 * aggregate and never names an asset, so this proves a return covered the site
 * without proving anything about a single piece of property. It is enough to
 * withdraw the omission claim and not enough to replace it, which is exactly
 * how it is used. The line-level comparison against these documents already
 * exists on the priors screen; `documentId` is here so a reader can be sent
 * there rather than told the same thing twice in two voices.
 */
export interface PriorEvidence {
  locationId: string;
  locationLabel: string;
  documentId: string;
  taxYear: number;
  statedTotal: number | null;
}

/** An asset, as this season's register carries it or as we last saw it. */
export interface CarriedAsset {
  id: string;
  assetTag: string | null;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  disposalDate: string | null;
  /** Where the situs layer has placed it, or null where nothing has. */
  locationId: string | null;
}

/** A site the client has, so one with no return on file can still be named. */
export interface SiteRef {
  id: string;
  label: string;
}

export interface CarryForwardInput {
  /** The season being prepared. */
  taxYear: number;
  /** Every return on file for this client, any year. Filtered here, not by the caller. */
  returns: PriorReturn[];
  /** Every accepted prior rendition matched to a site, any year. Also filtered here. */
  priors?: PriorEvidence[];
  /**
   * The client's sites. Only used for names, and only reachable for a site with
   * nothing on file — the returns and documents carry their own labels. Without
   * it a site with no prior return is the one this file most needs to name and
   * the one it cannot, so the finding would read "nothing was compared for This
   * site" at exactly the moment a reader needs to know which one.
   */
  sites?: SiteRef[];
  /** Current assets on this season's register. */
  register: CarriedAsset[];
  /**
   * Assets the client's graph knows about that this season's register does not
   * carry, as we last saw them. Optional, and the reason the dropped lines have
   * figures at all: the filing froze ids, not costs, so without this a return's
   * vanished property could be counted and not described.
   */
  absent?: CarriedAsset[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const CARRY_VERDICTS = [
  'carried',
  'acquired',
  'omitted',
  'undated',
  'aggregate',
  'uncompared',
  'dropped',
] as const;
export type CarryVerdict = (typeof CARRY_VERDICTS)[number];

/** What we hold about one site's prior season, which decides what can be said. */
export const COVERAGE = ['itemized', 'aggregate', 'none'] as const;
export type Coverage = (typeof COVERAGE)[number];

export interface SiteCoverage {
  /** Null for property the situs layer has not placed anywhere. */
  locationId: string | null;
  label: string;
  evidence: Coverage;
  /** The uploaded prior rendition, where that is what the evidence is. */
  documentId: string | null;
  assetCount: number;
  cost: number;
}

export interface CarryLine {
  assetId: string;
  assetTag: string | null;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  verdict: CarryVerdict;
}

export interface CarryGroup {
  verdict: CarryVerdict;
  count: number;
  /** Summed original cost. Assets with no cost contribute nothing and are counted. */
  cost: number;
  /** How many of the counted assets carried no cost, so the total can be read honestly. */
  costless: number;
  /**
   * The first few, for a reader. Capped deliberately, and nothing is ever
   * derived from it — every number above is over the whole group.
   */
  sample: CarryLine[];
}

export const CARRY_SEVERITIES = ['critical', 'warning', 'note'] as const;
export type CarrySeverity = (typeof CARRY_SEVERITIES)[number];

export interface CarryFinding {
  key: string;
  severity: CarrySeverity;
  headline: string;
  detail: string;
  count: number;
  cost: number;
}

export interface CarryForward {
  taxYear: number;
  /** The most recent year we hold any evidence for, or null on a first season. */
  priorYear: number | null;
  /** The returns compared against, in site order. */
  returns: Array<Omit<PriorReturn, 'assetIds' | 'status'>>;
  /** Every site this year's property sits at, and what we hold about its prior season. */
  coverage: SiteCoverage[];
  /** Distinct assets those returns were built from. */
  consideredCount: number;
  registerCount: number;
  registerCost: number;
  groups: CarryGroup[];
  findings: CarryFinding[];
}

/** How many lines of each group are carried for display. */
const SAMPLE = 12;

/** Where the situs layer has placed nothing. Keyed so it groups like a site. */
const UNPLACED = ' unplaced';

// ---------------------------------------------------------------------------

export function carryForward(input: CarryForwardInput): CarryForward {
  const { taxYear, register } = input;
  const registerCost = register.reduce((sum, asset) => sum + (asset.originalCost ?? 0), 0);

  // The standing returns from a season before this one. Voided and superseded
  // rows are records of what did *not* end up going out, and reading membership
  // off one would compare against a return the district never got.
  const standing = input.returns.filter((one) => one.status === 'filed' && one.taxYear < taxYear);
  const uploaded = (input.priors ?? []).filter((one) => one.taxYear < taxYear);

  // The most recent year we hold anything for, from either kind of evidence. A
  // client who came to us with last year's rendition in hand has a prior season
  // even though we filed none of it, and picking the year off our own filings
  // alone would report a first season to a firm holding the document.
  const priorYear = [...standing, ...uploaded].reduce<number | null>(
    (latest, one) => (latest === null || one.taxYear > latest ? one.taxYear : latest),
    null,
  );

  if (priorYear === null) {
    return {
      taxYear,
      priorYear: null,
      returns: [],
      coverage: [],
      consideredCount: 0,
      registerCount: register.length,
      registerCost,
      groups: [],
      findings: [],
    };
  }

  const compared = standing
    .filter((one) => one.taxYear === priorYear)
    .sort((a, b) => a.locationLabel.localeCompare(b.locationLabel));
  const documents = uploaded.filter((one) => one.taxYear === priorYear);

  // What we can say about each site, decided before any asset is looked at.
  // Our own filing beats the client's uploaded copy where we hold both: it
  // names the property, and the document does not.
  const evidence = new Map<
    string,
    { evidence: Coverage; documentId: string | null; label: string }
  >();
  for (const one of documents) {
    evidence.set(one.locationId, {
      evidence: 'aggregate',
      documentId: one.documentId,
      label: one.locationLabel,
    });
  }
  for (const one of compared) {
    evidence.set(one.locationId, {
      evidence: 'itemized',
      documentId: null,
      label: one.locationLabel,
    });
  }

  // Across every site, not per return. An asset that moved from one site to
  // another between seasons was rendered — comparing site by site would report
  // it as both dropped from one return and omitted from the other, which is two
  // false findings out of one true move.
  const considered = new Set(compared.flatMap((one) => one.assetIds));

  const lines: CarryLine[] = register.map((asset) => ({
    assetId: asset.id,
    assetTag: asset.assetTag,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    isDisposed: asset.isDisposed,
    verdict: verdictFor(asset, considered, priorYear, coverageOf(asset, evidence)),
  }));

  // Everything last season's returns were built from that this season's register
  // has no row for. Described from the graph's last sighting where we have one,
  // because the filing froze ids and nothing else about them.
  const onRegister = new Set(register.map((asset) => asset.id));
  const lastSeen = new Map((input.absent ?? []).map((asset) => [asset.id, asset]));
  const dropped: CarryLine[] = [...considered]
    .filter((id) => !onRegister.has(id))
    .map((id) => {
      const seen = lastSeen.get(id);
      return {
        assetId: id,
        assetTag: seen?.assetTag ?? null,
        description: seen?.description ?? null,
        acquisitionYear: seen?.acquisitionYear ?? null,
        originalCost: seen?.originalCost ?? null,
        isDisposed: seen?.isDisposed ?? false,
        verdict: 'dropped' as const,
      };
    })
    .sort(byCost);

  const groups = CARRY_VERDICTS.map((verdict) =>
    group(
      verdict,
      verdict === 'dropped' ? dropped : lines.filter((line) => line.verdict === verdict),
    ),
  ).filter((one) => one.count > 0);

  const labels = new Map<string, string>((input.sites ?? []).map((one) => [one.id, one.label]));
  for (const [id, held] of evidence) labels.set(id, held.label);
  const coverage = coverageOfRegister(register, evidence, labels);
  return {
    taxYear,
    priorYear,
    returns: compared.map(({ assetIds: _ids, status: _status, ...rest }) => rest),
    coverage,
    consideredCount: considered.size,
    registerCount: register.length,
    registerCost,
    groups,
    findings: findingsFor(groups, lines, coverage, priorYear, taxYear, compared),
  };
}

function coverageOf(asset: CarriedAsset, evidence: Map<string, { evidence: Coverage }>): Coverage {
  if (asset.locationId === null) return 'none';
  return evidence.get(asset.locationId)?.evidence ?? 'none';
}

/**
 * Which side of the prior lien date an unrendered asset falls, and whether we
 * are entitled to ask the question at all.
 *
 * Acquisition is tested before coverage because it settles the asset outright:
 * a rendition states what the owner held on January 1 of its tax year, so an
 * asset bought during the prior year was never renderable on the prior return
 * and its absence is arithmetic, not a defect — true whatever we hold about the
 * site. After that, coverage decides what is sayable. Only at a site whose
 * return we actually hold does "not on it" mean anything, and only there does
 * the missing acquisition year become a question worth putting to the client.
 */
function verdictFor(
  asset: CarriedAsset,
  considered: Set<string>,
  priorYear: number,
  coverage: Coverage,
): CarryVerdict {
  if (considered.has(asset.id)) return 'carried';
  if (asset.acquisitionYear !== null && asset.acquisitionYear >= priorYear) return 'acquired';
  if (coverage === 'none') return 'uncompared';
  if (coverage === 'aggregate') return 'aggregate';
  if (asset.acquisitionYear === null) return 'undated';
  return 'omitted';
}

/** Every site this year's property sits at, with what we hold about each. */
function coverageOfRegister(
  register: CarriedAsset[],
  evidence: Map<string, { evidence: Coverage; documentId: string | null; label: string }>,
  labels: Map<string, string>,
): SiteCoverage[] {
  const sites = new Map<string, SiteCoverage>();
  for (const asset of register) {
    const key = asset.locationId ?? UNPLACED;
    let site = sites.get(key);
    if (!site) {
      const held = asset.locationId === null ? undefined : evidence.get(asset.locationId);
      site = {
        locationId: asset.locationId,
        label:
          asset.locationId === null
            ? 'Not placed at a site'
            : (labels.get(asset.locationId) ?? 'an unnamed site'),
        evidence: held?.evidence ?? 'none',
        documentId: held?.documentId ?? null,
        assetCount: 0,
        cost: 0,
      };
      sites.set(key, site);
    }
    site.assetCount += 1;
    site.cost += asset.originalCost ?? 0;
  }
  return [...sites.values()].sort(
    (a, b) => b.cost - a.cost || b.assetCount - a.assetCount || a.label.localeCompare(b.label),
  );
}

function group(verdict: CarryVerdict, lines: CarryLine[]): CarryGroup {
  return {
    verdict,
    count: lines.length,
    cost: lines.reduce((sum, line) => sum + (line.originalCost ?? 0), 0),
    costless: lines.filter((line) => line.originalCost === null).length,
    sample: [...lines].sort(byCost).slice(0, SAMPLE),
  };
}

/** Largest first, with the undated and costless at the end rather than the front. */
function byCost(a: CarryLine, b: CarryLine): number {
  return (b.originalCost ?? -1) - (a.originalCost ?? -1) || a.assetId.localeCompare(b.assetId);
}

function findingsFor(
  groups: CarryGroup[],
  lines: CarryLine[],
  coverage: SiteCoverage[],
  priorYear: number,
  taxYear: number,
  compared: PriorReturn[],
): CarryFinding[] {
  const found: CarryFinding[] = [];
  const of = (verdict: CarryVerdict) => groups.find((one) => one.verdict === verdict);
  const sites = compared.map((one) => one.locationLabel).join(', ');
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
  const names = (only: Coverage) =>
    coverage
      .filter((one) => one.evidence === only)
      .map((one) => one.label)
      .join(', ');

  const omitted = of('omitted');
  if (omitted) {
    found.push({
      key: 'omitted-from-prior-return',
      severity: 'critical',
      headline: `${omitted.count} ${plural(omitted.count, 'asset')} owned before January 1, ${priorYear} and not on that year's ${plural(compared.length, 'return')}`,
      detail:
        `The ${priorYear} ${plural(compared.length, 'return')} for ${sites} ${plural(compared.length, 'was', 'were')} built from a slice of the register that did not include ${plural(omitted.count, 'this asset', 'these assets')}, and the acquisition ${plural(omitted.count, 'year says', 'years say')} the client held ${plural(omitted.count, 'it', 'them')} on the lien date. ` +
        `Under Tax Code 25.21 a chief appraiser who discovers personal property omitted from the roll in either of the two preceding years shall appraise it and enter it, with the taxes it would have borne — and 22.28 attaches its penalty to the year the property was omitted from, not to the year somebody noticed. ` +
        `Only property at ${plural(compared.length, 'that site', 'those sites')} is counted here, so a location with no return on file is not being called omitted on the strength of our own missing records. What would still produce this reading innocently is a register carrying the wrong acquisition year, which is the first thing to check.`,
      count: omitted.count,
      cost: omitted.cost,
    });
  }

  const blind = of('uncompared');
  if (blind) {
    found.push({
      key: 'no-prior-return-on-file',
      severity: 'warning',
      headline: `${blind.count} ${plural(blind.count, 'asset')} ${plural(blind.count, 'sits', 'sit')} where nothing on file covers ${priorYear}`,
      detail:
        `Nothing was compared for ${names('none')}: no return was filed through this app, and no prior rendition has been uploaded. ` +
        `Two very different situations look identical from here. A return went out and was never recorded, which is a gap in the filing cabinet — or none went out, which is an unrendered location, and 22.28 measures its 10% penalty against the taxes on everything that return should have covered. ` +
        `Uploading the ${priorYear} rendition settles which of the two this is. It will not itemize the property — no rendition does — but it turns a blind spot into a comparison.`,
      count: blind.count,
      cost: blind.cost,
    });
  }

  const aggregate = of('aggregate');
  if (aggregate) {
    found.push({
      key: 'prior-return-not-itemized',
      severity: 'note',
      headline: `${aggregate.count} ${plural(aggregate.count, 'asset')} can only be compared in total`,
      detail: `The ${priorYear} return for ${names('aggregate')} is the client's own, read off the document they filed. A rendition reports in aggregate and never names an asset, so it proves the site was rendered and proves nothing about any single piece of property — which is why ${plural(aggregate.count, 'this one is', 'these are')} set apart rather than called new or omitted. The line-level comparison against that document is on the priors screen, and it is the strongest reading available until a return goes out from here.`,
      count: aggregate.count,
      cost: aggregate.cost,
    });
  }

  const dropped = of('dropped');
  if (dropped) {
    found.push({
      key: 'dropped-from-register',
      severity: 'warning',
      headline: `${dropped.count} ${plural(dropped.count, 'asset')} on the ${priorYear} ${plural(compared.length, 'return')} ${plural(dropped.count, 'is', 'are')} not on this year's register at all`,
      detail:
        `Absence is not disposal. A retirement and a filtered export look identical from here, which is why nothing in this app records one as the other — but last year we swore this property existed, and this year's return would simply not mention it. ` +
        `A district comparing the two renditions gets to ask why. Confirm with the client which of these were sold or scrapped, and when: a disposal on or after January 1, ${taxYear} leaves the property renderable for ${taxYear} regardless of whether the book still carries it.`,
      count: dropped.count,
      cost: dropped.cost,
    });
  }

  const undated = of('undated');
  if (undated) {
    found.push({
      key: 'undated-and-unrendered',
      severity: 'note',
      headline: `${undated.count} ${plural(undated.count, 'asset')} with no acquisition year ${plural(undated.count, 'was', 'were')} not on the ${priorYear} ${plural(compared.length, 'return')}`,
      detail: `Whether these were renderable on January 1, ${priorYear} turns entirely on when they were acquired, and the register does not say. They are counted apart rather than assumed either way — an acquisition year from the client settles each one into a new purchase or an omission.`,
      count: undated.count,
      cost: undated.cost,
    });
  }

  // Read off the carried lines rather than a group of its own: these are not a
  // seventh category of property, they are the carried ones with a fact about
  // them that decides whether they belong on this year's form.
  const disposed = lines.filter((line) => line.verdict === 'carried' && line.isDisposed);
  if (disposed.length > 0) {
    found.push({
      key: 'carried-now-disposed',
      severity: 'note',
      headline: `${disposed.length} ${plural(disposed.length, 'asset')} rendered for ${priorYear} ${plural(disposed.length, 'is', 'are')} now flagged disposed`,
      detail: `The register still carries ${plural(disposed.length, 'it', 'them')} and marks ${plural(disposed.length, 'it', 'them')} gone. The disposal date decides the rest: before January 1, ${taxYear} and the property is off this year's return, on or after it and the client still owned it on the lien date and it stays. The rendition applies that test itself — this is here so the year-on-year drop in total has a reason attached to it.`,
      count: disposed.length,
      cost: disposed.reduce((sum, line) => sum + (line.originalCost ?? 0), 0),
    });
  }

  return found;
}
