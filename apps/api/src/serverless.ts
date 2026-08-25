import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import type { Request, Response } from 'express';
import { configure } from './configure.js';
import { AppModule } from './app.module.js';

/**
 * The same app, as a function instead of a server.
 *
 * A serverless invocation has no `listen`: the platform hands over a request
 * that has already been accepted. So Nest is built onto an Express instance we
 * own and only `init`ed — the routes are registered, nothing binds a port.
 *
 * Booting Nest costs a second or so, which is why the promise is memoized at
 * module scope rather than per request: a warm instance reuses it, and only a
 * cold start pays. Storing the promise, not the result, is what keeps two
 * concurrent cold requests from building the container twice.
 *
 * `enableShutdownHooks` is deliberately absent. It installs process signal
 * handlers to close the DuckDB handle on the way down; a function is frozen
 * rather than signalled, so the handlers never fire and only leak listeners
 * across invocations.
 */
const server = express();
let ready: Promise<void> | undefined;

async function init(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bufferLogs: true });
  configure(app);
  await app.init();
}

export default async function handler(req: Request, res: Response): Promise<void> {
  ready ??= init();
  await ready;
  server(req, res);
}
