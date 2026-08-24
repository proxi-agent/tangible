import { fileAsks } from '@/lib/asks';
import { handle } from '@/lib/route';
import { fetchFarFile } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The asks ledger for this file — every question raised, worked or not. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { fileId } = await params;
    await fetchFarFile(fileId);
    return { items: await fileAsks(fileId) };
  });
}
