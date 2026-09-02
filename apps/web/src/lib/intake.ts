import 'server-only';
import { eq } from 'drizzle-orm';
import { FAR_UPLOAD_EXTENSIONS, type DocumentPeek, type IntakeFile } from '@tangible/types';
import { downloadFarFile } from '@/lib/far-storage';
import { HttpError } from '@/lib/http';
import { ingestPrior, ingestRegister } from '@/lib/ingest';
import { mediaTypeFor } from '@/lib/priors';
import { requireDb, schema } from '@/lib/workspace-db';

export type IntakeRow = typeof schema.intakeFiles.$inferSelect;

/**
 * What can be done with a staged file. `dismiss` is a decision like the others
 * — somebody looked and said no — and it is recorded rather than deleting the
 * row, because "why is there no 2025 rendition on file" is answered by it.
 */
export const INTAKE_ACTIONS = ['register', 'rendition', 'notice', 'dismiss'] as const;
export type IntakeAction = (typeof INTAKE_ACTIONS)[number];

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
    peek: (row.peek as DocumentPeek | null) ?? null,
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

/**
 * Send a staged file down a pipeline, and record that it went.
 *
 * Routing copies the file down exactly the path a direct upload takes — the
 * same {@link ingestRegister} or {@link ingestPrior} — and the intake row keeps
 * the record: which pipeline, which row it became, or that somebody looked at
 * it and said no. A row routes once.
 *
 * The decision is the caller's and is never read back out of the proposal here.
 * Two callers pass one: the reviewer, through the route endpoint, and the
 * autopilot, which has already held the proposal to a bar the reviewer's
 * judgement does not have to clear.
 */
export async function routeIntakeFile(row: IntakeRow, action: IntakeAction): Promise<IntakeRow> {
  if (row.status === 'routed') {
    throw new HttpError(409, 'This file has already been routed.');
  }

  const db = requireDb();

  if (action === 'dismiss') {
    const [updated] = await db
      .update(schema.intakeFiles)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(schema.intakeFiles.id, row.id))
      .returning();
    return updated!;
  }

  if (!routable(row, action)) {
    throw new HttpError(
      409,
      action === 'register'
        ? `"${row.originalFilename}" is not a spreadsheet — the register pipeline takes ${FAR_UPLOAD_EXTENSIONS.join(', ')}.`
        : `"${row.originalFilename}" is not a document the priors pipeline can read.`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadFarFile(row.storagePath);
  } catch {
    throw new HttpError(502, 'The staged file could not be read back from storage.');
  }

  const upload = {
    filename: row.originalFilename,
    bytes,
    contentType: row.contentType,
  };

  try {
    const routed =
      action === 'register'
        ? await ingestRegister(row.engagementId, upload)
        : await ingestPrior(row.engagementId, upload, action);

    const [updated] = await db
      .update(schema.intakeFiles)
      .set({
        status: 'routed',
        routedKind: action,
        routedId: routed.id,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.intakeFiles.id, row.id))
      .returning();
    return updated!;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await db
      .update(schema.intakeFiles)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(schema.intakeFiles.id, row.id));
    throw new HttpError(502, `Routing failed: ${message}`);
  }
}

/**
 * Whether a pipeline can even read this file. Cheap, deterministic, and
 * separate from {@link routeIntakeFile} so the autopilot can ask before it
 * commits to anything — a route the extension rules out is one for a person,
 * not a 502 written onto the row.
 */
export function routable(row: IntakeRow, action: Exclude<IntakeAction, 'dismiss'>): boolean {
  const dot = row.originalFilename.lastIndexOf('.');
  const extension = dot === -1 ? '' : row.originalFilename.slice(dot).toLowerCase();
  return action === 'register'
    ? (FAR_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)
    : mediaTypeFor(row.originalFilename) !== null;
}
