import { hintsForFile } from '@/lib/mapping-memory';
import { handle } from '@/lib/route';
import { fetchFarFile } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the firm has already settled about the headers in this file.
 *
 * Read-only and advisory: the mapping screen shows these next to the columns
 * they name, and a reviewer decides. Nothing here writes a mapping, and a hint
 * the reviewer ignores costs nothing — the next confirm simply records what
 * they chose instead.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { fileId } = await params;
    const row = await fetchFarFile(fileId);
    return { hints: await hintsForFile(row) };
  });
}
