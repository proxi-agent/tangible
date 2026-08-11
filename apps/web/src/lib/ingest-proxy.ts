import 'server-only';
import { NextResponse } from 'next/server';
import { releaseWarehouse } from './warehouse';

/**
 * Ingest is the one thing that cannot move into the web app.
 *
 * A county archive is hundreds of megabytes, it takes minutes to load, and it
 * ends by writing a DuckDB file. None of that survives a serverless function:
 * no persistent disk, no long-running process. So ingest stays in the NestJS
 * app, which runs where the data does, and these routes forward to it.
 *
 * When there is no ingest server — which is the normal state of a deployment —
 * they say so plainly instead of failing as a network error. The dashboard
 * still serves the data that was published; only the button that would load
 * more is unavailable.
 */

function ingestApiUrl(): string | undefined {
  const configured = process.env.INGEST_API_URL?.trim();
  if (configured) return configured;
  // Local development runs `pnpm dev`, which starts the API on 3001 alongside
  // the web app, so the common case needs no configuration.
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : undefined;
}

export function ingestUnavailable(): NextResponse {
  return NextResponse.json(
    {
      statusCode: 503,
      message:
        'Ingest runs against the local warehouse and is not available in this deployment. ' +
        'Load data with `pnpm ingest`, publish it with `pnpm export:parquet`, and upload the result.',
    },
    { status: 503 },
  );
}

export async function proxyIngest(request: Request, path: string): Promise<Response> {
  const base = ingestApiUrl();
  if (!base) return ingestUnavailable();

  const target = new URL(`/api/ingest${path}`, base);
  target.search = new URL(request.url).search;

  // Anything that is not a GET is about to make the ingest server write to the
  // warehouse, and it cannot take the write lock while this process is reading.
  // Stepping aside here is what lets the Data page start an ingest at all.
  if (request.method !== 'GET') await releaseWarehouse();

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.method === 'GET' ? undefined : await request.text(),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch {
    // The server is configured but not running — a different problem from not
    // having one, and worth distinguishing when you are staring at the page.
    return NextResponse.json(
      { statusCode: 503, message: `No ingest server responding at ${base}.` },
      { status: 503 },
    );
  }
}
