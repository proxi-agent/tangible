import { buildFiledFormPdf } from '@/lib/filings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The filed rendition on the Comptroller's PDF, rebuilt from frozen inputs.
 *
 * Unlike the draft's PDF this takes no options: a filed return has one basis,
 * one capacity and one set of numbers, all settled the day it went out.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filingId: string }> },
): Promise<Response> {
  const { filingId } = await params;
  try {
    const { bytes, filename } = await buildFiledFormPdf(filingId);
    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not build the form.';
    return Response.json({ error: message }, { status: 409 });
  }
}
