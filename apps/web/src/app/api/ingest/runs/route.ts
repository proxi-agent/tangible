import { proxyIngest } from '@/lib/ingest-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyIngest(request, '/runs');
}
