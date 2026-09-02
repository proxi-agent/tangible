import { proposeForFile } from '@/lib/mapping';
import { handle } from '@/lib/route';
import { fetchFarFile } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Ask for a mapping proposal on a parsed file. The work — and the reasons for
 * every part of it — is in {@link proposeForFile}, which the autopilot calls
 * with no request in front of it.
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { fileId } = await params;
    return proposeForFile(await fetchFarFile(fileId));
  });
}
