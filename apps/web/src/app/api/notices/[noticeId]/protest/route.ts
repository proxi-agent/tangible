import { buildProtestPdf, protestFormOptions } from '@/lib/protest-forms';
import { formFailure, params as queryParams } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The notice of protest on the Comptroller's own Form 50-132, as a filled PDF.
 *
 * Fillable rather than flattened and with the signature box empty, same as
 * every other form this wing prints: it is a draft for somebody to check, sign
 * and deliver before the deadline the panel above it is counting down.
 *
 * A 409 here is the form refusing to print something misleading — no ground
 * ticked, nothing identifying the property, a ground whose rider is blank —
 * and the message says which. That refusal matters more on this form than on
 * the others, because filing it spends the protest window whether or not the
 * page preserves anything.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ noticeId: string }> },
): Promise<Response> {
  const { noticeId } = await params;
  try {
    const options = protestFormOptions(queryParams(request));
    const { bytes, plan, filename } = await buildProtestPdf(noticeId, options);
    const blocking = plan.omissions.filter((o) => o.severity === 'blocking').length;
    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-form-revision': plan.revision,
        'x-form-omissions': String(blocking),
      },
    });
  } catch (error) {
    return formFailure(error);
  }
}
