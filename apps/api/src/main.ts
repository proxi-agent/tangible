import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`Tangible API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
