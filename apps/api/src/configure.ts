import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import type { Env } from './config/env.js';

/**
 * Everything between `create` and `listen`.
 *
 * Two entry points boot this app now — `main.ts` for a long-running server and
 * `serverless.ts` for a function — and they must agree on the prefix, the error
 * shape and the CORS origin, or the deployment behaves differently from the
 * thing that was tested locally. So the agreement lives here rather than being
 * copied twice.
 */
export function configure(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api');
  // Request validation is done per-route with the Zod schemas from
  // @tangible/types, so there is no class-validator pipe to install — this
  // filter is what turns a schema failure into a 400 with the offending fields.
  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }).split(','),
    credentials: true,
  });
}
