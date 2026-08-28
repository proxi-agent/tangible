import type { DetectionSignal } from '@tangible/types';
import { signal } from './confidence.js';

/**
 * The signals a register can actually produce, written once and shared.
 *
 * Ghost detection used to mean one thing: the register says `disposed` and the
 * row is still there. That finds the assets a client already knows about. The
 * money is in the assets nobody marked — the forklift scrapped in 2019 that
 * nobody told accounting about, still carried at $48,000 of cost and still
 * being rendered every January.
 *
 * Nothing in a fixed asset register says an asset is gone when it is gone. What
 * a register does hold is *habits*, and the six signals below are habits: how
 * old a thing is against how long its class is supposed to last, whether the
 * department it sits in ever retires anything, whether the things bought
 * alongside it have already gone, whether the cost looks like an invoice or a
 * plug, whether the description names a machine or a category, and whether the
 * row admits to being anywhere. Each is weak. Together they are the difference
 * between a report that finds what the client already knew and one that does
 * not.
 *
 * Every weight here is judgement and every one of them is a sentence about how
 * registers are kept rather than about tax. They belong in phase 4's harness
 * more than any other constant in this package.
 */

/* -------------------------------------------------------------------------- */
/*  Age against the life the class implies                                    */
/* -------------------------------------------------------------------------- */

/**
 * An asset past its own class life is not a finding — the district's floor
 * already prices that, and plenty of ten-year machinery runs for twenty. It
 * becomes a signal at the point where it is past its life *by a multiple*,
 * because a register that still carries a thing at twice its expected service
 * life is usually a register that never took it off.
 */
export function ageSignal(age: number | null, classLife: number | null): DetectionSignal | null {
  if (age === null || classLife === null || classLife <= 0) return null;
  const ratio = age / classLife;
  if (ratio < 1.5) return null;
  const detail = `${age} years old against a ${classLife}-year class life`;
  if (ratio >= 2.5) {
    return signal(
      'far-past-life',
      'Carried at more than double its expected service life',
      0.16,
      detail,
    );
  }
  return signal('past-life', 'Carried well past its expected service life', 0.08, detail);
}

/* -------------------------------------------------------------------------- */
/*  Whether this department ever retires anything                             */
/* -------------------------------------------------------------------------- */

/** What a cost centre's own history says about how it is kept. */
export interface RetirementDiscipline {
  costCenter: string;
  assets: number;
  retired: number;
  /** Assets in this cost centre already past 1.5× their class life. */
  overdue: number;
}

/**
 * A cost centre with fifty assets, a dozen of them long past their life, and
 * not one retirement on record is not a cost centre that never throws anything
 * away. It is a cost centre where retirements do not reach the register.
 *
 * The inverse is the more useful half. A department that retires things
 * regularly is one whose remaining assets are probably really there, and the
 * signal is negative — which stops this detector from firing hardest on the
 * clients who keep the best books.
 */
export function disciplineSignal(
  discipline: RetirementDiscipline | undefined,
): DetectionSignal | null {
  if (!discipline || discipline.assets < 8) return null;
  const rate = discipline.retired / discipline.assets;
  if (discipline.retired === 0 && discipline.overdue >= 3) {
    return signal(
      'no-retirements-recorded',
      'Nothing in this department has ever been recorded as retired',
      0.14,
      `${discipline.assets} assets, ${discipline.overdue} of them long past their life`,
    );
  }
  if (rate >= 0.15) {
    return signal(
      'retirements-recorded',
      'This department does record its retirements',
      -0.12,
      `${Math.round(rate * 100)}% of its assets are marked disposed`,
    );
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  What happened to the things bought alongside it                           */
/* -------------------------------------------------------------------------- */

/** Lines booked from the same vendor on the same day: one purchase, in effect. */
export interface Siblings {
  key: string;
  total: number;
  disposed: number;
}

/**
 * Six monitors bought on one purchase order, five of them already written off.
 *
 * No register in this product carries a purchase order number — the column does
 * not survive most ERP exports. Vendor plus acquisition date is the closest
 * honest stand-in, and it is close: two lines from the same supplier booked the
 * same day were on the same invoice far more often than not. The label says
 * what was actually matched rather than claiming a PO we do not have.
 */
export function siblingSignal(siblings: Siblings | undefined): DetectionSignal | null {
  if (!siblings || siblings.total < 3 || siblings.disposed === 0) return null;
  const share = siblings.disposed / siblings.total;
  if (share < 0.5) return null;
  return signal(
    'siblings-disposed',
    'Most of what was bought alongside it has already been written off',
    share >= 0.75 ? 0.18 : 0.1,
    `${siblings.disposed} of ${siblings.total} lines from the same vendor that day are marked disposed`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Whether the cost looks like an invoice                                    */
/* -------------------------------------------------------------------------- */

/**
 * Invoices produce $4,732.18. People produce $5,000.
 *
 * A cost that is round to the nearest thousand, at a size where an invoice
 * would not be, is usually an estimate somebody typed — a lump capitalization,
 * an opening balance carried over from a system nobody has any more, or a
 * placeholder that became permanent. None of those are assets you can go and
 * find, which is precisely the point.
 *
 * The threshold matters. A $2,000 laptop bought on a corporate rate card is
 * genuinely $2,000, so this stays quiet under ten thousand, where round numbers
 * are ordinary.
 */
export function roundnessSignal(cost: number | null): DetectionSignal | null {
  if (cost === null || cost < 10_000) return null;
  if (cost % 10_000 === 0) {
    return signal(
      'round-cost',
      'The cost is a round number rather than an invoiced amount',
      0.1,
      `exactly ${Math.round(cost).toLocaleString('en-US')}`,
    );
  }
  if (cost % 1_000 === 0) {
    return signal(
      'round-cost',
      'The cost is a round number rather than an invoiced amount',
      0.06,
      `exactly ${Math.round(cost).toLocaleString('en-US')}`,
    );
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Whether the description names a thing                                     */
/* -------------------------------------------------------------------------- */

const GENERIC = [
  'equipment',
  'misc',
  'miscellaneous',
  'various',
  'other',
  'assets',
  'asset',
  'furniture',
  'furniture and fixtures',
  'office equipment',
  'machinery',
  'tools',
  'small tools',
  'improvements',
  'additions',
  'capex',
  'sundry',
  'general',
];

/** A model number, a serial, a size — anything that names one particular thing. */
const SPECIFIC = /\d{3,}|[A-Za-z]+-?\d{2,}|\b\d+["']|\bmodel\b|\bs\/?n\b/i;

/**
 * "EQUIPMENT" is not an asset. It is a journal entry that outlived the person
 * who made it.
 *
 * A row nobody can identify is a row nobody can go and look at, which makes it
 * both more likely to be a ghost and — separately, and this is why the weight
 * is modest — impossible to prove is one. The finding says so honestly rather
 * than treating illegibility as evidence.
 */
export function genericSignal(description: string | null): DetectionSignal | null {
  const text = description?.trim();
  if (!text) return null;
  const folded = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SPECIFIC.test(text)) {
    return signal(
      'specific-description',
      'The description names a particular machine',
      -0.08,
      null,
    );
  }
  if (!GENERIC.includes(folded)) return null;
  return signal(
    'generic-description',
    'The description names a category rather than a thing',
    0.1,
    `“${text}”`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Whether the row admits to being anywhere                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where a row says it is, checked against where the client says they are.
 *
 * Three states worth telling apart, and the middle one is the interesting one.
 * A blank location is a maintenance failure. A location the client's own site
 * list does not contain is usually a site they have closed — which makes every
 * asset still pointed at it a candidate for both a ghost and a situs error, and
 * is the closest a register gets to the doc's "assets at closed sites".
 */
export function locationSignal(
  registerLocation: string | null | undefined,
  known: ReadonlySet<string>,
): DetectionSignal | null {
  const text = registerLocation?.trim();
  if (!text) {
    return signal('no-location', 'The register does not say where this is', 0.08, null);
  }
  if (known.size === 0) return null;
  if (known.has(foldLocation(text))) {
    return signal('located', 'Placed at a site the client still operates', -0.1, text);
  }
  return signal(
    'unknown-location',
    'Points at a location that is not one of the sites on file',
    0.12,
    `“${text}”`,
  );
}

/** Case, punctuation and the word "location" are export noise; the rest is the name. */
export function foldLocation(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(location|site|plant|facility|branch|office|store|bldg|building)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Leases                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A right-of-use asset is an accounting entry, not a thing the taxpayer owns.
 *
 * ASC 842 put every operating lease on the balance sheet, and most ERPs put it
 * in the fixed asset register alongside owned property, because that is where
 * depreciable balances live. The lessor is separately rendering the same
 * equipment to the same district — which is the double report. The tell is
 * usually right there in the description or the GL account, in the client's own
 * words.
 */
const LEASE_WORDS =
  /\b(rou|right[- ]of[- ]use|operating lease|capital lease|finance lease|leased|lease[sd]?)\b/i;
const LESSORS =
  /\b(de lage landen|dll|ryder|penske|xerox|pitney bowes|canon financial|wells fargo (vendor|equipment)|cit |balboa|ascentium|great america|marlin leasing|leasing|leasecorp|leaseplan)\b/i;

export function leaseSignals(args: {
  description: string | null;
  glAccount: string | null | undefined;
  vendor: string | null | undefined;
  registerCategory: string | null;
  depreciationMethod?: string | null;
}): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  const text = [args.description, args.registerCategory, args.glAccount].filter(Boolean).join(' ');
  if (/\b(rou|right[- ]of[- ]use)\b/i.test(text)) {
    out.push(
      signal(
        'rou-asset',
        'Booked as a right-of-use asset, which is a lease and not ownership',
        0.24,
        null,
      ),
    );
  } else if (LEASE_WORDS.test(text)) {
    out.push(signal('lease-wording', 'The register’s own wording calls this a lease', 0.16, null));
  }
  if (args.vendor && LESSORS.test(args.vendor)) {
    out.push(
      signal('lessor-vendor', 'The vendor is an equipment lessor', 0.12, args.vendor.trim()),
    );
  }
  if (out.length === 0) return out;
  out.push(
    signal(
      'lease-terms-unknown',
      'Whether the lease makes the lessee the owner for tax is on the lease, not the register',
      -0.14,
      null,
    ),
  );
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Idle and obsolete                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Property written down to nothing in the books but still on the register.
 *
 * An impairment is the client's own accountants saying the asset stopped being
 * worth what it cost, and it is the only obsolescence evidence a register
 * carries. It does not settle anything on its own — the district values on its
 * own schedules and does not care what the book says — but Tax Code 23.01(b)
 * asks for market value, and a documented impairment is the beginning of an
 * argument that the schedule overstates it.
 *
 * Deliberately not fired on assets that are simply fully depreciated: straight
 * line to zero over five years is arithmetic, not obsolescence. The tell is a
 * book value of zero *before* the useful life would have got there.
 */
export function impairmentSignal(args: {
  originalCost: number | null;
  netBookValue: number | null | undefined;
  accumulatedDepreciation: number | null | undefined;
  age: number | null;
  classLife: number | null;
}): DetectionSignal | null {
  const { originalCost, netBookValue, age, classLife } = args;
  if (!originalCost || netBookValue === null || netBookValue === undefined) return null;
  if (netBookValue > originalCost * 0.02) return null;
  if (age === null || classLife === null) return null;
  if (age >= classLife) return null;
  return signal(
    'written-off-early',
    'Written down to nothing in the books before its life was up',
    0.12,
    `${age} years into a ${classLife}-year life`,
  );
}
