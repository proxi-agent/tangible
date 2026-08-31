import { buildMotionPdf, motionFormOptions } from '@/lib/correction-forms';
import { formFailure, params as queryParams } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The drafted 25.25 motion on the Comptroller's own form, as a filled PDF.
 *
 * Which form comes off the route the draft was written under — 50-771 for (c)
 * and (c-1), 50-230 for (d) — and the response says which in `x-form`, because
 * two routes on one year print two different pieces of paper and the filename
 * is the only other place that shows.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  const { engagementId } = await params;
  try {
    const options = motionFormOptions(queryParams(request));
    const { bytes, revision, omissions, form, filename } = await buildMotionPdf(
      engagementId,
      options,
    );
    const blocking = omissions.filter((o) => o.severity === 'blocking').length;
    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-form': form,
        'x-form-revision': revision,
        'x-form-omissions': String(blocking),
      },
    });
  } catch (error) {
    return formFailure(error);
  }
}
