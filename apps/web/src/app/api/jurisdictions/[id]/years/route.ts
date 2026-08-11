import { listAvailableYears } from '@tangible/ingest/catalog';
import { handle } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => listAvailableYears(await getWarehouse(), (await params).id));
}
