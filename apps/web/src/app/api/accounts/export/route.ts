import { listAccounts } from '@tangible/analytics';
import { params, parseAccountQuery } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Rows exported per CSV request. Anything larger belongs in a saved lead list. */
const CSV_EXPORT_LIMIT = 5000;

const HEADER = [
  'account_id',
  'owner_name',
  'site_city',
  'state_class',
  'latest_assessed_value',
  'years_on_roll',
  'years_unfiled',
  'estimated_annual_tax',
  'estimated_annual_penalty',
  'estimated_lifetime_penalty',
  'has_agent',
  'segments',
];

/**
 * The current filter as CSV. Exporting the working set is the whole point of
 * the tool at this stage — the analysis is only useful if it leaves as a list.
 *
 * Not wrapped in `handle`, because the body is a file rather than JSON.
 */
export async function GET(request: Request): Promise<Response> {
  const query = { ...parseAccountQuery(params(request)), limit: CSV_EXPORT_LIMIT, offset: 0 };
  const { items, total } = await listAccounts(await getWarehouse(), query);

  const rows = items.map((a) =>
    [
      a.accountId,
      a.ownerName ?? '',
      a.siteCity ?? '',
      a.stateClass ?? '',
      a.latestAssessedValue ?? '',
      a.yearsOnRoll,
      a.yearsUnfiled,
      round(a.estimatedAnnualTax),
      round(a.estimatedAnnualPenalty),
      round(a.estimatedLifetimePenalty),
      a.hasAgent,
      a.segments.join('|'),
    ]
      .map(csvCell)
      .join(','),
  );

  const filename = `${query.jurisdictionId}-${query.taxYear}-accounts.csv`;
  const headers = new Headers({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });

  // Tell the caller when the export was capped rather than silently truncating.
  if (total > items.length) {
    headers.set('X-Total-Rows', String(total));
    headers.set('X-Exported-Rows', String(items.length));
  }

  return new Response([HEADER.join(','), ...rows].join('\n'), { headers });
}

function round(value: number | null): string {
  return value === null ? '' : String(Math.round(value));
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
