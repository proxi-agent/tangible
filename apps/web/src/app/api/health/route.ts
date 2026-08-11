import { num } from '@tangible/analytics';
import { handle } from '@/lib/route';
import { getWarehouse, getWarehouseInfo } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Confirms the process is up *and* that the warehouse actually answers. */
export function GET(): Promise<Response> {
  return handle(async () => {
    const info = await getWarehouseInfo();
    const row = await (await getWarehouse()).queryOne<{ n: unknown }>(
      'SELECT count(*) AS n FROM account_year;',
    );
    return {
      status: 'ok',
      warehouse: info.source,
      mode: info.mode,
      publishedAt: info.publishedAt,
      readingFrom: info.readingFrom,
      cache: info.cache,
      accountYearRows: num(row?.n),
      timestamp: new Date().toISOString(),
    };
  });
}
