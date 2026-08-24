import { and, eq } from 'drizzle-orm';
import { proposeNoticeRecord } from '@tangible/filing';
import type { ExtractedNotice, NoticeRecordProposal } from '@tangible/types';
import { handle, HttpError, notFound } from '@/lib/route';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the intake would record for this notice, if a person says yes.
 *
 * Computed fresh on every read — off the stored extraction, the sites as they
 * stand now, and the notices already on file — because the proposal is advice
 * about the current state of the engagement, not a fact about the upload. A
 * site that gained its account number since the scan was read starts matching
 * without anyone re-extracting anything.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async (): Promise<NoticeRecordProposal> => {
    const { documentId } = await params;
    const db = requireDb();
    const [row] = await db
      .select()
      .from(schema.priorDocuments)
      .where(eq(schema.priorDocuments.id, documentId));
    if (!row) return notFound(`Unknown prior document: ${documentId}`);
    if (row.kind !== 'notice') {
      throw new HttpError(409, 'Only a notice of appraised value can be proposed as a notice record.');
    }
    if (!row.extracted) {
      throw new HttpError(409, 'This notice has not been read yet — extract it first.');
    }

    const { engagement, client } = await fetchEngagement(row.engagementId);
    const { returns } = await engagementReturns(row.engagementId);

    const proposal = proposeNoticeRecord(documentId, row.extracted as ExtractedNotice, {
      taxYear: engagement.taxYear,
      clientName: client.name,
      sites: returns.map((r) => ({ locationId: r.locationId, label: r.label, accountId: r.accountId })),
    });

    let alreadyRecorded = false;
    if (proposal.match) {
      const [standing] = await db
        .select({ id: schema.assessmentNotices.id })
        .from(schema.assessmentNotices)
        .where(
          and(
            eq(schema.assessmentNotices.locationId, proposal.match.locationId),
            eq(schema.assessmentNotices.taxYear, engagement.taxYear),
            eq(schema.assessmentNotices.status, 'active'),
          ),
        )
        .limit(1);
      alreadyRecorded = standing !== undefined;
    }

    return { ...proposal, alreadyRecorded };
  });
}
