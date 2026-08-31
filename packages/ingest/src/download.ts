import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { SourceFile } from '@tangible/types';
import type { IngestLogger } from './connector.js';

const USER_AGENT =
  'tangible-ingest/0.1 (public records research; contact the site owner with concerns)';

/**
 * A portal that has reorganized answers with a courtesy page rather than a 404,
 * and an HTML error page is not a data file. Size alone cannot make that call:
 * Florida's smallest counties publish rolls well under 100KB, so a byte
 * threshold big enough to catch an error page also discards Lafayette and
 * Liberty. What actually separates them is the first few bytes.
 */
const MIN_PLAUSIBLE_ARCHIVE_BYTES = 1_000;

/** Leading bytes of a payload that is markup rather than data. */
const MARKUP_PREFIXES = ['<!doctype', '<html', '<?xml', '<head', '<body'];

/** Read enough of the head of a file to tell markup from a data file. */
async function looksLikeMarkup(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    const head = buffer.subarray(0, bytesRead).toString('latin1').trimStart().toLowerCase();
    return MARKUP_PREFIXES.some((prefix) => head.startsWith(prefix));
  } finally {
    await handle.close();
  }
}

export interface DownloadResult {
  path: string;
  bytes: number;
  checksum: string;
}

/**
 * A supplied local file is not there. Distinct from a failed download because
 * the remedy is completely different — and because retrying other candidate
 * URLs, which is what a normal miss triggers, would be pointless noise.
 */
export class LocalFileMissingError extends Error {
  constructor(
    readonly path: string,
    readonly hint: string,
  ) {
    super(`No file at ${path}${hint}`);
    this.name = 'LocalFileMissingError';
  }
}

/** List plausible candidates sitting next to the path the user typed. */
async function describeSiblings(missingPath: string): Promise<string> {
  const dir = dirname(missingPath);
  try {
    const entries = await readdir(dir);
    const candidates = entries.filter((name) => /\.(zip|csv|txt|dat)$/i.test(name));
    if (candidates.length === 0) {
      return `\n\nNothing that looks like a data file is in ${dir}.`;
    }
    return `\n\nData files found in ${dir}:\n${candidates.map((n) => `  ${n}`).join('\n')}`;
  } catch {
    return `\n\nThe directory ${dir} does not exist either.`;
  }
}

export async function downloadFile(
  source: SourceFile,
  destDir: string,
  logger: IngestLogger,
): Promise<DownloadResult | null> {
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, source.fileName);

  // A local path is how a district that does not serve automated requests gets
  // ingested: the operator downloads the file themselves and points at it.
  if (source.url.startsWith('file://')) {
    const localPath = fileURLToPath(source.url);
    logger.info(`COPY ${localPath}`);

    if (!existsSync(localPath)) {
      throw new LocalFileMissingError(localPath, await describeSiblings(localPath));
    }

    await copyFile(localPath, dest);
    const { size } = await stat(dest);
    const checksum = await hashFile(dest);
    logger.info(`  copied ${(size / 1e6).toFixed(1)} MB (sha256 ${checksum.slice(0, 12)})`);
    return { path: dest, bytes: size, checksum };
  }

  logger.info(`GET ${source.url}`);
  const response = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });

  if (!response.ok || !response.body) {
    logger.warn(`  ${response.status} ${response.statusText}`);
    return null;
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(dest));

  let { size } = await stat(dest);
  if (size < MIN_PLAUSIBLE_ARCHIVE_BYTES) {
    logger.warn(`  got ${size} bytes — too small to be a data file, treating as a miss`);
    return null;
  }
  if (await looksLikeMarkup(dest)) {
    logger.warn(`  got an HTML page rather than a data file, treating as a miss`);
    return null;
  }

  if (dest.toLowerCase().endsWith('.zip')) {
    const removed = await trimTrailingGarbage(dest, logger);
    if (removed > 0) size -= removed;
  }

  const checksum = await hashFile(dest);
  logger.info(`  saved ${(size / 1e6).toFixed(1)} MB (sha256 ${checksum.slice(0, 12)})`);
  return { path: dest, bytes: size, checksum };
}

/** End of central directory record: signature + 20 bytes of fields. */
const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const EOCD_SIZE = 22;
/** A zip comment is a 16-bit length, so the record starts within 64KB of the end. */
const EOCD_SEARCH_WINDOW = 66_000;

/**
 * Trim anything a portal appended after the zip payload.
 *
 * Some districts serve their archives through an application handler that
 * writes the page's own HTML after the file body. `unzip` shrugs this off, but
 * strict readers scan backwards from the end, land in the trailing garbage and
 * fail with a confusing error. Locating the real end-of-central-directory
 * record and truncating there turns a corrupt-looking download into a clean
 * archive.
 *
 * Returns the number of bytes removed.
 */
export async function trimTrailingGarbage(path: string, logger: IngestLogger): Promise<number> {
  const { size } = await stat(path);
  const windowSize = Math.min(size, EOCD_SEARCH_WINDOW);
  const handle = await open(path, 'r+');

  try {
    const window = Buffer.alloc(windowSize);
    const windowStart = size - windowSize;
    await handle.read(window, 0, windowSize, windowStart);

    // Walk candidate EOCD records from the end. The real one is the record whose
    // central-directory offset and size add up to its own position.
    for (let i = window.length - EOCD_SIZE; i >= 0; i--) {
      if (!window.subarray(i, i + 4).equals(EOCD_SIGNATURE)) continue;

      const centralDirSize = window.readUInt32LE(i + 12);
      const centralDirOffset = window.readUInt32LE(i + 16);
      const eocdOffset = windowStart + i;
      if (centralDirOffset + centralDirSize !== eocdOffset) continue;

      const commentLength = window.readUInt16LE(i + 20);
      const declaredEnd = eocdOffset + EOCD_SIZE + commentLength;
      if (declaredEnd === size) return 0;

      // Drop the comment along with the trailing bytes: whatever the handler
      // appended is not a comment we want to keep, and a length that overruns
      // the file is exactly what trips strict readers.
      window.writeUInt16LE(0, i + 20);
      await handle.write(window, i + 20, 2, eocdOffset + 20);
      await handle.truncate(eocdOffset + EOCD_SIZE);

      const removed = size - (eocdOffset + EOCD_SIZE);
      logger.info(
        `  trimmed ${removed.toLocaleString()} trailing byte(s) appended after the archive`,
      );
      return removed;
    }
  } finally {
    await handle.close();
  }

  return 0;
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Extract a zip and return the absolute paths of every extracted file.
 *
 * Entries are read one at a time (`lazyEntries`) and streamed to disk, so a
 * 140MB county CSV never has to fit in memory.
 */
export async function extractArchive(
  archivePath: string,
  destDir: string,
  logger: IngestLogger,
): Promise<string[]> {
  await mkdir(destDir, { recursive: true });

  const zipFile = await openZip(archivePath);

  await new Promise<void>((resolve, reject) => {
    zipFile.on('error', reject);
    zipFile.on('end', resolve);

    zipFile.on('entry', (entry: Entry) => {
      // Directory entries end in '/', and nothing else needs creating because
      // every file is written flat.
      if (entry.fileName.endsWith('/')) {
        zipFile.readEntry();
        return;
      }

      // Discard any path component from the archive so a crafted entry cannot
      // escape the destination directory.
      const safeName = entry.fileName.split(/[/\\]/).pop();
      if (!safeName) {
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) {
          reject(error ?? new Error(`Could not read ${entry.fileName}`));
          return;
        }
        // Mixing a promise into a callback is the whole job here: yauzl hands
        // entries back through callbacks and stream `pipeline` is promise-based,
        // so the bridge has to live somewhere.
        // oxlint-disable-next-line promise/no-promise-in-callback
        pipeline(readStream, createWriteStream(join(destDir, safeName)))
          .then(() => zipFile.readEntry())
          .catch(reject);
      });
    });

    zipFile.readEntry();
  });

  const files = await listFiles(destDir);
  logger.info(`  extracted ${files.length} file(s) to ${destDir}`);
  return files;
}

/**
 * Get a downloaded source into the extract directory, whatever form it arrived
 * in. Archives are unpacked; a plain CSV from an open-data API is moved as-is,
 * so the rest of the pipeline sees the same thing either way.
 */
export async function materializeSource(
  downloadPath: string,
  destDir: string,
  logger: IngestLogger,
): Promise<string[]> {
  if (await isZipArchive(downloadPath)) {
    return extractArchive(downloadPath, destDir, logger);
  }

  await mkdir(destDir, { recursive: true });
  const target = join(destDir, downloadPath.split('/').pop() ?? 'source');
  await rename(downloadPath, target);
  logger.info('  source is not an archive, using it directly');
  return [target];
}

/** Zip files start with the local file header signature 'PK\x03\x04'. */
async function isZipArchive(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    return header[0] === 0x50 && header[1] === 0x4b;
  } finally {
    await handle.close();
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error(`Could not open ${path}`));
      else resolve(zipFile);
    });
  });
}

export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => resolve(join(e.parentPath ?? dir, e.name)));
}

/**
 * Try each candidate URL in order and keep the first that yields a plausible
 * archive. Data portals reorganize, so connectors advertise several patterns
 * rather than one.
 */
export async function downloadFirstAvailable(
  candidates: SourceFile[],
  destDir: string,
  logger: IngestLogger,
): Promise<{ source: SourceFile; result: DownloadResult } | null> {
  for (const source of candidates) {
    try {
      const result = await downloadFile(source, destDir, logger);
      if (result) return { source, result };
    } catch (error) {
      // A missing local file is the operator's own path being wrong. Trying the
      // next candidate cannot help, and burying it under a generic "could not
      // download" message sends them looking in the wrong place.
      if (error instanceof LocalFileMissingError) throw error;
      logger.warn(`  ${source.url} failed: ${(error as Error).message}`);
    }
  }
  return null;
}

/**
 * Accept either a URL or a plain filesystem path for a source override.
 * Typing `file:///Users/...` is a papercut nobody should have to remember, and
 * a bare path is what a person naturally pastes.
 */
export function normalizeSourceRef(ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return ref;
  return pathToFileURL(resolve(ref)).href;
}
