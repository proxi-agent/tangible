import type {
  AccountQuery,
  AccountSeries,
  DistributionBucket,
  FilterFacets,
  IngestRun,
  JurisdictionSummary,
  MarketOverview,
  OpportunityModel,
  OwnerRollup,
  OwnerSortField,
  Paginated,
  SegmentDefinition,
  SortDirection,
  StartIngestRequest,
  YearTrendPoint,
} from '@tangible/types';

/**
 * Empty by default: the API is this app's own route handlers, so requests are
 * same-origin and need no CORS, no second deployment and no configuration. Set
 * `NEXT_PUBLIC_API_URL` only to point the dashboard at a warehouse hosted
 * elsewhere.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Errors come back as a JSON envelope. Showing the raw body puts braces and
 * status codes in front of the user when the server already wrote a sentence
 * worth reading — the ingest-unavailable message in a deployment, for instance.
 */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : body;
  } catch {
    return body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(errorMessage(body) || response.statusText, response.status);
  }

  return response.json() as Promise<T>;
}

/** Serialize a filter into a query string; arrays become repeated params. */
export function toSearchParams(query: Partial<AccountQuery>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

export const api = {
  jurisdictions: () => request<JurisdictionSummary[]>('/jurisdictions'),

  segments: () => request<SegmentDefinition[]>('/jurisdictions/segments'),

  overview: (jurisdictionId: string, taxYear: number) =>
    request<MarketOverview>(`/analytics/overview?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`),

  trend: (jurisdictionId: string) =>
    request<YearTrendPoint[]>(`/analytics/trend?jurisdictionId=${jurisdictionId}`),

  valueDistribution: (jurisdictionId: string, taxYear: number) =>
    request<DistributionBucket[]>(
      `/analytics/distribution/value?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
    ),

  stateClassDistribution: (jurisdictionId: string, taxYear: number) =>
    request<DistributionBucket[]>(
      `/analytics/distribution/state-class?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
    ),

  opportunity: (params: {
    jurisdictionId: string;
    taxYear: number;
    segment?: string;
    pricePerAccount?: number;
    conversionRate?: number;
  }) => request<OpportunityModel>(`/analytics/opportunity?${toSearchParams(params as never)}`),

  accounts: (query: Partial<AccountQuery>) =>
    request<Paginated<AccountSeries>>(`/accounts?${toSearchParams(query)}`),

  account: (accountId: string, jurisdictionId: string, taxYear: number) =>
    request<AccountSeries>(
      `/accounts/${encodeURIComponent(accountId)}?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
    ),

  facets: (jurisdictionId: string, taxYear: number) =>
    request<FilterFacets>(`/accounts/facets?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`),

  owners: (query: {
    jurisdictionId: string;
    taxYear: number;
    segments?: string[];
    minAccounts?: number;
    search?: string;
    sortBy?: OwnerSortField;
    sortDir?: SortDirection;
    limit?: number;
    offset?: number;
  }) => request<Paginated<OwnerRollup>>(`/owners?${toSearchParams(query as never)}`),

  ingestRuns: () => request<IngestRun[]>('/ingest/runs'),

  startIngest: (body: StartIngestRequest) =>
    request<IngestRun>('/ingest', { method: 'POST', body: JSON.stringify(body) }),

  seedDemo: (accounts?: number) =>
    request<{ rows: number; jurisdictionId: string }>('/ingest/seed-demo', {
      method: 'POST',
      body: JSON.stringify({ accounts }),
    }),

  /** CSV export runs through the browser so the download stays a normal navigation. */
  exportUrl: (query: Partial<AccountQuery>) => `${BASE_URL}/api/accounts/export?${toSearchParams(query)}`,
};
