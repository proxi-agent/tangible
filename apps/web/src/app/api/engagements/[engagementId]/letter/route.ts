import { draftLetter, latestResultLetter } from '@/lib/letter';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The newest drafted result letter, or `{ letter: null }`. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return { letter: await latestResultLetter(engagementId) };
  });
}

/**
 * Draft a letter from the scoreboard as it stands now.
 *
 * A new row every time, never an edit — a settlement lands and the letter is
 * redrafted, and the older draft stays readable as what the season said then.
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return { letter: await draftLetter(engagementId) };
  });
}
