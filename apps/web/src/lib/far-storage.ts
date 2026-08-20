import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
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
  if (!resolved.startsWith(root))
    throw new Error(`Refusing storage path outside the upload root: ${path}`);
  return resolved;
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
