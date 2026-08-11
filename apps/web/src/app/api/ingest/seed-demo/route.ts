import { proxyIngest } from '@/lib/ingest-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Loads the synthetic county — clearly labelled as such throughout the UI. */
export function POST(request: Request): Promise<Response> {
  return proxyIngest(request, '/seed-demo');
}
