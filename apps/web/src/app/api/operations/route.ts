import { handle } from '@/lib/route';
import { operationsView } from '@/lib/operations';
import { requireFirm } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What is broken, when anything last checked, and whether anyone would be told. */
export function GET(): Promise<Response> {
  return handle(async () => {
    await requireFirm();
    return operationsView();
  });
}
