import type { Rendition, RenditionSchedule, RenditionScheduleKey } from '@tangible/types';

/**
 * A `Rendition` arranged the way Form 50-144 asks for it.
 *
 * `buildRendition` answers a tax question: given this register and these
 * classifications, what is reportable and where does it belong. This module
 * answers a different one — what goes in the boxes. They are kept apart because
 * the form changes and the tax treatment does not. When the Comptroller
 * renumbers a step or moves the agent question, that is an edit here and
 * nowhere else.
 *
 * Three rules shape the output.
 *
 * **A blank is never a value.** Every field the form asks for is present in the
 * model, and one it cannot answer says so as an omission carrying what is
 * missing and where it would come from. A form rendered with silent gaps looks
 * finished, and somebody signs it.
 *
 * **Withheld is not zero.** A line whose good faith estimate could not be
 * computed prints as withheld. Zero on a sworn document asserts the property is
 * worthless, which is a statement about the property rather than about our
 * schedules — and it is the kind of statement 22.29 exists for.
 *
 * **The district gets the form; the file gets the reasoning.** Decisions and
 * blockers are our work product. 22.27 keeps a rendition's contents from other
 * people; it does not oblige us to hand the appraiser our own analysis, and
 * volunteering which findings a client accepted invites questions about the
 * ones they did not. `audience` decides what renders.
 */

/** Who the form is filed for and where the property sat on January 1. */
export interface FormParty {
  /** The owner as it should appear on the roll, not our internal client name. */
  ownerName: string;
  mailingAddress: readonly string[];
  /**
   * The physical situs. Property is assessed where it stood on January 1, so
   * one rendition covers one location — assets at two sites are two filings,
   * and the caller is expected to have split them before it gets here.
   */
  situsAddress: readonly string[];
  /** What the business does, in the owner's words. Distinct from the SIC code. */
  businessDescription: string | null;
}

/** Who signs, and in what capacity — the form asks, and 22.24(e) turns on it. */
export interface FormSigner {
  name: string;
  title: string | null;
  /** 'owner' | 'employee' | 'agent' | 'secured-party' | 'fiduciary'. */
  capacity: FormCapacity;
  /**
   * The date the Form 50-162 appointment reached the appraisal district, for an
   * agent. Null where no effective appointment is held.
   *
   * The filed date rather than the signed one, because that is the day the
   * designation took effect — the form says so in as many words, and a district
   * asking when we were appointed means the date on its own stamp.
   */
  appointmentFiledOn: string | null;
}

export const FORM_CAPACITIES = [
  'owner',
  'employee',
  'agent',
  'secured-party',
  'fiduciary',
] as const;
export type FormCapacity = (typeof FORM_CAPACITIES)[number];

export interface FormFieldValue {
  label: string;
  /** Rendered text. Null where the answer is genuinely nothing to report. */
  value: string | null;
  /** Why the value reads the way it does, where that is not self-evident. */
  note?: string;
}

export interface FormCheckbox {
  label: string;
  checked: boolean;
  /** The statute or fact the box turns on. */
  basis?: string;
}

/** One row of a schedule table as the form prints it. */
export interface FormRow {
  type: string;
  yearAcquired: string;
  historicalCost: string;
  /** 'withheld' where the schedules could not value the line. Never '0'. */
  goodFaithEstimate: string;
  assetCount: number;
}

export interface FormScheduleTable {
  key: RenditionScheduleKey;
  title: string;
  instruction: string;
  rows: FormRow[];
  totalCost: string;
  totalEstimate: string;
  /**
   * Rows past what the printed table holds. The form's own tables are short and
   * a register is not, so the overflow is filed as an attached continuation —
   * which is ordinary practice, but it has to be deliberate and labelled rather
   * than a table that silently stops.
   */
  continuationRows: number;
}

/** A field the form asks for that the data cannot answer yet. */
export interface FormOmission {
  field: string;
  /** What is missing, in the words of somebody who could go and fix it. */
  missing: string;
  /** Whether the form can be filed without it. */
  severity: 'blocking' | 'warning';
}

export interface Form50144 {
  /** 'district' omits our reasoning; 'file' keeps it. */
  audience: FormAudience;
  formName: string;
  formRevision: string;
  taxYear: number;
  generatedAt: string;

  owner: FormFieldValue[];
  property: FormFieldValue[];
  representation: FormCheckbox[];
  affirmations: FormCheckbox[];
  schedules: FormScheduleTable[];

  totals: FormFieldValue[];
  signature: FormSignatureBlock;

  omissions: FormOmission[];
  /** Populated only for the file copy. */
  decisions: FormFieldValue[];
}

export const FORM_AUDIENCES = ['district', 'file'] as const;
export type FormAudience = (typeof FORM_AUDIENCES)[number];

export interface FormSignatureBlock {
  signerName: string;
  signerTitle: string | null;
  capacityLabel: string;
  /** The substance of what signing asserts. Our wording, not the form's. */
  affirmation: string;
  penaltyNotice: string;
  notarization: { required: boolean; reason: string };
}

/**
 * How many detail rows each printed schedule table holds before the rest goes
 * on an attachment. Counted off the Comptroller's own form, which is stingier
 * than it looks: three rows for inventory, three for vehicles.
 *
 * Schedule E is absent because it cannot overflow. It is not a list of rows at
 * all but six fixed ladders of years, and everything older than the bottom rung
 * folds into an "& Prior" bucket — thirty distinct years and three fill the same
 * fourteen boxes. What Schedule E can lose is a line with no usable year, which
 * `fillFormPlan` reports instead.
 */
const PRINTED_ROWS: Readonly<Partial<Record<RenditionScheduleKey, number>>> = {
  A: 3,
  B: 3,
  C: 3,
  D: 3,
  F: 5,
};

const CAPACITY_LABEL: Readonly<Record<FormCapacity, string>> = {
  owner: 'Owner of the property',
  employee: 'Employee of the owner',
  agent: 'Agent appointed under Tax Code 1.111 (Form 50-162 on file)',
  'secured-party': 'Secured party with an interest in the property',
  fiduciary: 'Fiduciary acting for the owner',
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * The estimate column, on the basis actually being filed.
 *
 * Three states, and the distinction between the last two is the whole point:
 * not applicable because we are filing on cost and the form does not ask;
 * withheld because we are filing on estimate and cannot support a number here;
 * or the number.
 */
const estimateCell = (value: number | null, usingEstimate: boolean): string => {
  if (!usingEstimate) return '—';
  return value === null ? 'withheld' : money(value);
};

export interface Form50144Input {
  rendition: Rendition;
  party: FormParty;
  signer: FormSigner;
  audience: FormAudience;
}

export function buildForm50144(input: Form50144Input): Form50144 {
  const { rendition, party, signer, audience } = input;
  const usingEstimate = rendition.basis === 'estimate';
  const omissions: FormOmission[] = [];

  const require = (
    field: string,
    value: string | null,
    missing: string,
    severity: FormOmission['severity'] = 'blocking',
  ): string | null => {
    if (value === null || value.trim() === '') {
      omissions.push({ field, missing, severity });
      return null;
    }
    return value;
  };

  const address = (lines: readonly string[]): string | null =>
    lines.length === 0 ? null : lines.join('\n');

  const owner: FormFieldValue[] = [
    {
      label: 'Owner’s name',
      value: require('Owner’s name', party.ownerName, 'The owner as it appears on the roll.'),
    },
    {
      label: 'Mailing address',
      value: require('Mailing address', address(
        party.mailingAddress,
      ), 'The owner’s mailing address. Notices from the district go here, including the one that starts the 41.44 protest clock.'),
    },
  ];

  const property: FormFieldValue[] = [
    {
      label: 'Address where the property is located on January 1',
      value: require('Situs address', address(
        party.situsAddress,
      ), 'The physical situs. Property is taxed where it stood on January 1, and the situs decides which units tax it — the district cannot assess from a mailing address.'),
      note: 'One rendition covers one location. Property at a second site is a second filing.',
    },
    {
      label: 'Appraisal district account number',
      value: require('Account number', rendition.accountId, 'The roll account. Filing without one still works — the district opens a new account — but it will not attach to the client’s existing history.', 'warning'),
    },
    {
      label: 'Business description',
      value: require('Business description', party.businessDescription, 'What the business does. The district keys machinery life to the business rather than the machine, so a wrong or absent description is how a 15-year life becomes 8.', 'warning'),
    },
    {
      label: 'SIC code',
      value: rendition.sicCode,
      note: rendition.sicCode
        ? undefined
        : 'None recorded; the district will fall back to its own.',
    },
  ];

  const representation: FormCheckbox[] = FORM_CAPACITIES.map((capacity) => ({
    label: CAPACITY_LABEL[capacity],
    checked: signer.capacity === capacity,
    basis:
      capacity === 'agent' && signer.capacity === 'agent'
        ? signer.appointmentFiledOn
          ? `Form 50-162 on file with the district since ${signer.appointmentFiledOn}.`
          : 'No effective Form 50-162 appointment for this district.'
        : undefined,
  }));

  if (signer.capacity === 'agent' && !signer.appointmentFiledOn) {
    omissions.push({
      field: 'Agent appointment',
      missing:
        'The date the Form 50-162 appointment was filed with the district. An agent filing without an appointment in force is not authorised to make this statement.',
      severity: 'blocking',
    });
  }

  const affirmations: FormCheckbox[] = [
    {
      label: 'Filed on historical cost and year acquired',
      checked: !usingEstimate,
      basis:
        'Tax Code 22.01(a)(5) allows either. Cost is a fact from the owner’s books; an estimate can be demanded in writing within 21 days under 22.07.',
    },
    {
      label: 'Filed on a good faith estimate of market value',
      checked: usingEstimate,
      basis:
        'Tax Code 22.01(a)(5). An estimate is inadmissible later except in a 41.41 protest, and it is the estimate — not the value — that drags an agent-filed rendition into notarization under 22.24(e).',
    },
    {
      label: 'Total taxable value at this location is under $20,000 (Schedule A)',
      checked: rendition.qualifiesForScheduleA,
      basis:
        'Where it applies, the form takes a general description and a total; type, year and cost become optional.',
    },
  ];

  const schedules = rendition.schedules.map((schedule) => tableFor(schedule, usingEstimate));

  const totals: FormFieldValue[] = [
    { label: 'Total historical cost', value: money(rendition.totalHistoricalCost) },
    {
      label: 'Total good faith estimate of market value',
      value: usingEstimate
        ? rendition.totalGoodFaithEstimate === null
          ? 'withheld'
          : money(rendition.totalGoodFaithEstimate)
        : null,
      note: usingEstimate
        ? undefined
        : 'Not stated. This rendition is filed on cost, and the district applies its own schedules.',
    },
  ];

  // Ours, and labelled as ours. It is on the file copy because a reviewer wants
  // to know what the district will likely land on; it is off the district copy
  // because volunteering our arithmetic invites an argument we have not been
  // given a reason to have.
  if (audience === 'file') {
    totals.push({
      label: 'Value on the district’s published schedules (our calculation)',
      value: money(rendition.scheduleValue),
      note: 'Not part of the filing. Shown so the file records what we expected the assessment to be.',
    });
  }

  // The rendition may still raise `agent-appointment` — its caller might have
  // had no filing profile to read. This module always does: it answers with the
  // date, or with its own omission naming what is missing. Either beats the
  // generic reminder, and printing both says the same thing twice, which is how
  // a list of omissions becomes something people scroll past.
  const answered = signer.capacity === 'agent' ? new Set(['agent-appointment']) : new Set<string>();

  for (const blocker of rendition.blockers) {
    if (blocker.severity !== 'blocking' || answered.has(blocker.key)) continue;
    omissions.push({
      field: blocker.key,
      missing: `${blocker.message} ${blocker.resolution}`,
      severity: 'blocking',
    });
  }

  return {
    audience,
    formName: 'Texas Form 50-144 — Business Personal Property Rendition of Taxable Property',
    formRevision: 'rev. Oct 2025',
    taxYear: rendition.taxYear,
    generatedAt: rendition.generatedAt,
    owner,
    property,
    representation,
    affirmations,
    schedules,
    totals,
    signature: {
      signerName: signer.name,
      signerTitle: signer.title,
      capacityLabel: CAPACITY_LABEL[signer.capacity],
      affirmation:
        'The signer swears that the property described is what the owner held on January 1, and that the figures given are true to the best of their knowledge and belief.',
      penaltyNotice:
        'A rendition that is late or not filed carries a penalty of 10% of the taxes on the property (Tax Code 22.28). A rendition filed with intent to defraud carries 50% (22.29).',
      notarization: rendition.notarization,
    },
    omissions,
    decisions:
      audience === 'file'
        ? rendition.decisions.map((decision) => ({
            label: decision.title,
            value:
              decision.removedAssetCount > 0
                ? `${decision.status ?? 'undecided'} — ${money(decision.removedCost)} off this form across ${decision.removedAssetCount} ${decision.removedAssetCount === 1 ? 'asset' : 'assets'}`
                : `${decision.status ?? 'undecided'} — no change to this form`,
            note: decision.effectOnForm,
          }))
        : [],
  };
}

function tableFor(schedule: RenditionSchedule, usingEstimate: boolean): FormScheduleTable {
  const printed = PRINTED_ROWS[schedule.key];
  return {
    key: schedule.key,
    title: schedule.title,
    instruction: schedule.instruction,
    rows: schedule.lines.map((line) => ({
      type: line.type,
      yearAcquired: line.yearAcquired === null ? '—' : String(line.yearAcquired),
      historicalCost: money(line.historicalCost),
      goodFaithEstimate: estimateCell(line.goodFaithEstimate, usingEstimate),
      assetCount: line.assetCount,
    })),
    totalCost: money(schedule.totalCost),
    totalEstimate: estimateCell(schedule.totalEstimate, usingEstimate),
    continuationRows: printed === undefined ? 0 : Math.max(0, schedule.lines.length - printed),
  };
}
