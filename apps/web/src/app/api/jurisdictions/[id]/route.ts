import { findJurisdictionSummary } from '@tangible/ingest/catalog';
import { handle, notFound } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const jurisdiction = await findJurisdictionSummary(await getWarehouse(), id);
    return jurisdiction ?? notFound(`Unknown jurisdiction: ${id}`);
  });
}
