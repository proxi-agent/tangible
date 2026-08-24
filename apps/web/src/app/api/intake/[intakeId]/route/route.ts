import { eq } from 'drizzle-orm';
import { FAR_UPLOAD_EXTENSIONS } from '@tangible/types';
import { downloadFarFile } from '@/lib/far-storage';
import { ingestPrior, ingestRegister } from '@/lib/ingest';
import { fetchIntakeFile, intakeFileDto } from '@/lib/intake';
import { mediaTypeFor } from '@/lib/priors';
import { HttpError, handle } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The human decision triage was waiting for.
 *
 * Routing copies the staged file down exactly the pipeline a direct upload
 * takes — {@link ingestRegister} or {@link ingestPrior}, same code — and the
 * intake row keeps the record: which pipeline, which row it became, or that
 * somebody looked at it and said no. A row routes once. The proposal never
 * routes anything by itself, and this endpoint does not read it — it acts
 * only on the route in the request body, which is the reviewer's.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ intakeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { intakeId } = await params;
    const row = await fetchIntakeFile(intakeId);

    const ROUTES = ['register', 'rendition', 'notice', 'dismiss'] as const;
    const body = (await request.json().catch(() => ({}))) as { route?: string };
    const route = ROUTES.find((r) => r === body.route);
    if (!route) {
      throw new HttpError(400, "Send { route: 'register' | 'rendition' | 'notice' | 'dismiss' }.");
    }
    if (row.status === 'routed') {
      throw new HttpError(409, 'This file has already been routed.');
    }

    const db = requireDb();

    if (route === 'dismiss') {
      const [updated] = await db
        .update(schema.intakeFiles)
        .set({ status: 'dismissed', updatedAt: new Date() })
        .where(eq(schema.intakeFiles.id, intakeId))
        .returning();
      return intakeFileDto(updated!);
    }

    const dot = row.originalFilename.lastIndexOf('.');
    const extension = dot === -1 ? '' : row.originalFilename.slice(dot).toLowerCase();
    if (route === 'register' && !(FAR_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new HttpError(
        409,
        `"${row.originalFilename}" is not a spreadsheet — the register pipeline takes ${FAR_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }
    if (route !== 'register' && !mediaTypeFor(row.originalFilename)) {
      throw new HttpError(
        409,
        `"${row.originalFilename}" is not a document the priors pipeline can read.`,
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
        route === 'register'
          ? await ingestRegister(row.engagementId, upload)
          : await ingestPrior(row.engagementId, upload, route);

      const [updated] = await db
        .update(schema.intakeFiles)
        .set({
          status: 'routed',
          routedKind: route,
          routedId: routed.id,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.intakeFiles.id, intakeId))
        .returning();
      return intakeFileDto(updated!);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db
        .update(schema.intakeFiles)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(eq(schema.intakeFiles.id, intakeId));
      throw new HttpError(502, `Routing failed: ${message}`);
    }
  });
}
