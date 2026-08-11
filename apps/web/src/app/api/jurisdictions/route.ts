import { listJurisdictionSummaries } from '@tangible/ingest/catalog';
import { handle } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(): Promise<Response> {
  return handle(async () => listJurisdictionSummaries(await getWarehouse()));
}
