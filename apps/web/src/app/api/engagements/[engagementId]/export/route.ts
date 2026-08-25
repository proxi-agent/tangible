import { buildEngagementWorkbook } from '@/lib/export-workbook';
import { HttpError } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The engagement as an Excel workbook: summary, Form 50-144 schedules per
 * return, the per-asset appraisal arithmetic, and the committed findings.
 *
 * A spreadsheet rather than a PDF because it is the working paper, not the
 * filing — the thing a client's controller opens next to their own register to
 * check the numbers, sum a column, or hand to their auditor.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  const { engagementId } = await params;
  try {
    const { bytes, filename } = await buildEngagementWorkbook(engagementId);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Could not build the workbook.';
    return Response.json({ error: message }, { status: 500 });
  }
}
