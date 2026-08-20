import { RenditionRequestSchema } from '@tangible/types';
import { buildEngagementFormPdf } from '@/lib/rendition';
import { params as queryParams } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The rendition on the Comptroller's own Form 50-144, as a filled PDF.
 *
 * Returned fillable rather than flattened, and with the signature and date
 * boxes empty: this is a draft for somebody to check, sign and send, not a
 * finished filing. What the data could not answer travels in the
 * `X-Form-Omissions` header so the caller can say so without opening the file —
 * the boxes themselves are simply blank, which is the honest rendering of a
 * fact we do not have.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  const { engagementId } = await params;
  const raw = queryParams(request);
  const { basis, filedByAgent } = RenditionRequestSchema.parse({
    basis: raw.basis ?? 'cost',
    filedByAgent: raw.filedByAgent === undefined ? true : raw.filedByAgent === 'true',
  });

  try {
    const { bytes, plan, filename } = await buildEngagementFormPdf(engagementId, {
      basis,
      filedByAgent,
    });
    const blocking = plan.omissions.filter((o) => o.severity === 'blocking').length;
    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-form-revision': plan.revision,
        'x-form-omissions': String(blocking),
        'x-form-overflow': String(plan.overflow.length),
      },
    });
  } catch (error) {
    // The two failures this can have are both worth reading in full: the tax
    // year does not match the pinned revision's printed ladder, or the form has
    // been republished with different field names. Neither is a 500 — they are
    // statements about which piece of paper this is.
    const message = error instanceof Error ? error.message : 'Could not build the form.';
    return Response.json({ error: message }, { status: 409 });
  }
}
