import { RecordAppointmentRequestSchema, type AgentAppointment } from '@tangible/types';
import { clientAppointments, recordAppointment } from '@/lib/appointments';
import { handle } from '@/lib/route';
import { fetchClient } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ clientId: string }> };

/** Every Form 50-162 on file for this client, newest signature first. */
export function GET(_request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<AgentAppointment[]> => {
    const { clientId } = await params;
    await fetchClient(clientId);
    return clientAppointments(clientId);
  });
}

/**
 * Record an appointment — usually before it has been filed.
 *
 * `filedOn` is optional for exactly that reason: the ordinary sequence is that
 * we produce the form, the client signs it, and it sits for a week before the
 * district has it. Recording it early is what makes that week visible.
 */
export function POST(request: Request, { params }: Params): Promise<Response> {
  return handle(async () => {
    const { clientId } = await params;
    await fetchClient(clientId);
    const body = RecordAppointmentRequestSchema.parse(await request.json());
    return recordAppointment(clientId, body);
  });
}
