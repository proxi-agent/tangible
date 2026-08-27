import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { resolveDataPath } from '@tangible/analytics';
import { getSupabaseAdmin } from '@tangible/db';

/**
 * FAR files are confidential client data — Texas Tax Code 22.27 territory once
 * they feed a rendition. In a deployment they live in a *private* Supabase
 * Storage bucket, reachable only server-side with the service role — never the
 * public R2 bucket that serves the published roll export.
 *
 * Locally, when Supabase storage is not configured, files land on disk under
 * `data/uploads/` instead — the same optional-Supabase posture as the rest of
 * the app, and the reason a fresh checkout can run the whole intake flow
 * against nothing but a Postgres.
 */
const BUCKET = 'far-uploads';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Storage paths are built from UUIDs and a sanitized filename; keep it that way. */
function localPath(path: string): string {
  const root = resolveDataPath('./data/uploads');
  const resolved = normalize(join(root, path));
  /**
   * The separator matters. A bare `startsWith(root)` also accepts every
   * *sibling* whose name merely begins with the root's — `data/uploads-old`,
   * `data/uploads.bak` — so a path of `../uploads-old/x` would satisfy the
   * check while landing outside the directory this is guarding. Comparing
   * against `root + sep` is the difference between "inside it" and "starts
   * like it".
   */
  if (resolved !== root && !resolved.startsWith(root + sep))
    throw new Error(`Refusing storage path outside the upload root: ${path}`);
  return resolved;
}

/**
 * Serverless filesystems are read-only outside `/tmp`, and `/tmp` does not
 * survive to the next request — so the local-disk fallback cannot store a FAR
 * in a deployment, it can only appear to. Without this the upload fails on
 * `mkdir` with `EROFS: read-only file system`, which reads like a bug in the
 * app rather than a missing environment variable.
 */
function requireStorage(): void {
  if (supabaseConfigured()) return;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      'File storage is not configured for this deployment. Set SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY — the local-disk fallback only works on a developer ' +
        'machine, because a serverless filesystem is read-only and does not persist.',
    );
  }
}

let ensured: Promise<void> | null = null;

/** Create the bucket on first use; memoized so the check is one round trip per process. */
function ensureBucket(): Promise<void> {
  ensured ??= (async () => {
    const storage = getSupabaseAdmin().storage;
    const { data } = await storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Could not create the ${BUCKET} bucket: ${error.message}`);
    }
  })().catch((error: unknown) => {
    ensured = null; // a transient failure should not poison every later upload
    throw error;
  });
  return ensured;
}

export async function uploadFarFile(
  path: string,
  data: Uint8Array,
  contentType: string | null,
): Promise<void> {
  requireStorage();
  if (!supabaseConfigured()) {
    const target = localPath(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return;
  }
  await ensureBucket();
  const { error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, data, { contentType: contentType ?? 'application/octet-stream' });
  if (error) throw new Error(`Could not store the file: ${error.message}`);
}

/**
 * Remove stored objects, and report honestly on the ones that would not go.
 *
 * Never throws: this runs after a client's rows are already gone, and the
 * deletion receipt is more useful naming the files it could not sweep than a
 * request is failing with the database already committed. A missing object
 * counts as removed — the promise is that the file is not there, not that we
 * were the ones to remove it.
 */
export async function removeFarFiles(
  paths: string[],
): Promise<{ removed: number; failed: string[] }> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return { removed: 0, failed: [] };

  if (!supabaseConfigured()) {
    const failed: string[] = [];
    let removed = 0;
    for (const path of unique) {
      try {
        await rm(localPath(path), { force: true });
        removed += 1;
      } catch {
        failed.push(path);
      }
    }
    return { removed, failed };
  }

  try {
    await ensureBucket();
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(unique);
    if (error) return { removed: 0, failed: unique };
    return { removed: unique.length, failed: [] };
  } catch {
    return { removed: 0, failed: unique };
  }
}

export async function downloadFarFile(path: string): Promise<Uint8Array> {
  if (!supabaseConfigured()) {
    return new Uint8Array(await readFile(localPath(path)));
  }
  await ensureBucket();
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Could not read the stored file: ${error?.message ?? 'no data returned'}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}
