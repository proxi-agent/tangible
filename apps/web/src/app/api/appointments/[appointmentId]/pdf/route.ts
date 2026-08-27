import { buildAppointmentPdf } from '@/lib/appointments';
import { formFailure } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Form 50-162 on the Comptroller's own PDF, ready for the client to sign.
 *
 * A 409 here is the form refusing to print something misleading — an
 * appointment naming more sites than Step 2 has rows, or an agent record with
 * no name in it — and the message says which.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ appointmentId: string }> },
): Promise<Response> {
  const { appointmentId } = await params;
  try {
    const { bytes, filename } = await buildAppointmentPdf(appointmentId);
    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return formFailure(error);
  }
}
