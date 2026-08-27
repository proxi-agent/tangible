import 'server-only';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { correctionOutlook } from '@tangible/filing';
import type {
  CorrectionMotion,
  CorrectionOutlook,
  ExtractedNotice,
  OpenYear,
  OpenYears,
  ResolutionStage,
} from '@tangible/types';
import { clientMotions, motionKey, spentBy } from '@/lib/motions';
import { today as todayIso } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Which of this client's years are still fixable.
 *
 * The notice panel asks 25.25 of one notice we typed. This asks it of the
 * client's whole history, including the years nobody here worked — which is the
 * question a prospect actually opens with. A firm that can only answer for the
 * season in front of it sells one protest a year; a firm that can look back
 * five and say "two of these are still open, here is the route" is selling
 * something else.
 *
 * Read through the *client*, not the engagement, for the same reason the
 * carry-forward is: one engagement is one tax year, and every prior year hangs
 * off a different engagement row.
 *
 * Two sources, and the difference between them is the whole honesty of the
 * screen:
 *
 *   - **Notices we recorded.** We hold the protest date and the ending, so the
 *     bars in 25.25(c-1) and (d-1) are answerable and a route called open is
 *     open.
 *   - **Notices the client uploaded.** A scan prints a value and a year. It
 *     does not print whether somebody settled the year on the phone with the
 *     chief appraiser — and under 1.111(e) that agreement is final and closes
 *     two of the three routes. So the outlook is computed with `historyKnown:
 *     false`, and it says out loud that the district has to be asked.
 *
 * The grain is (account, year). A prior document names an account and a year
 * and nothing else we could key on, and forcing it onto a site would either
 * invent a link or throw the document away.
 *
 * Motions brought under 25.25 are folded in on the same key, and they are not
 * decoration. 25.25(c-1)(3) closes (c-1) once a previous motion on the property
 * and year was agreed to, determined, or forfeited — so a firm's own earlier
 * filing is one of the bars this screen has to know about, and reading motions
 * client-wide rather than per engagement is what makes last season's motion
 * visible to this season's answer.
 */
export async function engagementOpenYears(engagementId: string): Promise<OpenYears> {
  const { engagement } = await fetchEngagement(engagementId);
  const today = todayIso();
  const motions = await clientMotions(engagement.clientId);

  // Grouped before the outlooks are computed, because a motion is an input to
  // one — not something hung on the answer afterwards.
  const byYear = new Map<string, CorrectionMotion[]>();
  for (const motion of motions) {
    const key = motionKey(motion.accountId, motion.subjectTaxYear, motion.locationId);
    byYear.set(key, [...(byYear.get(key) ?? []), motion]);
  }

  const [recorded, uploaded] = await Promise.all([
    recordedYears(engagement.clientId, today, byYear),
    uploadedYears(engagement.clientId, today, byYear),
  ]);

  // Ours wins on a collision. Both rows describe the same account and year, and
  // only one of them knows how the protest ended.
  const byKey = new Map<string, OpenYear>();
  for (const year of [...uploaded, ...recorded]) byKey.set(year.key, year);

  // A motion whose year has no paper on either side still gets a row. Losing it
  // would not just hide the filing — it would hide the bar the filing created.
  for (const [key, filed] of byYear) {
    if (byKey.has(key)) continue;
    byKey.set(key, motionOnlyYear(key, filed, today));
  }
  const years = [...byKey.values()];

  return {
    clientId: engagement.clientId,
    // Soonest to close first, which is oldest first — the reverse of how every
    // other list in this app is ordered, and deliberate. A list of open years
    // is a list of deadlines, and the one about to run out is the oldest year,
    // not the newest.
    open: years.filter((year) => year.outlook.open).sort(byUrgency),
    closed: years.filter((year) => !year.outlook.open).sort((a, b) => b.taxYear - a.taxYear),
  };
}

/** The earliest date on which this year loses a route, if it has one. */
function closesOn(year: OpenYear): string {
  const dates = year.outlook.routes
    .filter((route) => route.open && route.deadline !== null)
    .map((route) => route.deadline as string)
    .sort();
  return dates[0] ?? '9999-12-31';
}

function byUrgency(a: OpenYear, b: OpenYear): number {
  const closing = closesOn(a).localeCompare(closesOn(b));
  return closing !== 0 ? closing : a.taxYear - b.taxYear;
}

/**
 * Years we ran.
 *
 * Active notices only. A superseded notice was replaced by a corrected one that
 * is also in this list, and a voided one was never ours — either would put a
 * second row on the same account and year, and the second row would disagree
 * with the first about a value.
 */
async function recordedYears(
  clientId: string,
  today: string,
  motions: Map<string, CorrectionMotion[]>,
): Promise<OpenYear[]> {
  const db = requireDb();
  const notices = await db
    .select({
      id: schema.assessmentNotices.id,
      locationLabel: schema.assessmentNotices.locationLabel,
      locationId: schema.assessmentNotices.locationId,
      accountId: schema.assessmentNotices.accountId,
      taxYear: schema.assessmentNotices.taxYear,
      districtName: schema.assessmentNotices.districtName,
      appraisedValue: schema.assessmentNotices.appraisedValue,
      renditionPenaltyApplied: schema.assessmentNotices.renditionPenaltyApplied,
      protestFiledOn: schema.assessmentNotices.protestFiledOn,
    })
    .from(schema.assessmentNotices)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.assessmentNotices.engagementId))
    .where(
      and(eq(schema.engagements.clientId, clientId), eq(schema.assessmentNotices.status, 'active')),
    )
    .orderBy(desc(schema.assessmentNotices.taxYear));
  if (notices.length === 0) return [];

  const endings = await standingEndings(notices.map((notice) => notice.id));

  return notices.map((notice) => {
    const ending = endings.get(notice.id) ?? null;
    // Keyed on the account where there is one, and on the site where there is
    // not — a site with no account number yet is still a real return, and
    // keying every one of them on the empty string would collapse them.
    const key = motionKey(notice.accountId, notice.taxYear, notice.locationId);
    const filed = motions.get(key) ?? [];
    const outlook = correctionOutlook(
      {
        taxYear: notice.taxYear,
        rolledValue: notice.appraisedValue,
        renditionPenaltyApplied: notice.renditionPenaltyApplied,
        ending,
        historyKnown: true,
        priorMotion: spentBy(filed),
      },
      today,
    );
    return {
      key,
      taxYear: notice.taxYear,
      source: 'recorded' as const,
      label: notice.locationLabel,
      accountId: notice.accountId,
      locationId: notice.locationId,
      districtName: notice.districtName,
      rolledValue: notice.appraisedValue,
      noticeId: notice.id,
      documentId: null,
      outlook,
      motions: filed,
    };
  });
}

/** How each of these protests ended, where an ending stands. */
async function standingEndings(
  noticeIds: readonly string[],
): Promise<Map<string, ResolutionStage>> {
  const rows = await requireDb()
    .select({
      noticeId: schema.protestResolutions.noticeId,
      stage: schema.protestResolutions.stage,
    })
    .from(schema.protestResolutions)
    .where(
      and(
        inArray(schema.protestResolutions.noticeId, [...noticeIds]),
        eq(schema.protestResolutions.status, 'recorded'),
      ),
    );
  return new Map(rows.map((row) => [row.noticeId, row.stage as ResolutionStage]));
}

/**
 * Years whose only paper is a scan.
 *
 * Read documents only — an upload still in the queue has no year to key on and
 * no value to measure against. `discrepant` counts: a notice's arithmetic is
 * the district's, and a discrepancy in it is a reason to look at the year
 * rather than a reason to drop it.
 */
async function uploadedYears(
  clientId: string,
  today: string,
  motions: Map<string, CorrectionMotion[]>,
): Promise<OpenYear[]> {
  const db = requireDb();
  const [documents, locations] = await Promise.all([
    db
      .select({
        id: schema.priorDocuments.id,
        originalFilename: schema.priorDocuments.originalFilename,
        accountId: schema.priorDocuments.documentAccountId,
        taxYear: schema.priorDocuments.documentTaxYear,
        extracted: schema.priorDocuments.extracted,
      })
      .from(schema.priorDocuments)
      .innerJoin(schema.engagements, eq(schema.engagements.id, schema.priorDocuments.engagementId))
      .where(
        and(
          eq(schema.engagements.clientId, clientId),
          eq(schema.priorDocuments.kind, 'notice'),
          inArray(schema.priorDocuments.status, ['verified', 'discrepant', 'accepted']),
          isNotNull(schema.priorDocuments.documentTaxYear),
        ),
      )
      .orderBy(desc(schema.priorDocuments.documentTaxYear), desc(schema.priorDocuments.createdAt)),
    db
      .select({ accountId: schema.clientLocations.accountId, label: schema.clientLocations.label })
      .from(schema.clientLocations)
      .where(eq(schema.clientLocations.clientId, clientId)),
  ]);

  const labels = new Map<string, string>();
  for (const site of locations) if (site.accountId) labels.set(site.accountId, site.label);

  return documents.map((document) => {
    const notice = (document.extracted as ExtractedNotice | null) ?? null;
    const taxYear = document.taxYear as number;
    const key = document.accountId
      ? motionKey(document.accountId, taxYear, null)
      : `doc:${document.id}:${taxYear}`;
    const filed = motions.get(key) ?? [];
    const outlook: CorrectionOutlook = correctionOutlook(
      {
        taxYear,
        rolledValue: notice?.appraisedValue ?? null,
        renditionPenaltyApplied: notice?.renditionPenaltyApplied ?? null,
        // A scan cannot say a protest ended, and it cannot say one did not.
        ending: null,
        historyKnown: false,
        // A motion is ours, though. It is the one part of this year's history
        // that does not depend on the client remembering.
        priorMotion: spentBy(filed),
      },
      today,
    );
    return {
      key,
      taxYear,
      source: 'uploaded' as const,
      label:
        (document.accountId ? labels.get(document.accountId) : undefined) ??
        (document.accountId ? `Account ${document.accountId}` : document.originalFilename),
      accountId: document.accountId,
      locationId: null,
      districtName: notice?.districtName ?? null,
      rolledValue: notice?.appraisedValue ?? null,
      noticeId: null,
      documentId: document.id,
      outlook,
      motions: filed,
    };
  });
}

/**
 * A year we hold no notice for and moved on anyway.
 *
 * `historyKnown: false`, and for a sharper reason than an uploaded year: there
 * is no paper here at all. What the roll said comes off the motion itself,
 * where the firm copied it at filing — which is the only value on file, and the
 * reason the motion carries one.
 */
function motionOnlyYear(key: string, filed: CorrectionMotion[], today: string): OpenYear {
  const first = filed[0] as CorrectionMotion;
  const rolledValue = filed.map((motion) => motion.rolledValue).find((v) => v !== null) ?? null;
  return {
    key,
    taxYear: first.subjectTaxYear,
    source: 'motion' as const,
    label: first.locationLabel ?? (first.accountId ? `Account ${first.accountId}` : 'No site'),
    accountId: first.accountId,
    locationId: first.locationId,
    districtName: first.districtName,
    rolledValue,
    noticeId: null,
    documentId: null,
    outlook: correctionOutlook(
      {
        taxYear: first.subjectTaxYear,
        rolledValue,
        renditionPenaltyApplied: null,
        ending: null,
        historyKnown: false,
        priorMotion: spentBy(filed),
      },
      today,
    ),
    motions: filed,
  };
}
