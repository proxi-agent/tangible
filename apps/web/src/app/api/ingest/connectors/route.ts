import { listConnectors } from '@tangible/ingest/catalog';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Which jurisdictions can be ingested, and from where.
 *
 * Served locally rather than proxied: the connector registry is compiled into
 * the app, so a deployment that cannot *run* an ingest can still say what the
 * pipeline covers.
 */
export function GET(): Promise<Response> {
  return handle(async () =>
    listConnectors().map((c) => ({
      id: c.id,
      jurisdiction: c.jurisdiction,
      format: { delimiter: c.format.delimiter, encoding: c.format.encoding },
    })),
  );
}
