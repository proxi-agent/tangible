import { proxyIngest } from '@/lib/ingest-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(request: Request): Promise<Response> {
  return proxyIngest(request, '/runs');
}
