import { proxyIngest } from '@/lib/ingest-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Kicks off a background ingest on the local server and returns the run to poll. */
export function POST(request: Request): Promise<Response> {
  return proxyIngest(request, '');
}
