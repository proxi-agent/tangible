import type { OpenYears } from '@tangible/types';
import { engagementOpenYears } from '@/lib/open-years';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every year of this client's history that 25.25 can still reach.
 *
 * Client-wide rather than engagement-wide on purpose: the years worth money are
 * the ones before the firm was hired, and those hang off other engagements or
 * off no engagement at all.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<OpenYears> => {
    const { engagementId } = await params;
    return engagementOpenYears(engagementId);
  });
}
