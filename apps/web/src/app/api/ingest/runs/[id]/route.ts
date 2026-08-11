import { proxyIngest } from '@/lib/ingest-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return proxyIngest(request, `/runs/${encodeURIComponent((await params).id)}`);
}
