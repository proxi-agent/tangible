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

/** An asset, as this season's register carries it or as we last saw it. */
export interface CarriedAsset {
  id: string;
  assetTag: string | null;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  disposalDate: string | null;
}

export interface CarryForwardInput {
  /** The season being prepared. */
  taxYear: number;
  /** Every return on file for this client, any year. Filtered here, not by the caller. */
  returns: PriorReturn[];
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

export const CARRY_VERDICTS = ['carried', 'acquired', 'omitted', 'undated', 'dropped'] as const;
export type CarryVerdict = (typeof CARRY_VERDICTS)[number];

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
  /** The most recent year with a standing return, or null on a first season. */
  priorYear: number | null;
  /** The returns compared against, in site order. */
  returns: Array<Omit<PriorReturn, 'assetIds' | 'status'>>;
  /** Distinct assets those returns were built from. */
  consideredCount: number;
  registerCount: number;
  registerCost: number;
  groups: CarryGroup[];
  findings: CarryFinding[];
}

/** How many lines of each group are carried for display. */
const SAMPLE = 12;

// ---------------------------------------------------------------------------

export function carryForward(input: CarryForwardInput): CarryForward {
  const { taxYear, register } = input;
  const registerCost = register.reduce((sum, asset) => sum + (asset.originalCost ?? 0), 0);

  // The standing returns from the most recent season before this one. Voided and
  // superseded rows are records of what did *not* end up going out, and reading
  // membership off one would compare against a return the district never got.
  const standing = input.returns.filter(
    (one) => one.status === 'filed' && one.taxYear < taxYear,
  );
  const priorYear = standing.reduce<number | null>(
    (latest, one) => (latest === null || one.taxYear > latest ? one.taxYear : latest),
    null,
  );

  const empty: CarryForward = {
    taxYear,
    priorYear: null,
    returns: [],
    consideredCount: 0,
    registerCount: register.length,
    registerCost,
    groups: [],
    findings: [],
  };
  if (priorYear === null) return empty;

  const compared = standing
    .filter((one) => one.taxYear === priorYear)
    .sort((a, b) => a.locationLabel.localeCompare(b.locationLabel));

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
    verdict: verdictFor(asset, considered, priorYear),
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
    group(verdict, verdict === 'dropped' ? dropped : lines.filter((line) => line.verdict === verdict)),
  ).filter((one) => one.count > 0);

  return {
    taxYear,
    priorYear,
    returns: compared.map(({ assetIds: _ids, status: _status, ...rest }) => rest),
    consideredCount: considered.size,
    registerCount: register.length,
    registerCost,
    groups,
    findings: findingsFor(groups, lines, priorYear, taxYear, compared),
  };
}

/**
 * Which side of the prior lien date an unrendered asset falls.
 *
 * A rendition states what the owner held on January 1 of its tax year, so an
 * asset acquired during the prior year was never renderable on the prior return
 * and its absence is arithmetic, not a defect. An asset acquired before that
 * January 1 and never considered is the finding this file exists for. Without
 * an acquisition year there is no way to tell the two apart, and guessing in
 * either direction produces exactly the wrong document — a false accusation or
 * a missed exposure — so it gets its own verdict.
 */
function verdictFor(asset: CarriedAsset, considered: Set<string>, priorYear: number): CarryVerdict {
  if (considered.has(asset.id)) return 'carried';
  if (asset.acquisitionYear === null) return 'undated';
  return asset.acquisitionYear >= priorYear ? 'acquired' : 'omitted';
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
  priorYear: number,
  taxYear: number,
  compared: PriorReturn[],
): CarryFinding[] {
  const found: CarryFinding[] = [];
  const of = (verdict: CarryVerdict) => groups.find((one) => one.verdict === verdict);
  const sites = compared.map((one) => one.locationLabel).join(', ');
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

  const omitted = of('omitted');
  if (omitted) {
    found.push({
      key: 'omitted-from-prior-return',
      severity: 'critical',
      headline: `${omitted.count} ${plural(omitted.count, 'asset')} owned before January 1, ${priorYear} and not on that year's ${plural(compared.length, 'return')}`,
      detail:
        `The ${priorYear} ${plural(compared.length, 'return')} for ${sites} ${plural(compared.length, 'was', 'were')} built from a slice of the register that did not include ${plural(omitted.count, 'this asset', 'these assets')}, and the acquisition ${plural(omitted.count, 'year says', 'years say')} the client held ${plural(omitted.count, 'it', 'them')} on the lien date. ` +
        `Under Tax Code 25.21 a chief appraiser who discovers personal property omitted from the roll in either of the two preceding years shall appraise it and enter it, with the taxes it would have borne — and 22.28 attaches its penalty to the year the property was omitted from, not to the year somebody noticed. ` +
        `Two things produce this reading without any property being omitted, and both are worth ruling out first: a register carrying the wrong acquisition year, and a return that went out for ${priorYear} without ever being recorded here — property at a site absent from the list above was compared against nothing.`,
      count: omitted.count,
      cost: omitted.cost,
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
  // fourth category of property, they are the carried ones with a fact about
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
