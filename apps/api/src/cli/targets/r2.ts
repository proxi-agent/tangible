import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../../config/env.js';
import { CACHE_CONTROL, CONTENT_TYPE, requireEnv, type PublishTarget } from './target.js';

/**
 * Cloudflare R2, over its S3-compatible API.
 *
 * Chosen over a metered store because every cold instance downloads the entire
 * export — free egress turns the dominant running cost into nothing. R2 honours
 * `Range`, which is the one thing DuckDB actually requires.
 */
export function r2Target(env: Env): PublishTarget {
  const accountId = requireEnv('R2_ACCOUNT_ID', env.R2_ACCOUNT_ID);
  const bucket = env.R2_BUCKET;

  const client = new S3Client({
    // R2 is a single global namespace; the S3 protocol still wants a region.
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY),
    },
  });

  return {
    describe: () => `R2 bucket '${bucket}'`,

    async prepare() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        // Deliberately not created here. A bucket also needs public access
        // turned on to be readable, and that is a dashboard action — creating
        // it silently would leave a bucket that publishes fine and then serves
        // 401s to the deployment.
        throw new Error(
          `Cannot reach R2 bucket '${bucket}': ${(error as Error).message}\n` +
            `Create it at dash.cloudflare.com → R2, then enable public access on it.`,
        );
      }
    },

    async isPresent(path, bytes) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
        return head.ContentLength === bytes;
      } catch {
        return false;
      }
    },

    async put(path, body, kind) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: path,
          Body: body,
          ContentType: CONTENT_TYPE[kind],
          CacheControl: CACHE_CONTROL[kind],
        }),
      );
    },

    publicBaseUrl() {
      return requireEnv('R2_PUBLIC_BASE_URL', env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '');
    },
  };
}
