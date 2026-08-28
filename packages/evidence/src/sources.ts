/**
 * The systems outside the fixed asset register that know whether an asset is
 * real, and what each one is actually evidence of.
 *
 * The register is a financial record. It knows what was bought and what it
 * cost, and it is silent on the only question that matters for a ghost: is the
 * thing still there. Everything in this file exists because somebody else in
 * the client's building already knows the answer and nobody ever asked them.
 *
 * The sources are not interchangeable, and treating them as "extra data" is
 * how a match becomes a liability. Each one answers a different question,
 * each is authoritative over a different slice of the register, and — this is
 * the part that decides the whole design — each has a different meaning when it
 * says *nothing*. A maintenance system with no work order against a chiller is
 * strong evidence the chiller is gone, because chillers get maintained. An IT
 * asset manager with no record of a conveyor is evidence of nothing at all,
 * because conveyors were never in scope for it.
 *
 * So absence is modelled explicitly rather than left as a missing row. A source
 * that covers a category and found nothing makes a *negative statement*, which
 * is evidence. A source that does not cover the category is silent, which is
 * not. Collapsing those two into "no match" would turn every asset outside a
 * system's scope into a suspected ghost, which is exactly the false-positive
 * flood that makes a firm stop trusting the queue.
 */

export type EvidenceSourceKind =
  'cmms' | 'itam' | 'insurance-sov' | 'real-property' | 'lease-subledger' | 'physical-inventory';

export interface EvidenceSourceProfile {
  kind: EvidenceSourceKind;
  label: string;
  /** What a person calls this system when they go to ask for the export. */
  examples: string;
  /**
   * What a match from this source proves. Written as the sentence that appears
   * on the finding, because a source whose meaning cannot be stated in one
   * sentence is a source nobody should be leaning on.
   */
  affirms: string;
  /**
   * What silence from this source proves, where it covers the asset. Null for a
   * source whose absence means nothing even in scope — and there is one, which
   * is why this is a field rather than an assumption.
   */
  denies: string | null;
  /**
   * The category keys this source can speak to. Everything else it is silent
   * about, no matter how complete the export is.
   */
  covers: readonly string[];
}

/**
 * Scope is expressed in the shared classification keys deliberately. The
 * classification vocabulary is the one thing every part of this product already
 * agrees on, and a source scope written in the source's own words would have to
 * be re-mapped by hand for every client.
 */
export const EVIDENCE_SOURCES: Readonly<Record<EvidenceSourceKind, EvidenceSourceProfile>> = {
  cmms: {
    kind: 'cmms',
    label: 'Maintenance system',
    examples: 'CMMS or EAM — Maximo, Fiix, UpKeep, SAP PM',
    affirms:
      'A work order was raised against this asset, so somebody physically touched it on a date we can name.',
    denies:
      'No work order has ever been raised against this asset in a system that maintains equipment of this kind. Machinery that is running gets serviced; machinery that is gone stops appearing in maintenance records long before it comes off the register.',
    covers: ['machinery-equipment', 'office-equipment', 'vehicles', 'solar', 'vessels'],
  },
  itam: {
    kind: 'itam',
    label: 'IT asset and device management',
    examples: 'ITAM or MDM — ServiceNow, Jamf, Intune, Lansweeper',
    affirms:
      'The device checked in to a management system, which is a machine reporting its own existence rather than a person remembering it.',
    denies:
      'A managed device that has not checked in has either been disposed of or has left the estate. For laptops and servers this is the strongest negative signal available anywhere, because the check-in is automatic and nobody has to remember to do it.',
    covers: ['computer-pc', 'computer-mainframe', 'telecom-8', 'specific-equipment'],
  },
  'insurance-sov': {
    kind: 'insurance-sov',
    label: 'Insurance schedule of values',
    examples: 'The SOV behind the property policy, usually held by the broker',
    affirms:
      'The asset is scheduled on the property policy, which means the client is paying a premium on it and told an underwriter it exists.',
    /**
     * The one source whose silence proves nothing, and it is worth being
     * explicit about why. An SOV is built to a materiality threshold and often
     * covers only locations rather than items. Everything under the threshold
     * is absent from it and entirely real. Reading that absence as a ghost
     * would flag most of a register.
     */
    denies: null,
    covers: [
      'machinery-equipment',
      'furniture-fixtures',
      'leasehold-improvements',
      'solar',
      'vessels',
    ],
  },
  'real-property': {
    kind: 'real-property',
    label: 'Real property assessment',
    examples: "The county's own real property record for the building",
    affirms:
      'The improvement is already in the real property assessment for this address, so the county is taxing it once on the real side.',
    denies:
      'The real property record for this address carries no improvement of this kind, which removes the double-taxation argument for it and leaves the cost on the personal property return.',
    covers: ['leasehold-improvements'],
  },
  /**
   * The one source that was asked the question directly.
   *
   * Every other system here is evidence by side effect: a maintenance record
   * exists because somebody fixed a pump, not because anybody wanted to know
   * whether the pump was there. A count is different. Somebody walked the floor
   * with a scanner for the express purpose of establishing what is present, and
   * that changes what its silence is worth — which is why this is the one source
   * whose deny weight is set above its affirm weight in `signals.ts`. It is
   * still discounted below a match, because a count can miss an asset that is
   * out for repair or in a room nobody walked.
   *
   * The scope is drawn at what actually carries a tag. Leasehold improvements
   * are visible to anyone standing in the room and are not tagged, so a count
   * that does not list the build-out has established nothing about it, and
   * treating that absence as evidence would flag every improvement on the
   * register the first time a client sends a scan file.
   */
  'physical-inventory': {
    kind: 'physical-inventory',
    label: 'Physical inventory count',
    examples: 'The scan file from a floor count — barcode or RFID, in-house or a counting firm',
    affirms:
      'Somebody physically stood in front of this asset on a named date and scanned its tag. Nothing else in this product is evidence of that kind.',
    denies:
      'A count that covered this location and this class of property did not find this asset. Every other absence here is a reason to suspect; this one is the count itself saying the asset is not where the register says it is.',
    covers: [
      'machinery-equipment',
      'furniture-fixtures',
      'office-equipment',
      'computer-pc',
      'computer-mainframe',
      'specific-equipment',
      'telecom-8',
      'vehicles',
      'vessels',
      'solar',
    ],
  },
  'lease-subledger': {
    kind: 'lease-subledger',
    label: 'Lease subledger',
    examples: 'The ASC 842 / IFRS 16 lease schedule, usually out of the lease accounting system',
    affirms:
      'The asset is on a lease schedule, so the lessor owns it — and the lessor is separately reporting it to the same district.',
    denies:
      'No lease covers this asset, so the client owns it and reporting it is correct. This is the negative statement that stops a leased-asset finding before it reaches a client, and it is the one that saves the most embarrassment.',
    covers: [
      'machinery-equipment',
      'office-equipment',
      'computer-pc',
      'computer-mainframe',
      'vehicles',
    ],
  },
};

/** Whether a source has anything to say about this category at all. */
export function sourceCovers(kind: EvidenceSourceKind, categoryKey: string | null): boolean {
  if (categoryKey === null) return false;
  return EVIDENCE_SOURCES[kind].covers.includes(categoryKey);
}

/** The sources that can speak to a category, in the order they are listed. */
export function sourcesFor(categoryKey: string | null): EvidenceSourceProfile[] {
  if (categoryKey === null) return [];
  return Object.values(EVIDENCE_SOURCES).filter((source) => source.covers.includes(categoryKey));
}
