import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientFilingProfileRow } from '@tangible/db';
import {
  appraisalDistrictCounty,
  appraisalDistrictName,
  planProtestFill,
  renderForm50132,
  PROTEST_REASONS,
  type ProtestAppearance,
  type ProtestFillPlan,
} from '@tangible/filing';
import type { AssessmentNotice } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { appointmentAt } from '@/lib/appointments';
import { latestBrief } from '@/lib/briefs';
import { engagementFilings } from '@/lib/filings';
import { HttpError, notFound } from '@/lib/http';
import { engagementNotices } from '@/lib/notices';
import { engagementReturns } from '@/lib/sites';
import { today } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The protest we already track, written onto the Comptroller's Form 50-132.
 *
 * The panel has held everything this form asks for since the notice was
 * recorded — the deadline, the district, the site, the value we filed, the
 * argument — and the one thing it could not do was print the page an ARB
 * accepts. A brief is not a protest: 41.44 wants a written notice identifying
 * the owner, the property and what is being protested, and a firm that drafted
 * the argument and never filed the form has spent the window on prose.
 *
 * Assembled here rather than in the package for the same reason as the
 * rendition: most of it is database. Which box each answer goes in, and what
 * refuses to print, is `planProtestFill`'s job.
 */

/** What the caller may say about a protest, over and above what we hold. */
const OptionsSchema = z.object({
  /**
   * Which grounds to tick. Defaults to the value ground, because that is what
   * an assessment notice is about and because Section 3's own instruction is
   * that an unticked ground is not preserved — but a protest brought on any of
   * the other fourteen is a protest this route can print.
   */
  reasons: z
    .string()
    .optional()
    .transform((raw) => (raw ? raw.split(',').map((part) => part.trim()) : ['value']))
    .pipe(z.array(z.enum(PROTEST_REASONS)).min(1)),
  /** Section 4's opinion of value. Absent falls back to what we filed. */
  value: z.coerce.number().nonnegative().optional(),
  appearance: z
    .enum(['in-person', 'telephone', 'videoconference', 'affidavit'])
    .optional()
    .transform((v): ProtestAppearance | null => v ?? null),
  /** 41.445's informal conference before the hearing. */
  informal: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? null : v === 'true')),
  delivery: z
    .enum(['first-class', 'certified'])
    .optional()
    .transform((v) => v ?? null),
  /** What the other ground is, where `other` is among the reasons. */
  other: z.string().trim().max(200).optional(),
  /** Which taxing unit, for the wrong-taxing-unit ground. */
  unit: z.string().trim().max(200).optional(),
  /** Which notice was not sent, for the no-notice ground. */
  notice: z.string().trim().max(200).optional(),
});

export type ProtestFormOptions = z.input<typeof OptionsSchema>;

/**
 * Read the query string, saying so in a sentence when it will not read.
 *
 * A Zod error out of a download route reaches the user as an unhandled 500 and
 * a file that never arrives, which is exactly the failure `DownloadButton`
 * exists to prevent. A misspelled ground is a typo in a link, not a fault.
 */
export function protestFormOptions(raw: Record<string, string | undefined>) {
  const parsed = OptionsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new HttpError(
    400,
    `That is not a protest this form can print: ${first?.message ?? 'the request did not read'}.`,
  );
}

export interface ProtestFormPdf {
  bytes: Uint8Array;
  plan: ProtestFillPlan;
  filename: string;
}

/**
 * Form 50-132 for one recorded notice.
 *
 * The opinion of value is the one figure with a real choice behind it, and the
 * order is deliberate: what the caller asked for, then what the drafted brief
 * asks the board to set, then the schedule value of the return this notice
 * answered. Every one of the three is a number the firm has already stood
 * behind. None of them is a guess — where all three are absent Section 4 is
 * left blank, which is what the form's own "if known" contemplates.
 */
export async function buildProtestPdf(
  noticeId: string,
  options: z.output<typeof OptionsSchema>,
): Promise<ProtestFormPdf> {
  const notice = await fetchNotice(noticeId);
  const { engagement, client } = await fetchEngagement(notice.engagementId);
  const [profile, owed, filings, brief, actor] = await Promise.all([
    filingProfile(client.id),
    engagementReturns(notice.engagementId),
    engagementFilings(notice.engagementId),
    latestBrief(noticeId),
    currentActor(),
  ]);

  const site = owed.returns.find((entry) => entry.locationId === notice.locationId) ?? null;
  const jurisdictionId = site?.jurisdictionId ?? engagement.jurisdictionId;
  const filed =
    filings.find(
      (entry) =>
        entry.status === 'filed' &&
        entry.locationId === notice.locationId &&
        entry.taxYear === notice.taxYear,
    ) ?? null;

  // The form is signed the day it is printed, because the day it is signed is
  // the day it has to be in the district's hands and a stale date on a filed
  // protest is a date somebody has to explain.
  const signedOn = today();
  const appointment = jurisdictionId
    ? await appointmentAt(client.id, {
        jurisdictionId,
        locationId: notice.locationId,
        on: signedOn,
      })
    : null;

  const plan = planProtestFill({
    district: {
      county: jurisdictionId ? appraisalDistrictCounty(jurisdictionId) : null,
      // What the notice called itself beats the directory: the district is the
      // one that sent it, whatever our table says it is called this year.
      name: notice.districtName ?? (jurisdictionId ? appraisalDistrictName(jurisdictionId) : null),
    },
    taxYear: notice.taxYear,
    owner: {
      name: profile?.ownerName ?? client.name,
      mailingAddress: mailingAddress(profile),
      phone: null,
    },
    property: {
      accountId: notice.accountId ?? site?.accountId ?? null,
      situsAddress: site && site.addressLines.length > 0 ? site.addressLines.join(', ') : null,
      legalDescription: null,
    },
    grounds: {
      reasons: options.reasons,
      taxingUnit: options.unit ?? null,
      noticeType: options.notice ?? null,
      otherReason: options.other ?? null,
      opinionOfValue: options.value ?? brief?.brief.valueRequested ?? filed?.scheduleValue ?? null,
      // The drafted summary, where one has been drafted and fits. The planner
      // counts an over-long box as an omission rather than cutting it, so a
      // long summary surfaces as a warning and the argument stays whole in the
      // brief where it was written.
      facts: brief?.brief.summary ?? null,
    },
    hearing: {
      informalConference: options.informal,
      panel: null,
      appearance: options.appearance,
      noticeDelivery: options.delivery,
      wantsHearingProcedures: null,
      reminder: null,
      mobileNumber: null,
      emailAddress: null,
      specialPanel: null,
    },
    signer: {
      name: actor ?? '',
      capacity: 'agent',
      otherDescription: null,
      // 1.111(a): an agent signs on an appointment that was in force on the
      // day the protest goes in, not on one that has merely been signed.
      appointmentOnFile: appointment === null ? null : appointment.effective,
      signedOn,
    },
    renditionPenaltyApplied: notice.renditionPenaltyApplied,
  });

  const bytes = await renderForm50132(plan);
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const where = owed.returns.length > 1 ? `-${slug(notice.locationLabel)}` : '';
  return {
    bytes,
    plan,
    filename: `50-132-${slug(client.name)}${where}-${notice.taxYear}.pdf`,
  };
}

/**
 * The notice, decorated, authorized through its engagement — the same read the
 * brief pipeline does, and for the same reason: standing, checks and resolution
 * are computed on the way out, and half of what this form says about the
 * protest is in them.
 */
async function fetchNotice(noticeId: string): Promise<AssessmentNotice> {
  const rows = await requireDb()
    .select({ engagementId: schema.assessmentNotices.engagementId })
    .from(schema.assessmentNotices)
    .where(eq(schema.assessmentNotices.id, noticeId));
  const row = rows[0];
  if (!row) notFound('No notice with that id.');
  const notices = await engagementNotices(row.engagementId);
  const notice = notices.find((entry) => entry.id === noticeId);
  if (!notice) notFound('No notice with that id.');
  return notice;
}

async function filingProfile(clientId: string): Promise<ClientFilingProfileRow | null> {
  const rows = await requireDb()
    .select()
    .from(schema.clientFilingProfiles)
    .where(eq(schema.clientFilingProfiles.clientId, clientId));
  return rows[0] ?? null;
}

/** Section 1's single address line, which is where the ARB's notice goes. */
function mailingAddress(profile: ClientFilingProfileRow | null): string | null {
  if (profile === null) return null;
  const kept = (parts: readonly (string | null)[]) =>
    parts.filter((part): part is string => Boolean(part?.trim()));
  const lines = kept([profile.mailingAddressLine1, profile.mailingAddressLine2]);
  const city = kept([profile.mailingCity, profile.mailingStateCode]).join(', ');
  const tail = kept([city, profile.mailingZip]).join(' ');
  return kept([...lines, tail]).join(', ') || null;
}
