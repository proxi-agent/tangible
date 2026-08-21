import { UpdateAppointmentRequestSchema } from '@tangible/types';
import { updateAppointment } from '@/lib/appointments';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The two things that happen to an appointment after it is signed: it reaches
 * the district, or it ends. Neither is a correction, so neither rewrites what
 * the form said.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ appointmentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { appointmentId } = await params;
    const body = UpdateAppointmentRequestSchema.parse(await request.json());
    return updateAppointment(appointmentId, body);
  });
}
