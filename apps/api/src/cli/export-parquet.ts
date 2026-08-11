/**
 * Publish the warehouse as Parquet for a read-only deployment.
 *
 *   pnpm export:parquet                    # -> ./data/parquet
 *   pnpm export:parquet ./build/parquet    # somewhere else
 *
 * The DuckDB file is half a gigabyte and single-writer; the same tables as
 * zstd Parquet are a fifth of that and readable by many processes at once over
 * HTTP. Run this after an ingest, upload the directory, and point
 * `PARQUET_BASE_URL` at it.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  MANIFEST_FILENAME,
  num,
  openRemoteWarehouse,
  PARQUET_TABLES,
  Warehouse,
  type ParquetManifest,
  type ParquetTable,
} from '@tangible/analytics';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';
import { resolveDataPath } from '../config/paths.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const outDir = resolveDataPath(process.argv[2] ?? './data/parquet');

  const warehouse = new Warehouse({ path: env.DUCKDB_PATH, readOnly: true });

  const total = num(
    (await warehouse.queryOne<{ n: unknown }>('SELECT count(*) AS n FROM account_year;'))?.n,
  );
  if (total === 0) {
    throw new Error(
      `No account-year rows in ${env.DUCKDB_PATH}. Run an ingest before exporting — ` +
        `an empty export would deploy cleanly and serve an empty dashboard.`,
    );
  }

  console.log(`Exporting ${total.toLocaleString()} account-year rows from ${env.DUCKDB_PATH}`);
  console.log(`  to ${outDir}\n`);

  await mkdir(outDir, { recursive: true });

  const tables: ParquetManifest['tables'] = [];
  for (const table of PARQUET_TABLES) {
    tables.push(await exportTable(warehouse, table, outDir));
  }

  const jurisdictions = await warehouse.query<{
    jurisdiction_id: unknown;
    accounts: unknown;
    years: unknown;
  }>(/* sql */ `
    SELECT
      jurisdiction_id,
      count(DISTINCT account_id) AS accounts,
      -- DuckDB hands back LIST columns as wrapper objects rather than arrays,
      -- so they come across as a delimited string and are split here.
      array_to_string(list(DISTINCT tax_year ORDER BY tax_year), ',') AS years
    FROM account_year
    GROUP BY 1
    ORDER BY 2 DESC;
  `);

  const manifest: ParquetManifest = {
    exportedAt: new Date().toISOString(),
    sourceWarehouse: env.DUCKDB_PATH,
    tables,
    jurisdictions: jurisdictions.map((row) => ({
      id: String(row.jurisdiction_id),
      accounts: num(row.accounts),
      years: String(row.years ?? '')
        .split(',')
        .filter((year) => year.trim() !== '')
        .map(Number)
        .filter(Number.isInteger),
    })),
  };

  await writeFile(join(outDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
  await warehouse.close();

  for (const table of tables) {
    console.log(
      `  ${table.name.padEnd(16)} ${table.rows.toLocaleString().padStart(11)} rows` +
        `  ${String(table.files.length).padStart(3)} files  ${mb(table.bytes).padStart(9)}`,
    );
  }
  const bytes = tables.reduce((sum, t) => sum + t.bytes, 0);
  console.log(`  ${''.padEnd(16)} ${''.padStart(11)}       ${''.padStart(9)}${mb(bytes).padStart(9)}\n`);

  await verify(outDir, total);

  console.log(`\nUpload ${outDir} to object storage, then set:`);
  console.log(`  PARQUET_BASE_URL=https://<host>/<prefix>`);
}

/**
 * Write one table.
 *
 * The target directory is removed first rather than written through. DuckDB's
 * partitioned write only overwrites the partitions it produces, so a county
 * dropped from the warehouse would otherwise survive in the export and reappear
 * in production as a jurisdiction that no longer exists.
 */
async function exportTable(
  warehouse: Warehouse,
  table: ParquetTable,
  outDir: string,
): Promise<ParquetManifest['tables'][number]> {
  const partitioned = Boolean(table.partitionBy?.length);
  const target = join(outDir, partitioned ? table.name : `${table.name}.parquet`);
  await rm(target, { recursive: true, force: true });

  const options = [
    `FORMAT PARQUET`,
    `COMPRESSION ZSTD`,
    ...(partitioned ? [`PARTITION_BY (${table.partitionBy!.join(', ')})`] : []),
  ];

  await warehouse.exec(
    `COPY ${table.name} TO '${target.replace(/'/g, "''")}' (${options.join(', ')});`,
  );

  const rows = num(
    (await warehouse.queryOne<{ n: unknown }>(`SELECT count(*) AS n FROM ${table.name};`))?.n,
  );
  const paths = partitioned ? await listFiles(target) : [target];
  const files = await Promise.all(
    paths.map(async (file) => ({
      // Recorded relative to the export root and with forward slashes: these
      // become URL paths under the base URL, not filesystem paths.
      path: relative(outDir, file).split(sep).join('/'),
      bytes: (await stat(file)).size,
    })),
  );

  return {
    name: table.name,
    rows,
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.parquet'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Read the export back through the same code path production uses.
 *
 * The export is only worth anything if the mounted views agree with the
 * warehouse they came from, and the partition columns are the part most likely
 * to be wrong — they live in directory names, not in the files.
 */
async function verify(outDir: string, expectedRows: number): Promise<void> {
  // Through `openRemoteWarehouse`, so the manifest that was just written is the
  // thing being tested — a manifest naming files that do not exist would
  // otherwise only surface after deploying.
  const { warehouse, manifest } = await openRemoteWarehouse(resolve(outDir), {
    memoryLimit: '1GB',
    threads: 2,
    // A local directory is already local; copying it to temp proves nothing.
    cache: false,
  });
  if (!manifest) throw new Error('Wrote the export but could not read its manifest back.');
  try {
    const row = await warehouse.queryOne<{ n: unknown; j: unknown; y: unknown }>(/* sql */ `
      SELECT count(*) AS n,
             count(DISTINCT jurisdiction_id) AS j,
             count(DISTINCT tax_year) AS y
      FROM account_year;
    `);
    const rows = num(row?.n);
    if (rows !== expectedRows) {
      throw new Error(
        `Export reads back ${rows.toLocaleString()} rows but the warehouse holds ` +
          `${expectedRows.toLocaleString()}.`,
      );
    }
    console.log(
      `Verified: ${rows.toLocaleString()} rows across ${num(row?.j)} jurisdictions ` +
        `and ${num(row?.y)} tax years read back through the Parquet views.`,
    );
  } finally {
    await warehouse.close();
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

void main().catch(reportAndExit);
