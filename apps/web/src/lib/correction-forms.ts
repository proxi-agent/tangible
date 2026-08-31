import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientFilingProfileRow, ClientLocationRow } from '@tangible/db';
import {
  appraisalDistrictCounty,
  appraisalDistrictName,
  motionDraftBlocker,
  planMotionFill,
  planOverAppraisalFill,
  renderForm50230,
  renderForm50771,
  MOTION_GROUNDS,
  type FormOmission,
  type MotionMovant,
  type MotionSubject,
} from '@tangible/filing';
import type { OpenYear } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { appointmentAt } from '@/lib/appointments';
import { HttpError, notFound } from '@/lib/http';
import { latestMotionDraft } from '@/lib/motion-drafts';
import { engagementOpenYears } from '@/lib/open-years';
import { today } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The 25.25 motion, written onto the Comptroller's own form.
 *
 * Which form is not a choice: the three routes the open-years board computes
 * are printed on two different pieces of paper. (c) and (c-1) are Form 50-771,
 * which selects one of five closed-list grounds; (d) is Form 50-230, which
 * exists only to assert the one-third over-appraisal (d) requires and says so
 * on its face. Sending a (d) motion in on 50-771 is a motion denied on the
 * paper rather than on the facts, so the route picks the form here and each
 * planner refuses the other route by name.
 *
 * Built from the drafted motion rather than from the request, because the
 * draft already froze the two facts the record cannot supply — the value the
 * firm claims is correct and the error in the firm's own words — and they are
 * the two the form's caption and its statement of errors are made of. Three
 * more are neither on the record nor in the draft and arrive as inputs: the day
 * this board certified the roll, the taxing units to be notified, and which of
 * 50-771's five grounds the error is.
 */

const OptionsSchema = z.object({
  /** The open-years key, which is how the draft and the year are both found. */
  key: z.string().min(1),
  /**
   * The day the ARB certified the roll being corrected, ISO.
   *
   * Nothing in this repo records it — it is a board's own calendar, not a
   * document we receive — and both forms recite it, so both refuse to print
   * without it rather than reciting a date nobody checked.
   */
  certified: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the certification date as YYYY-MM-DD.')
    .optional(),
  /** The taxing units the board notifies, comma separated. */
  units: z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [],
    ),
  /** Which of 50-771's five grounds. Ignored on a (d) motion, which has none. */
  ground: z.enum(MOTION_GROUNDS).optional(),
});

export function motionFormOptions(raw: Record<string, string | undefined>) {
  const parsed = OptionsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new HttpError(
    400,
    `That is not a motion this form can print: ${first?.message ?? 'the request did not read'}.`,
  );
}

export interface MotionFormPdf {
  bytes: Uint8Array;
  revision: string;
  omissions: readonly FormOmission[];
  /** Which Comptroller form the route landed on, for the filename and the header. */
  form: '50-771' | '50-230';
  filename: string;
}

export async function buildMotionPdf(
  engagementId: string,
  options: z.output<typeof OptionsSchema>,
): Promise<MotionFormPdf> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const draft = await latestMotionDraft(engagementId, options.key);
  if (!draft) {
    throw new HttpError(
      409,
      'No motion has been drafted for this year yet. The form is the drafted motion on the ' +
        'district’s own paper — draft it first, so what the form asserts and what the motion ' +
        'argues are the same two figures.',
    );
  }

  const year = await fetchYear(engagementId, options.key);
  // The route is re-tested against the board as it stands now, not as it stood
  // when the draft was written. A route that has since closed — because the
  // deadline passed, or because an earlier motion was determined — is a motion
  // the district will reject, and printing it would spend the postage to find out.
  const blocked = motionDraftBlocker(year, draft.facts.route.key, draft.facts.claimedValue);
  if (blocked) throw new HttpError(409, blocked);

  const [profile, site, actor] = await Promise.all([
    filingProfile(client.id),
    year.locationId === null ? null : clientLocation(year.locationId),
    currentActor(),
  ]);

  const signedOn = today();
  const jurisdictionId = site?.jurisdictionId ?? engagement.jurisdictionId;
  const appointment =
    jurisdictionId && year.locationId
      ? await appointmentAt(client.id, {
          jurisdictionId,
          locationId: year.locationId,
          on: signedOn,
        })
      : null;

  const movant: MotionMovant = {
    ownerName: profile?.ownerName ?? client.name,
    signerName: actor,
    phone: null,
    mailingAddress: [profile?.mailingAddressLine1, profile?.mailingAddressLine2]
      .filter((line): line is string => Boolean(line?.trim()))
      .join(', '),
    cityStateZip: cityStateZip(profile),
    signedOn,
    appointmentOnFile: appointment === null ? null : appointment.effective,
  };

  const subject: MotionSubject = {
    county: jurisdictionId ? appraisalDistrictCounty(jurisdictionId) : null,
    // What the district called itself on the notice beats the directory, same
    // as on the protest: the board is the one that sent the roll.
    districtName:
      draft.facts.districtName ?? (jurisdictionId ? appraisalDistrictName(jurisdictionId) : null),
    accountId: draft.facts.accountId,
    // No invented description. The account is what finds the line on the roll,
    // and where the client has said what the business is, that says the rest.
    description: profile?.businessDescription ?? null,
    location: site ? locationAddress(site) : null,
    taxYear: draft.facts.taxYear,
    certifiedOn: options.certified ?? null,
  };

  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const name = (form: string) =>
    `${form}-${slug(client.name)}-${draft.facts.taxYear}-${draft.facts.route.key}.pdf`;

  if (draft.facts.route.key === 'd') {
    const plan = planOverAppraisalFill({
      route: 'd',
      movant,
      subject,
      taxingUnits: options.units,
      errors: draft.facts.ground,
      // The blocker above is 25.25(d)'s one-third test, and it just passed on
      // these two figures. Asserted here rather than recomputed so the form and
      // the board are answering the same arithmetic.
      overByOneThird: true,
      rolledValue: draft.facts.rolledValue,
      claimedValue: draft.facts.claimedValue,
    });
    const bytes = await renderForm50230(plan);
    return {
      bytes,
      revision: plan.revision,
      omissions: plan.omissions,
      form: '50-230',
      filename: name('50-230'),
    };
  }

  const plan = planMotionFill({
    route: draft.facts.route.key,
    ground: options.ground ?? null,
    movant,
    subject,
    taxingUnits: options.units,
    errors: draft.facts.ground,
  });
  const bytes = await renderForm50771(plan);
  return {
    bytes,
    revision: plan.revision,
    omissions: plan.omissions,
    form: '50-771',
    filename: name('50-771'),
  };
}

/** The open-years row for one key — closed years included, so a bar can speak. */
async function fetchYear(engagementId: string, yearKey: string): Promise<OpenYear> {
  const years = await engagementOpenYears(engagementId);
  const year = [...years.open, ...years.closed].find((entry) => entry.key === yearKey);
  if (!year) notFound('No year with that key on this client.');
  return year;
}

async function filingProfile(clientId: string): Promise<ClientFilingProfileRow | null> {
  const rows = await requireDb()
    .select()
    .from(schema.clientFilingProfiles)
    .where(eq(schema.clientFilingProfiles.clientId, clientId));
  return rows[0] ?? null;
}

async function clientLocation(locationId: string): Promise<ClientLocationRow | null> {
  const rows = await requireDb()
    .select()
    .from(schema.clientLocations)
    .where(eq(schema.clientLocations.id, locationId));
  return rows[0] ?? null;
}

/** Where the property is, as the form's one line for it. */
function locationAddress(site: ClientLocationRow): string | null {
  const parts = [
    site.addressLine1,
    [site.city, site.stateCode].filter(Boolean).join(', '),
    site.zip,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ');
  return parts.trim() || null;
}

function cityStateZip(profile: ClientFilingProfileRow | null): string | null {
  if (profile === null) return null;
  const left = [profile.mailingCity, profile.mailingStateCode]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(', ');
  return [left, profile.mailingZip?.trim()].filter(Boolean).join(' ') || null;
}
