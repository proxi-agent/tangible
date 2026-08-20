import type {
  AccountQuery,
  AccountSeries,
  Asset,
  AssetQuery,
  ClassificationDecisionResult,
  ClassificationQuery,
  ClassificationQueueItem,
  ClassificationRunResult,
  Client,
  ClientDetail,
  ClientFilingProfile,
  ClientListItem,
  ClientLocation,
  CreateClientRequest,
  CreateEngagementRequest,
  CreateLocationRequest,
  DistributionBucket,
  CommitFindingsRequest,
  Engagement,
  EngagementDetail,
  EngagementValuation,
  FarFile,
  FarMapping,
  FilterFacets,
  FindingDecisionResult,
  FindingSet,
  FindingSetSummary,
  IngestRun,
  JurisdictionSummary,
  LineMappingDecisionResult,
  LineMappingRunResult,
  MappedPriorLine,
  MarketOverview,
  NormalizationResult,
  OpportunityModel,
  OwnerRollup,
  OwnerSortField,
  Paginated,
  PriorDocument,
  PriorDocumentKind,
  Rendition,
  RenditionBasis,
  SavingsReport,
  SegmentDefinition,
  SortDirection,
  StartIngestRequest,
  UpdateClassificationRequest,
  UpdateClientRequest,
  UpdateFilingProfileRequest,
  UpdateFindingDispositionRequest,
  UpdateLineMappingRequest,
  UpdateEngagementRequest,
  YearTrendPoint,
} from '@tangible/types';
// Type-only, so nothing from the filing package reaches the client bundle.
import type { MappedBasis, RegisterComparison } from '@tangible/filing';

export type { RegisterComparison };

/**
 * A prior return with its wording read into our vocabulary, and the rollup that
 * follows from it. The rollup travels with the lines rather than being computed
 * in the browser: it is the figure every later comparison starts from, and one
 * arithmetic is easier to trust than two.
 */
export interface MappedPriorDocument {
  document: PriorDocument;
  lines: MappedPriorLine[];
  basis: MappedBasis;
}

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
    request<MarketOverview>(
      `/analytics/overview?jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`,
    ),

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
  exportUrl: (query: Partial<AccountQuery>) =>
    `${BASE_URL}/api/accounts/export?${toSearchParams(query)}`,

  // -------------------------------------------------------------------------
  // Workspace: clients, engagements, FAR intake
  // -------------------------------------------------------------------------

  clients: () => request<ClientListItem[]>('/clients'),

  createClient: (body: CreateClientRequest) =>
    request<Client>('/clients', { method: 'POST', body: JSON.stringify(body) }),

  client: (clientId: string) => request<ClientDetail>(`/clients/${clientId}`),

  updateClient: (clientId: string, body: UpdateClientRequest) =>
    request<Client>(`/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /**
   * Whole-shape upsert. The profile screen saves as one form, and a box cleared
   * on it has to clear in the database — see the route for why this is not a
   * PATCH.
   */
  updateFilingProfile: (clientId: string, body: UpdateFilingProfileRequest) =>
    request<ClientFilingProfile>(`/clients/${clientId}/filing-profile`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  createLocation: (clientId: string, body: CreateLocationRequest) =>
    request<ClientLocation>(`/clients/${clientId}/locations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createEngagement: (clientId: string, body: CreateEngagementRequest) =>
    request<Engagement>(`/clients/${clientId}/engagements`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  engagement: (engagementId: string) => request<EngagementDetail>(`/engagements/${engagementId}`),

  updateEngagement: (engagementId: string, body: UpdateEngagementRequest) =>
    request<Engagement>(`/engagements/${engagementId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * Multipart, so it bypasses `request()` — setting Content-Type by hand here
   * would strip the boundary the browser generates.
   */
  uploadFar: async (engagementId: string, file: File): Promise<FarFile> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${BASE_URL}/api/engagements/${engagementId}/files`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(errorMessage(body) || response.statusText, response.status);
    }
    return response.json() as Promise<FarFile>;
  },

  farFile: (fileId: string) => request<FarFile>(`/files/${fileId}`),

  proposeMapping: (fileId: string) =>
    request<FarFile>(`/files/${fileId}/propose`, { method: 'POST' }),

  confirmMapping: (fileId: string, mapping: FarMapping) =>
    request<NormalizationResult>(`/files/${fileId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ mapping }),
    }),

  engagementAssets: (engagementId: string, query: Partial<AssetQuery>) =>
    request<Paginated<Asset>>(
      `/engagements/${engagementId}/assets?${toSearchParams(query as never)}`,
    ),

  // -------------------------------------------------------------------------
  // Classification and valuation
  // -------------------------------------------------------------------------

  classify: (engagementId: string, reclassify = false) =>
    request<ClassificationRunResult>(
      `/engagements/${engagementId}/classify${reclassify ? '?reclassify=true' : ''}`,
      { method: 'POST' },
    ),

  classifications: (engagementId: string, query: Partial<ClassificationQuery>) =>
    request<Paginated<ClassificationQueueItem>>(
      `/engagements/${engagementId}/classifications?${toSearchParams(query as never)}`,
    ),

  decideClassification: (classificationId: string, body: UpdateClassificationRequest) =>
    request<ClassificationDecisionResult>(`/classifications/${classificationId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  valuation: (engagementId: string) =>
    request<EngagementValuation>(`/engagements/${engagementId}/valuation`),

  savings: (engagementId: string) => request<SavingsReport>(`/engagements/${engagementId}/savings`),

  rendition: (engagementId: string, options: { basis: RenditionBasis; filedByAgent: boolean }) =>
    request<Rendition>(
      `/engagements/${engagementId}/rendition?basis=${options.basis}&filedByAgent=${options.filedByAgent}`,
    ),

  // -------------------------------------------------------------------------
  // Prior filings
  // -------------------------------------------------------------------------

  priors: (engagementId: string) =>
    request<{ items: PriorDocument[] }>(`/engagements/${engagementId}/priors`),

  /**
   * Multipart, so it bypasses `request` for the same reason `uploadFar` does:
   * setting Content-Type by hand strips the boundary the server needs to split
   * the parts back apart.
   */
  uploadPrior: async (
    engagementId: string,
    file: File,
    kind: PriorDocumentKind,
  ): Promise<PriorDocument> => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const response = await fetch(`${BASE_URL}/api/engagements/${engagementId}/priors`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(errorMessage(body) || response.statusText, response.status);
    }
    return response.json() as Promise<PriorDocument>;
  },

  priorDocument: (documentId: string) =>
    request<MappedPriorDocument>(`/priors/${documentId}`),

  priorComparison: (documentId: string) =>
    request<RegisterComparison>(`/priors/${documentId}/comparison`),

  mapPriorLines: (documentId: string, remap = false) =>
    request<LineMappingRunResult>(`/priors/${documentId}/map${remap ? '?remap=true' : ''}`, {
      method: 'POST',
    }),

  decideLineMapping: (lineId: string, body: UpdateLineMappingRequest) =>
    request<LineMappingDecisionResult>(`/prior-lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // -------------------------------------------------------------------------
  // Committed findings
  // -------------------------------------------------------------------------

  findingSets: (engagementId: string) =>
    request<{ items: FindingSetSummary[] }>(`/engagements/${engagementId}/findings`),

  /**
   * A POST, deliberately. The savings report and the comparison are free to
   * look at and always current; this is the act of saying "this is what we told
   * them", and it leaves a dated record with a name on it.
   */
  commitFindings: (engagementId: string, body: CommitFindingsRequest) =>
    request<FindingSet>(`/engagements/${engagementId}/findings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  findingSet: (setId: string) => request<FindingSet>(`/finding-sets/${setId}`),

  /** A null status clears the decision rather than storing one. */
  decideFinding: (findingId: string, body: UpdateFindingDispositionRequest) =>
    request<FindingDecisionResult>(`/findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
