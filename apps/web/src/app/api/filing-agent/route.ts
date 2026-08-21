import { UpdateFilingAgentRequestSchema, type FilingAgent } from '@tangible/types';
import { filingAgent, updateFilingAgent } from '@/lib/appointments';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who we are, as Step 3 of Form 50-162 names us.
 *
 * One record for the firm rather than one per client. Unauthenticated reads are
 * the same as everywhere else in this app — it is our own name and business
 * address, which is on every form we file anyway.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<FilingAgent> => filingAgent());
}

export function PATCH(request: Request): Promise<Response> {
  return handle(async () => {
    const body = UpdateFilingAgentRequestSchema.parse(await request.json());
    return updateFilingAgent(body);
  });
}
