import {
  INTAKE_ACTIONS,
  fetchIntakeFile,
  intakeFileDto,
  routeIntakeFile,
  type IntakeAction,
} from '@/lib/intake';
import { HttpError, handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The human decision triage was waiting for.
 *
 * The work is in {@link routeIntakeFile}, which the autopilot also calls; this
 * handler is the reviewer's entrance to it. The proposal never routes anything
 * by itself, and this endpoint does not read it — it acts only on the route in
 * the request body, which is the reviewer's.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ intakeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { intakeId } = await params;
    const row = await fetchIntakeFile(intakeId);

    const body = (await request.json().catch(() => ({}))) as { route?: string };
    const action = INTAKE_ACTIONS.find((one): one is IntakeAction => one === body.route);
    if (!action) {
      throw new HttpError(400, "Send { route: 'register' | 'rendition' | 'notice' | 'dismiss' }.");
    }

    return intakeFileDto(await routeIntakeFile(row, action));
  });
}
