import { SettleFeeStatementSchema } from '@tangible/types';
import { settleFeeStatement } from '@/lib/fees';
import { handle } from '@/lib/route';
import { requireFirm } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Paid, or voided with a reason. A statement is never edited. */
export function POST(request: Request, context: { params: Promise<{ statementId: string }> }) {
  return handle(async () => {
    await requireFirm();
    const { statementId } = await context.params;
    return settleFeeStatement(statementId, SettleFeeStatementSchema.parse(await request.json()));
  });
}
