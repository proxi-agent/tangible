import type { Env } from '../../config/env.js';
import { CACHE_CONTROL, CONTENT_TYPE, requireEnv, type PublishTarget } from './target.js';

/**
 * Supabase Storage, over its REST API.
 *
 * Works, and needs no extra dependency. Worth knowing before choosing it: the
 * free plan allows 5 GB of egress a month and each cold instance pulls the
 * whole ~95 MB export, so roughly fifty cold starts exhausts it. R2 has no
 * egress charge and is the better fit for this shape of data.
 */
export function supabaseTarget(env: Env): PublishTarget {
  const api = requireEnv('SUPABASE_URL', env.SUPABASE_URL).replace(/\/+$/, '');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket = process.env.PARQUET_BUCKET ?? 'warehouse';
  const auth = { Authorization: `Bearer ${key}`, apikey: key };

  const publicUrl = (path: string): string =>
    `${api}/storage/v1/object/public/${bucket}/${path}`;

  return {
    describe: () => `Supabase Storage bucket '${bucket}'`,

    async prepare() {
      const response = await fetch(`${api}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: true }),
      });
      if (response.ok || response.status === 409) return;
      const body = await response.text();
      // A bucket that already exists is the desired end state either way.
      if (/already exists/i.test(body)) return;
      throw new Error(`Could not create bucket '${bucket}': ${response.status} ${body}`);
    },

    async isPresent(path, bytes) {
      try {
        const response = await fetch(publicUrl(path), { method: 'HEAD' });
        return response.ok && Number(response.headers.get('content-length')) === bytes;
      } catch {
        return false;
      }
    },

    async put(path, body, kind) {
      const response = await fetch(`${api}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': CONTENT_TYPE[kind],
          'Cache-Control': CACHE_CONTROL[kind],
          // Republishing the same path must overwrite rather than 409.
          'x-upsert': 'true',
        },
        body: new Uint8Array(body),
      });
      if (!response.ok) {
        throw new Error(`Upload of ${path} failed: ${response.status} ${await response.text()}`);
      }
    },

    publicBaseUrl: () => `${api}/storage/v1/object/public/${bucket}`,
  };
}
