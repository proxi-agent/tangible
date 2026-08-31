import { buildFindingRowsWorkbook } from '@/lib/export-workbook';
import { withClientScope } from '@/lib/db-scope';
import { parseFilters } from '@/lib/finding-rows';
import { HttpError } from '@/lib/route';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The current view of one finding, as a spreadsheet.
 *
 * Same filter, same rows, same order as the screen — the query string the table
 * was built from is the query string this reads. That is the whole point: the
 * export a controller sends to their auditor has to be the list they were
 * looking at when they decided, not the finding in full.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  const { engagementId } = await params;
  try {
    const viewer = await requireEngagementScope(engagementId);
    const url = new URL(request.url);
    const findingKey = url.searchParams.get('finding');
    if (!findingKey) throw new HttpError(400, 'Name the finding to export.');

    /**
     * This is the one route a client can reach that does not go through
     * `handle()` — it answers with a spreadsheet rather than JSON, so it owns
     * its own error handling. That also means it does not inherit the tenancy
     * scope `handle()` opens, and it has to open the same one itself. Any route
     * added here that returns bytes instead of JSON needs this line too.
     */
    const build = () => buildFindingRowsWorkbook(engagementId, findingKey, parseFilters(url));
    const { bytes, filename } =
      viewer.audience === 'client' && viewer.clientId
        ? await withClientScope(viewer.clientId, build)
        : await build();

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json(
        { statusCode: error.status, message: error.message },
        { status: error.status },
      );
    }
    console.error('[export:finding-rows]', error);
    const message = error instanceof Error ? error.message : 'Could not build the workbook.';
    return Response.json(
      {
        statusCode: 500,
        message:
          process.env.NODE_ENV === 'production' ? 'The workbook could not be built.' : message,
      },
      { status: 500 },
    );
  }
}
