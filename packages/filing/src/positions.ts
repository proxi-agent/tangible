import type {
  FilingBlocker,
  FindingDispositionStatus,
  FindingSource,
  RenditionDecision,
} from '@tangible/types';

/**
 * What a decision about a finding does to Form 50-144.
 *
 * The rest of the rendition is derived: register in, classifications applied,
 * schedules out. This is the one seam where a human judgement reaches a form
 * somebody signs under penalty of perjury, so it is deliberately narrow, and
 * four rules shape it.
 *
 * **A position names a category, never a list of rows.** A committed finding
 * carries evidence, but that evidence is capped at twenty-five lines for
 * display. Driving a removal from it would file the twenty-sixth leasehold
 * improvement and drop the first twenty-five — a silent, plausible-looking
 * error on a sworn document. So an accepted position re-derives its property
 * from the register as it stands, by the same test the analysis used, and the
 * finding's own figures are used only to describe what was claimed.
 *
 * **Most accepted findings remove nothing, and that is not an oversight.** Ghost
 * assets and non-taxable property are already off the form: the register marks
 * one disposed and the classification puts the other out of scope, both before
 * anybody decided anything. What a decision adds there is a cross-check. A
 * finding *rejected* against property the form is still dropping means the
 * decision log and the register disagree, and one of them is wrong.
 *
 * **An exemption is claimed, not omitted.** Freeport is the trap. Accepting it
 * does not take inventory off Schedule B — under-rendering property because an
 * exemption might apply is how a 22.28 penalty starts. The inventory stays, the
 * exemption is applied for separately, and the accepted position says so.
 *
 * **Silence is not a decision.** An undecided finding on a committed set means
 * a claim went to a client and came back unanswered. Where the property it
 * concerns is on the form, that is worth saying before signature — never
 * blocking, because the deadline is real and filing the property is always the
 * safe position, but never invisible either.
 */

/**
 * A committed finding and the decision standing against it, in the shape the
 * rendition acts on. Built from the newest committed set that carried the
 * finding, joined to the engagement-level disposition record.
 */
export interface RenditionPosition {
  source: FindingSource;
  key: string;
  title: string;
  /** The year the set was committed for. A prior year, for a comparison. */
  taxYear: number;
  /** Null where nobody has decided this yet. */
  status: FindingDispositionStatus | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** What the finding claimed at commit. Describes; never drives a removal. */
  cost: number;
  assetCount: number;
}

/** Property a removal took off, tallied from the register during the build. */
export interface Removal {
  cost: number;
  count: number;
}

type Voice = (position: RenditionPosition) => Omit<FilingBlocker, 'key'>;

interface PositionRule {
  /**
   * Categories an accepted position takes off the schedules, and the reason
   * recorded against them in the exclusions list.
   */
  removes?: { categories: readonly string[]; reason: string };
  /**
   * A blocker key an accepted position answers. The built-in warning asks a
   * question; an accepted finding is that question answered, with a name and a
   * date against it, so the warning goes rather than repeating itself.
   */
  answers?: string;
  /** `open` covers both undecided and `pending-client`. */
  says?: { accepted?: Voice; rejected?: Voice; open?: Voice };
  /** Stated on the document for every status, including "nothing, because…". */
  effect: (position: RenditionPosition, removed: Removal) => string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const on = (iso: string | null) => (iso ? ` on ${iso.slice(0, 10)}` : '');

const RULES: Readonly<Record<string, PositionRule>> = {
  // --- The savings report over the classified register ----------------------

  'savings:ghost-assets': {
    answers: 'disposed-present',
    says: {
      rejected: (p) => ({
        severity: 'blocking',
        message: `The register marks ${p.assetCount} ${s(p.assetCount, 'asset', 'assets')} as disposed and this form leaves ${s(p.assetCount, 'it', 'them')} off, but “${p.title}” was rejected${on(p.decidedAt)}. The decision log and the register disagree, and the form is following the register.`,
        resolution:
          'Clear the disposal on the register if the property was in place on January 1, or re-open the finding.',
      }),
    },
    effect: (p) =>
      p.status === 'accepted'
        ? 'Confirms the disposals the register already keeps off this form. Nothing further comes off — none of it was ever on.'
        : 'The disposals are off this form on the register’s word alone.',
  },

  'savings:non-taxable': {
    says: {
      rejected: (p) => ({
        severity: 'blocking',
        message: `${money(p.cost)} is classified off this rendition, but “${p.title}” was rejected${on(p.decidedAt)}. If that property is the client’s taxable personal property it belongs on a schedule, and omitting it from a sworn form is what Tax Code 22.28 penalises.`,
        resolution: 'Re-classify the property, or re-open the finding.',
      }),
      open: (p) => ({
        severity: 'warning',
        message: `${money(p.cost)} is off this rendition on our classification alone — “${p.title}” was committed but never decided.`,
        resolution: 'Put the exclusion to the client before the form is signed.',
      }),
    },
    effect: () =>
      'Property already out of scope on its classification. The decision records agreement, not a further removal.',
  },

  'savings:leasehold-double-tax': {
    removes: {
      categories: ['leasehold-improvements'],
      reason:
        'Accepted as already carried in the landlord’s real property assessment (Tax Code 23.24).',
    },
    says: {
      open: (p) => ({
        severity: 'warning',
        message: `${money(p.cost)} of leasehold improvements sits on Schedule E with the 23.24 double-taxation question still open. Filed as it stands, it is rendered and taxed.`,
        resolution:
          'Settle it against the landlord’s real property account, or file as it stands and pursue it on protest.',
      }),
    },
    effect: (p, removed) =>
      p.status === 'accepted'
        ? `Takes ${money(removed.cost)} of leasehold improvements off Schedule E across ${removed.count} ${s(removed.count, 'asset', 'assets')}, under Tax Code 23.24.`
        : 'Leasehold improvements stay on Schedule E until this is accepted.',
  },

  'savings:freeport': {
    says: {
      accepted: (p) => ({
        severity: 'warning',
        message: `Freeport was accepted on ${money(p.cost)} of inventory, and that inventory is still on Schedule B — it has to be. The exemption is claimed on its own application, not by leaving property off a rendition.`,
        resolution:
          'File the freeport application by 30 April. A late one still captures part of the benefit under Tax Code 11.4391.',
      }),
      open: (p) => ({
        severity: 'warning',
        message: `${money(p.cost)} of inventory is rendered at full cost with the freeport question unanswered.`,
        resolution:
          'Ask what share of inventory leaves Texas and how fast. The exemption is annual, so a year nobody answers is a year forfeited.',
      }),
    },
    effect: () =>
      'None. An exemption is claimed on its own application; the inventory stays on Schedule B either way.',
  },

  // --- The comparison against a filed prior return --------------------------

  'register-comparison:under-reported': {
    says: {
      accepted: (p) => ({
        severity: 'warning',
        message: `“${p.title}” was accepted against the ${p.taxYear} return: ${money(p.cost)} of cost was on the register and not on that filing. This rendition files it, which discloses the gap — Tax Code 25.21 lets the district add omitted property for either of the two preceding tax years.`,
        resolution:
          'Tell the client what the disclosure exposes, and decide together whether to correct the earlier year before this one is sent.',
      }),
      open: (p) => ({
        severity: 'warning',
        message: `${money(p.cost)} of property the ${p.taxYear} return did not account for is on this rendition, and “${p.title}” has not been decided. Filing discloses it either way.`,
        resolution:
          'Settle the finding before signature. A 25.21 exposure is a client conversation, not a filing choice.',
      }),
    },
    effect: (p) =>
      `Nothing comes off. Filing the register in full discloses the ${p.taxYear} gap, which is the right thing to do and worth saying out loud first.`,
  },

  'register-comparison:rendered-after-disposal': {
    says: {
      accepted: (p) => ({
        severity: 'warning',
        message: `The ${p.taxYear} return rendered ${money(p.cost)} of property the register says was already gone, and that was accepted${on(p.decidedAt)}. This form does not carry it; the earlier roll still does.`,
        resolution:
          'File a Tax Code 25.25(c)(3) motion to correct the earlier roll. It reaches back five years and is separate from this rendition.',
      }),
    },
    effect: () =>
      'None on this form — the property is already off it. The accepted finding opens a correction for the earlier year instead.',
  },

  // --- Decisions worth recording that this form is simply not the place for --
  //
  // Listed with their reasons rather than left out. "Why did accepting this do
  // nothing?" is a fair question, and an entry that answers it reads as a
  // judgement; a missing entry reads as something nobody got to.

  'savings:fully-depreciated': {
    effect: () =>
      'None. The property is rendered either way and the district’s tables already carry it at the floor. The finding is about what the client rendered before, not about what goes on this form.',
  },

  'register-comparison:over-reported': {
    effect: (p) =>
      `None. This is cost the ${p.taxYear} return carried and the register does not, so it never reaches a schedule here. The overpayment is recovered against that year, not this one.`,
  },

  'register-comparison:misscheduled': {
    effect: (p) =>
      `None. A category error on the ${p.taxYear} return. This rendition is built from current classifications, which is the correction.`,
  },
};

/**
 * Unknown keys resolve rather than throw. A finding key added to an engine
 * before this table catches up should show as undescribed on the form, not take
 * the rendition down — and the wording is the prompt to come back and decide.
 */
const UNDESCRIBED: PositionRule = {
  effect: () => 'No rendition effect is defined for this finding.',
};

function ruleFor(position: RenditionPosition): PositionRule {
  return RULES[`${position.source}:${position.key}`] ?? UNDESCRIBED;
}

export interface PositionPlan {
  /** Category key → the exclusion reason to record against it. */
  removals: Map<string, string>;
  blockers: FilingBlocker[];
  /** Built-in blocker keys the decision log has answered. */
  answered: Set<string>;
}

/**
 * What the decisions ask of the form, before the register is walked.
 *
 * Pure and order-independent: two positions removing the same category is not a
 * conflict, and the first reason recorded wins because the property comes off
 * once either way.
 */
export function planPositions(positions: readonly RenditionPosition[]): PositionPlan {
  const plan: PositionPlan = { removals: new Map(), blockers: [], answered: new Set() };

  for (const position of positions) {
    const rule = ruleFor(position);
    const accepted = position.status === 'accepted';

    if (accepted && rule.removes) {
      for (const category of rule.removes.categories) {
        if (!plan.removals.has(category)) plan.removals.set(category, rule.removes.reason);
      }
    }
    if (accepted && rule.answers) plan.answered.add(rule.answers);

    const voice = accepted
      ? rule.says?.accepted
      : position.status === 'rejected'
        ? rule.says?.rejected
        : rule.says?.open;
    if (voice)
      plan.blockers.push({ key: `finding:${position.source}:${position.key}`, ...voice(position) });
  }

  return plan;
}

/**
 * The decisions as they read on the finished document, with what each one
 * actually took off measured from the register rather than from the claim.
 */
export function describePositions(
  positions: readonly RenditionPosition[],
  removed: ReadonlyMap<string, Removal>,
): RenditionDecision[] {
  return positions.map((position) => {
    const rule = ruleFor(position);
    const categories = position.status === 'accepted' ? (rule.removes?.categories ?? []) : [];
    const tally = categories.reduce<Removal>(
      (sum, category) => {
        const hit = removed.get(category);
        return hit ? { cost: sum.cost + hit.cost, count: sum.count + hit.count } : sum;
      },
      { cost: 0, count: 0 },
    );

    return {
      source: position.source,
      key: position.key,
      title: position.title,
      taxYear: position.taxYear,
      status: position.status,
      decidedBy: position.decidedBy,
      decidedAt: position.decidedAt,
      cost: position.cost,
      removedCost: tally.cost,
      removedAssetCount: tally.count,
      effectOnForm: rule.effect(position, tally),
    };
  });
}
