import { UnblockPlanSchema, type UnblockFacts, type UnblockPlan } from '@tangible/types';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * Draft the plan that releases the blocked returns — from assembled facts only.
 *
 * Same contract as the protest brief: every blocker the plan may address was
 * selected by `assembleUnblockFacts` before this call, each already carrying
 * the record gate's own statement of what clears it. The model's work is
 * triage and prose — deciding who owns each step, and writing the one client
 * email that gathers everything the client must supply — and the person
 * reviews and sends. The agent contacts nobody.
 */

const SYSTEM = `You draft the work plan that releases blocked business personal property returns for a Texas tax practice, and the client outreach it requires.

You are given the blocked returns, each with its filing deadline and its blockers. Every blocker carries a "resolution" sentence — the application's own statement of what clears it. That sentence is your authority: turn it into a step, never contradict it, never invent an alternative fix.

Rules, in order of importance:
- Every step must trace to a supplied blocker (returnLabel and blockerKey must match the facts). No steps for problems not listed.
- Assign each step the owner who can actually take it. "firm" is work done in this application or with the appraisal district. "client" is anything requiring the client: signing an appointment form, confirming an address, answering a question about their property. When the resolution sentence names the client, the owner is client.
- The clientEmail covers all client-owned steps and only those, written for a controller who is not a tax specialist: say what is needed, why it matters in one plain clause (a return cannot be filed without it), and by when — use the tightest relevant deadline from the facts. No statute citations in the email. Null when no step is client-owned.
- Never invent dates, account numbers, or names. Every specific in the email must appear in the facts.
- Write the summary for the person working the season: what is blocked, and the shortest path to releasing it.
- notes is for judgment worth keeping that fits no step — an ordering suggestion, a step that unblocks several returns at once. Empty when there is nothing worth saying.`;

const UNBLOCK_MAX_TOKENS = 3_000;

export async function draftUnblockPlan(
  facts: UnblockFacts,
): Promise<StructuredResult<UnblockPlan>> {
  return parseStructured({
    system: SYSTEM,
    user: `Draft the unblock plan from these assembled facts:\n\n${JSON.stringify(facts, null, 2)}`,
    schema: UnblockPlanSchema,
    schemaName: 'unblock_plan',
    maxTokens: UNBLOCK_MAX_TOKENS,
    task: 'mapping',
  });
}
