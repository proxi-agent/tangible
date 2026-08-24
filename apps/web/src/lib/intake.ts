import 'server-only';
import { eq } from 'drizzle-orm';
import type { IntakeFile } from '@tangible/types';
import { HttpError } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

type IntakeRow = typeof schema.intakeFiles.$inferSelect;

export function intakeFileDto(row: IntakeRow): IntakeFile {
  return {
    id: row.id,
    engagementId: row.engagementId,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    contentType: row.contentType,
    sheetNames: (row.sheetNames as string[] | null) ?? null,
    proposedRoute: (row.proposedRoute as IntakeFile['proposedRoute']) ?? null,
    proposedConfidence: row.proposedConfidence,
    proposedReason: row.proposedReason,
    triageModel: row.triageModel,
    status: row.status as IntakeFile['status'],
    routedKind: (row.routedKind as IntakeFile['routedKind']) ?? null,
    routedId: row.routedId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function fetchIntakeFile(intakeId: string): Promise<IntakeRow> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.intakeFiles)
    .where(eq(schema.intakeFiles.id, intakeId));
  if (!row) throw new HttpError(404, 'Unknown intake file.');
  return row;
}
