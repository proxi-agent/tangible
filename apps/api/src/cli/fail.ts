/**
 * DuckDB allows a single writer. Running a CLI while the API holds the
 * warehouse is the most likely way to hit this, and the raw IO error says
 * nothing about what to do next.
 */
export function reportAndExit(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (/Could not set lock on file|Conflicting lock/i.test(message)) {
    console.error('The warehouse is locked by another process — usually the running dashboard,');
    console.error('which holds it open for reading. DuckDB allows one writer or many readers,');
    console.error('never both.');
    console.error('');
    console.error('Either stop the dashboard and re-run this command, or start the ingest from');
    console.error('its Data sources page — that path releases the read handle first.');
    process.exit(1);
  }

  console.error(message);
  process.exit(1);
}
