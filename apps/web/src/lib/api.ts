import type { CapitalizationAdvice, CapitalizationAdviceRequest } from '@tangible/types';
import type {
  FeeStatement,
  FeeView,
  IssueFeeStatementInput,
  OperationsView,
  ResolveIncidentInput,
  SaveFeeTermsInput,
  SettleFeeStatementInput,
} from '@tangible/types';
import type {
  AcceptanceBoard,
  AnalysisRun,
  GrantPortalAccessRequest,
  IntakeFile,
  PortalUser,
  RunProgress,
  UpdatePortalAccessRequest,
  Viewer,
  IntakeRoute,
  AccountQuery,
  AccountSeries,
  AgentAppointment,
  AnswerExtensionRequest,
  AssessmentNotice,
  AssistantAskRequest,
  AssistantAskResponse,
  AssistantConversation,
  AssistantConversationDetail,
  DetectionModel,
  EvidenceBoard,
  EvidenceColumnMapDto,
  EvidenceExport,
  EvidenceSourceKindDto,
  ProtestBriefRecord,
  UnblockPlanRecord,
  ResultLetterRecord,
  MotionDraftRecord,
  DeletionPreview,
  DeletionReceipt,
  GraphAskRecord,
  RolloverPlan,
  RolloverResult,
  DraftMotionRequest,
  Asset,
  AssetProfile,
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
  CorrectionMotion,
  Engagement,
  ClientFilingStatement,
  ClientRecoveryStatement,
  EngagementRecovery,
  EngagementResult,
  EngagementDetail,
  EngagementReturns,
  EngagementSite,
  EngagementValuation,
  FarFile,
  FarMapping,
  InvoiceDetail,
  InvoiceDocument,
  InvoiceList,
  AssessabilityTreatment,
  FilingAgent,
  FilingSeason,
  FilterFacets,
  FindingDecisionResult,
  FindingRowFilters,
  FindingQueue,
  FindingRowPage,
  FindingSet,
  FindingSetSummary,
  PortalSettings,
  UpdatePortalSettingsRequest,
  IngestRun,
  JurisdictionSummary,
  LineMappingDecisionResult,
  LineMappingRunResult,
  MappedPriorLine,
  MarketOverview,
  NormalizationResult,
  OpenYears,
  OpportunityModel,
  OwnerRollup,
  OwnerSortField,
  Paginated,
  PracticeSeason,
  PlaceSiteRequest,
  PriorDocument,
  PriorDocumentKind,
  RecordAppointmentRequest,
  RecordExtensionRequest,
  RecordFilingRequest,
  RecordMotionRequest,
  RecordSettlementRequest,
  RecordNoticeRequest,
  NoticeRecordProposal,
  AskRecord,
  CreateAskRequest,
  UpdateAskRequest,
  RecordResolutionRequest,
  Rendition,
  RenditionBasis,
  RenditionExtension,
  RenditionFiling,
  RenditionFilingRecord,
  SavingsReport,
  SegmentDefinition,
  SortDirection,
  StartIngestRequest,
  UpdateNoticeRequest,
  VoidResolutionRequest,
  UpdateAppointmentRequest,
  UpdateClassificationRequest,
  UpdateClientRequest,
  UpdateFilingAgentRequest,
  UpdateFilingProfileRequest,
  UpdateFindingDispositionRequest,
  UpdateLineMappingRequest,
  UpdateLocationRequest,
  UpdateEngagementRequest,
  UpdateMotionRequest,
  YearTrendPoint,
  DraftScheduleRequest,
  DraftScheduleResult,
  QualityView,
} from '@tangible/types';
// Type-only, so nothing from the filing package reaches the client bundle.
import type {
  CarryFinding,
  CarryForward,
  CarryGroup,
  CarryVerdict,
  MappedBasis,
  RegisterComparison,
  SiteCoverage,
} from '@tangible/filing';

export type {
  CarryFinding,
  CarryForward,
  CarryGroup,
  CarryVerdict,
  RegisterComparison,
  SiteCoverage,
};

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
    /**
     * Not every failure comes from this app. A request over the platform's body
     * limit is rejected by the edge before any handler runs, and what comes
     * back is an HTML error page — which, printed into the error card, is a
     * screenful of markup where a sentence should be.
     */
    return /^\s*</.test(body) ? '' : body;
  }
}

/**
 * Turn a failed response into the right kind of failure.
 *
 * Two statuses do not belong in an error card. A 401 means the session expired
 * while the tab sat open — the practitioner needs the login screen, not a red
 * box telling them they are signed out on a page they cannot leave. A 413 was
 * decided by the platform, which knows nothing about renditions and says so in
 * HTML; the app knows what was being uploaded and can say something useful.
 */
function fail(response: Response, body: string): never {
  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    // Not from the login page itself. The shell's scope query runs there too —
    // hooks run before the shell returns its bare login room — and it 401s like
    // everything else. Sending /login to /login?next=%2Flogin reloads the page,
    // which fires the query again and nests the parameter one level deeper each
    // time: an endless redirect on the one page whose whole job is to be
    // reachable while signed out.
    !window.location.pathname.startsWith('/login')
  ) {
    const next = `${window.location.pathname}${window.location.search}`;
    // Replace, not assign: the expired page is not somewhere Back should return
    // to, since going there would only bounce through here again.
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }
  if (response.status === 413) {
    throw new ApiError(
      'That upload is larger than the server will accept in one request. Split the workbook, ' +
        'or save it as CSV — the same rows in CSV are a fraction of the size.',
      413,
    );
  }
  throw new ApiError(
    errorMessage(body) || response.statusText || 'Request failed',
    response.status,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `HeadersInit` is three different shapes — a `Headers`, an array of pairs,
  // or a plain object — and only the last of them survives an object spread.
  // The other two spread into `{ 0: ..., 1: ... }`, which drops every header the
  // caller set and surfaces far from here as an unexplained 401 or 415. The
  // `Headers` constructor accepts all three, so let it do the normalizing.
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${BASE_URL}/api${path}`, { ...init, headers });

  if (!response.ok) {
    const body = await response.text();
    fail(response, body);
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

/**
 * The nine filters as a query string, in the shape `parseFilters` reads.
 *
 * Lists are comma-joined and empty ones are omitted entirely, so an untouched
 * filter bar produces no parameters at all — which keeps the export URL, the
 * query key and the address bar readable, and makes "no filter" and "every
 * option ticked" the same request rather than two.
 */
export function findingRowParams(
  findingKey: string,
  filters: Partial<FindingRowFilters> = {},
): URLSearchParams {
  const params = new URLSearchParams({ finding: findingKey });
  const list = (name: string, values: string[] | undefined) => {
    if (values && values.length > 0) params.set(name, values.join(','));
  };
  list('confidence', filters.confidence);
  list('locations', filters.locations);
  list('costCenters', filters.costCenters);
  list('categories', filters.categories);
  list('dispositions', filters.dispositions);
  list('reviewers', filters.reviewers);
  for (const key of ['acquiredFrom', 'acquiredTo', 'costMin', 'costMax'] as const) {
    const value = filters[key];
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  if (filters.evidence && filters.evidence !== 'any') params.set('evidence', filters.evidence);
  if (filters.query && filters.query.trim() !== '') params.set('query', filters.query.trim());
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

  /**
   * Who this browser is signed in as. Decides which product the shell draws;
   * it is not what decides what the server will answer.
   */
  viewer: () => request<Viewer | null>('/viewer'),

  /** Who from the client's side may sign in to this business's portal. */
  portalUsers: (clientId: string) => request<PortalUser[]>(`/clients/${clientId}/portal-users`),

  grantPortalAccess: (clientId: string, body: GrantPortalAccessRequest) =>
    request<PortalUser>(`/clients/${clientId}/portal-users`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePortalAccess: (clientId: string, grantId: string, body: UpdatePortalAccessRequest) =>
    request<PortalUser>(`/clients/${clientId}/portal-users/${grantId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  revokePortalAccess: (clientId: string, grantId: string) =>
    request<{ ok: true }>(`/clients/${clientId}/portal-users/${grantId}`, { method: 'DELETE' }),

  /** Every analysis run for a season, newest first. */
  runs: (engagementId: string) => request<AnalysisRun[]>(`/engagements/${engagementId}/runs`),

  /** Ask for a fresh run. Returns the queued row, not a report. */
  requestRun: (engagementId: string) =>
    request<AnalysisRun>(`/engagements/${engagementId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ trigger: 'manual' }),
    }),

  /** The published report a client reads, and whatever run is in flight. */
  publishedReport: (engagementId: string) =>
    request<{
      report: SavingsReport | null;
      runId: string | null;
      publishedAt: string | null;
      inFlight: RunProgress | null;
    }>(`/engagements/${engagementId}/report`),

  // -------------------------------------------------------------------------
  // One finding, row by row
  // -------------------------------------------------------------------------

  /** The population behind a finding, filtered, with each row's decision on it. */
  findingRows: (
    engagementId: string,
    findingKey: string,
    filters: Partial<FindingRowFilters> = {},
    page: { offset?: number; limit?: number } = {},
  ) => {
    const params = findingRowParams(findingKey, filters);
    if (page.offset) params.set('offset', String(page.offset));
    if (page.limit) params.set('limit', String(page.limit));
    return request<FindingRowPage>(`/engagements/${engagementId}/findings/rows?${params}`);
  },

  /**
   * Accept, reject or park a batch of rows. The answer is the same filtered
   * page the decision was made in, so the table redraws in place rather than
   * jumping back to the whole finding.
   */
  decideFindingRows: (
    engagementId: string,
    body: {
      findingKey: string;
      assetIds: string[];
      status: 'accepted' | 'rejected' | 'pending-client' | null;
      note?: string;
    },
    filters: Partial<FindingRowFilters> = {},
  ) =>
    request<FindingRowPage>(
      `/engagements/${engagementId}/findings/rows?${findingRowParams(body.findingKey, filters)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /**
   * A download, so it is a URL rather than a fetch — the browser saves the file
   * without the app holding a workbook in memory to hand back to it.
   */
  findingRowsExportUrl: (
    engagementId: string,
    findingKey: string,
    filters: Partial<FindingRowFilters> = {},
  ) =>
    `${BASE_URL}/api/engagements/${engagementId}/findings/rows/export?${findingRowParams(findingKey, filters)}`,

  /**
   * The whole report as one ranked list of decisions.
   *
   * A separate call from `findingRows` rather than a filter over it, because it
   * is not a view of a finding — it crosses all of them, and what it ranks on
   * (expected recovery) is a quantity no single category page can order by.
   * Offset is a window on one ordering the server holds, so paging forward
   * never re-offers a row the diversity cap already placed.
   */
  findingQueue: (engagementId: string, page: { offset?: number; size?: number } = {}) => {
    const params = new URLSearchParams();
    if (page.offset) params.set('offset', String(page.offset));
    if (page.size) params.set('size', String(page.size));
    const query = params.toString();
    return request<FindingQueue>(
      `/engagements/${engagementId}/findings/queue${query === '' ? '' : `?${query}`}`,
    );
  },

  portalSettings: (clientId: string) =>
    request<PortalSettings>(`/clients/${clientId}/portal-settings`),

  updatePortalSettings: (clientId: string, body: UpdatePortalSettingsRequest) =>
    request<PortalSettings>(`/clients/${clientId}/portal-settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

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

  // -------------------------------------------------------------------------
  // Agent appointments — Form 50-162
  // -------------------------------------------------------------------------

  /** Us, as Step 3 names us. One record for the firm, not one per client. */
  filingAgent: () => request<FilingAgent>('/filing-agent'),

  /** A patch: a field left out keeps its value, an empty string clears it. */
  updateFilingAgent: (body: UpdateFilingAgentRequest) =>
    request<FilingAgent>('/filing-agent', { method: 'PATCH', body: JSON.stringify(body) }),

  appointments: (clientId: string) =>
    request<AgentAppointment[]>(`/clients/${clientId}/appointments`),

  recordAppointment: (clientId: string, body: RecordAppointmentRequest) =>
    request<AgentAppointment>(`/clients/${clientId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** The two things that happen to a signed form: it is filed, or it ends. */
  updateAppointment: (appointmentId: string, body: UpdateAppointmentRequest) =>
    request<AgentAppointment>(`/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * The filled Form 50-162, as a normal navigation for the same reason the CSV
   * export is one. A 409 body carries the form's own refusal to print.
   */
  appointmentPdfUrl: (appointmentId: string) => `${BASE_URL}/api/appointments/${appointmentId}/pdf`,

  createLocation: (clientId: string, body: CreateLocationRequest) =>
    request<ClientLocation>(`/clients/${clientId}/locations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateLocation: (clientId: string, locationId: string, body: UpdateLocationRequest) =>
    request<ClientLocation>(`/clients/${clientId}/locations/${locationId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  createEngagement: (clientId: string, body: CreateEngagementRequest) =>
    request<Engagement>(`/clients/${clientId}/engagements`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  engagement: (engagementId: string) => request<EngagementDetail>(`/engagements/${engagementId}`),

  sites: (engagementId: string) => request<EngagementSite[]>(`/engagements/${engagementId}/sites`),

  /** One entry per site holding property — the returns this engagement owes. */
  returns: (engagementId: string) =>
    request<EngagementReturns>(`/engagements/${engagementId}/returns`),

  /**
   * Placing returns the recomputed sites, not just a count — one placement
   * changes how the rest read.
   */
  placeSite: (engagementId: string, body: PlaceSiteRequest) =>
    request<{ placed: number; sites: EngagementSite[] }>(`/engagements/${engagementId}/sites`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

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
      fail(response, body);
    }
    return response.json() as Promise<FarFile>;
  },

  farFile: (fileId: string) => request<FarFile>(`/files/${fileId}`),

  // -------------------------------------------------------------------------
  // The systems outside the register
  // -------------------------------------------------------------------------

  /**
   * Firm-side only, and not in the portal allowlist.
   *
   * A client's own maintenance export coming back at them through this product
   * would be a strange thing to show, and the coverage figure beside it is a
   * statement about how thoroughly the firm has done its own job.
   */
  evidence: (engagementId: string) =>
    request<EvidenceBoard>(`/engagements/${engagementId}/evidence`),

  /** Multipart for the same boundary reason as `uploadFar`. */
  uploadEvidence: async (
    engagementId: string,
    kind: EvidenceSourceKindDto,
    file: File,
  ): Promise<EvidenceExport> => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const response = await fetch(`${BASE_URL}/api/engagements/${engagementId}/evidence`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      fail(response, body);
    }
    return response.json() as Promise<EvidenceExport>;
  },

  confirmEvidence: (
    engagementId: string,
    exportId: string,
    body: { sheetName: string; headerRow: number; columns: EvidenceColumnMapDto },
  ) =>
    request<EvidenceExport>(`/engagements/${engagementId}/evidence/${exportId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeEvidence: (engagementId: string, exportId: string) =>
    request<{ id: string }>(`/engagements/${engagementId}/evidence/${exportId}`, {
      method: 'DELETE',
    }),

  // -------------------------------------------------------------------------
  // Invoices behind the register
  // -------------------------------------------------------------------------

  /**
   * Firm-side only, and deliberately not in the portal allowlist.
   *
   * Decomposing a capitalized amount is a position taken on a taxpayer's
   * behalf. Half-read lines and unconfirmed links are working paper; what a
   * client sees is the finding they support, once somebody stands behind it.
   */
  invoices: (engagementId: string) => request<InvoiceList>(`/engagements/${engagementId}/invoices`),

  /** Multipart for the same boundary reason as `uploadFar`. */
  uploadInvoice: async (engagementId: string, file: File): Promise<InvoiceDocument> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${BASE_URL}/api/engagements/${engagementId}/invoices`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      fail(response, body);
    }
    return response.json() as Promise<InvoiceDocument>;
  },

  invoice: (engagementId: string, documentId: string) =>
    request<InvoiceDetail>(`/engagements/${engagementId}/invoices/${documentId}`),

  /**
   * `reread` runs the model again; `accept` is a person saying they have read
   * the document themselves, which is what lifts the unreviewed discount.
   */
  invoiceAction: (engagementId: string, documentId: string, action: 'accept' | 'reread') =>
    request<InvoiceDetail>(`/engagements/${engagementId}/invoices/${documentId}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  /** Every one of these answers with the whole document: one line moves the split. */
  correctInvoiceLine: (
    engagementId: string,
    documentId: string,
    body: { lineId: string; treatment: AssessabilityTreatment; reason?: string | null },
  ) =>
    request<InvoiceDetail>(`/engagements/${engagementId}/invoices/${documentId}/lines`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, reason: body.reason ?? null }),
    }),

  linkInvoice: (
    engagementId: string,
    documentId: string,
    body: { assetId: string; status?: 'suggested' | 'confirmed'; share?: number },
  ) =>
    request<InvoiceDetail>(`/engagements/${engagementId}/invoices/${documentId}/links`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unlinkInvoice: (engagementId: string, documentId: string, assetId: string) =>
    request<InvoiceDetail>(
      `/engagements/${engagementId}/invoices/${documentId}/links?assetId=${encodeURIComponent(assetId)}`,
      { method: 'DELETE' },
    ),

  // -------------------------------------------------------------------------
  // Multi-file intake
  // -------------------------------------------------------------------------

  intakeFiles: (engagementId: string) =>
    request<{ items: IntakeFile[] }>(`/engagements/${engagementId}/intake`),

  /** Multipart for the same boundary reason as `uploadFar`. */
  uploadIntake: async (engagementId: string, files: File[]): Promise<{ items: IntakeFile[] }> => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    const response = await fetch(`${BASE_URL}/api/engagements/${engagementId}/intake`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      fail(response, body);
    }
    return response.json() as Promise<{ items: IntakeFile[] }>;
  },

  routeIntake: (intakeId: string, route: IntakeRoute | 'dismiss') =>
    request<IntakeFile>(`/intake/${intakeId}/route`, {
      method: 'POST',
      body: JSON.stringify({ route }),
    }),

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

  assetProfile: (engagementId: string, assetId: string) =>
    request<AssetProfile>(`/engagements/${engagementId}/assets/${assetId}`),

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

  /**
   * `locationId` names which return, for an engagement that owes more than
   * one. Left out it means the only one there is — and where there are
   * several, the draft comes back covering the whole register and blocked,
   * which is the true answer to a question that assumed one form.
   */
  rendition: (
    engagementId: string,
    options: { basis: RenditionBasis; filedByAgent: boolean; locationId?: string | null },
  ) =>
    request<Rendition>(
      `/engagements/${engagementId}/rendition?basis=${options.basis}&filedByAgent=${options.filedByAgent}` +
        (options.locationId ? `&location=${encodeURIComponent(options.locationId)}` : ''),
    ),

  /**
   * Every return this engagement owes and where each one stands.
   *
   * The expensive read on this screen — it builds a rendition per site to say
   * whether each could go out today — so it is its own request rather than
   * part of the engagement's.
   */
  season: (engagementId: string) => request<FilingSeason>(`/engagements/${engagementId}/season`),

  /** The newest drafted unblock plan for an engagement, or null. */
  unblockPlan: (engagementId: string) =>
    request<{ plan: UnblockPlanRecord | null }>(`/engagements/${engagementId}/unblock`),

  /** Draft a plan from the season as it stands — a new row, never an edit. */
  draftUnblockPlan: (engagementId: string) =>
    request<{ plan: UnblockPlanRecord }>(`/engagements/${engagementId}/unblock`, {
      method: 'POST',
    }),

  /** The newest drafted result letter for an engagement, or null. */
  resultLetter: (engagementId: string) =>
    request<{ letter: ResultLetterRecord | null }>(`/engagements/${engagementId}/letter`),

  /** Draft a letter from the scoreboard as it stands — a new row, never an edit. */
  draftResultLetter: (engagementId: string) =>
    request<{ letter: ResultLetterRecord }>(`/engagements/${engagementId}/letter`, {
      method: 'POST',
    }),

  /** Everything asked of this engagement's record, newest first. */
  graphAsks: (engagementId: string) =>
    request<{ asks: GraphAskRecord[] }>(`/engagements/${engagementId}/ask`),

  /** Ask the record a question — the answer and the facts behind it, frozen together. */
  askGraph: (engagementId: string, question: string) =>
    request<{ ask: GraphAskRecord }>(`/engagements/${engagementId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  /**
   * Price a purchase nobody has made yet. Writes nothing — ask about the same
   * quote twice and the second answer is as free as the first.
   */
  advise: (engagementId: string, body: CapitalizationAdviceRequest) =>
    request<{ advice: CapitalizationAdvice }>(`/engagements/${engagementId}/advice`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // -------------------------------------------------------------------------
  // The assistant
  // -------------------------------------------------------------------------

  /** Every thread, newest activity first. Titles come from the first question. */
  assistantConversations: () =>
    request<{ conversations: AssistantConversation[] }>('/assistant/conversations'),

  /** One thread with every turn in it, oldest first. */
  assistantConversation: (conversationId: string) =>
    request<AssistantConversationDetail>(`/assistant/conversations/${conversationId}`),

  /**
   * Ask. A null `conversationId` starts a thread rather than requiring the
   * caller to create an empty one first, and the response says which thread
   * the turn landed in.
   *
   * This is the one call in the client that routinely runs for a minute: the
   * research loop can walk a whole book before the answer is composed. There
   * is no timeout on the fetch for that reason — a question abandoned halfway
   * through still costs the same and returns nothing.
   */
  assistantAsk: (body: AssistantAskRequest) =>
    request<AssistantAskResponse>('/assistant', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Delete a thread and its answers. Answers quote the record, so they carry
   * the record's confidentiality and a reader has to be able to remove them. */
  deleteAssistantConversation: (conversationId: string) =>
    request<{ deleted: true }>(`/assistant/conversations/${conversationId}`, {
      method: 'DELETE',
    }),

  /** What deleting this client would destroy, and what the operator should weigh. */
  deletionPreview: (clientId: string) =>
    request<{ preview: DeletionPreview }>(`/clients/${clientId}/deletion`),

  /** Delete the client and everything of theirs. The receipt is what survives. */
  deleteClient: (clientId: string, confirmName: string) =>
    request<{ receipt: DeletionReceipt }>(`/clients/${clientId}/deletion`, {
      method: 'POST',
      body: JSON.stringify({ confirmName }),
    }),

  /** The newest drafted 25.25 motion for one open year, or null. */
  motionDraft: (engagementId: string, yearKey: string) =>
    request<{ draft: MotionDraftRecord | null }>(
      `/engagements/${engagementId}/motion-draft?key=${encodeURIComponent(yearKey)}`,
    ),

  /** Draft a motion for one open year — a new row, never an edit. */
  draftCorrectionMotion: (engagementId: string, body: DraftMotionRequest) =>
    request<{ draft: MotionDraftRecord }>(`/engagements/${engagementId}/motion-draft`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * The same question across every client, for one tax year.
   *
   * The most expensive read in the app — a rendition per return in the whole
   * book — and the only place the question "what is holding up the most
   * returns" can be answered at all.
   */
  /** Who would roll from a season into the next. Creates nothing. */
  rolloverPlan: (fromYear: number) => request<RolloverPlan>(`/season/rollover?year=${fromYear}`),

  /** Open the next season for every ready client. Safe to run twice. */
  runRollover: (fromYear: number) =>
    request<RolloverResult>('/season/rollover', {
      method: 'POST',
      body: JSON.stringify({ fromYear }),
    }),

  practiceSeason: (taxYear?: number) =>
    request<PracticeSeason>(`/season${taxYear ? `?taxYear=${taxYear}` : ''}`),

  /**
   * Precision per finding type per jurisdiction, the rules repository, and the
   * release gate. Firm-only — the client wing cannot reach it.
   */
  quality: () => request<QualityView>('/quality'),
  /**
   * The acceptance rates the engine now uses, and the closed positions behind
   * each one. Also firm-only, and for a stronger reason: it is pooled across
   * every client the practice has.
   */
  acceptance: () => request<AcceptanceBoard>('/quality/acceptance'),
  model: () => request<DetectionModel>('/quality/model'),
  draftSchedule: (body: DraftScheduleRequest) =>
    request<DraftScheduleResult>('/quality/rule-drafts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Last season's returns against this season's register, asset by asset.
   *
   * The comparison the paper cannot do: two renditions side by side show two
   * totals, and this shows which pieces of property moved between them.
   */
  carryForward: (engagementId: string) =>
    request<CarryForward>(`/engagements/${engagementId}/carry-forward`),

  /**
   * Every year of this client's history 25.25 can still reach.
   *
   * Client-wide, not engagement-wide. The years worth money are the ones before
   * the firm was hired.
   */
  openYears: (engagementId: string) =>
    request<OpenYears>(`/engagements/${engagementId}/open-years`),

  /**
   * What the engagement's year came to: rendered, noticed, standing, per site.
   *
   * Derived entirely from records other calls wrote, which is what makes it
   * safe to read to a client.
   */
  engagementResult: (engagementId: string) =>
    request<EngagementResult>(`/engagements/${engagementId}/result`),

  /**
   * Every position taken to a district on this engagement, with what came back.
   *
   * Read at the asset grain even though it is displayed grouped, because the
   * grouping a screen wants and the grain a claim is stored at are different
   * questions and only one of them is settled.
   */
  recovery: (engagementId: string) =>
    request<EngagementRecovery>(`/engagements/${engagementId}/recovery`),

  /**
   * Record what a district did about those positions.
   *
   * Naming each one is the strong form. A single figure is split in proportion
   * and marked as such — reportable, and excluded from anything that learns.
   */
  recordSettlement: (engagementId: string, body: RecordSettlementRequest) =>
    request<EngagementRecovery>(`/engagements/${engagementId}/recovery`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** The client's copy of the same record. Used by the portal. */
  recoveryStatement: (engagementId: string) =>
    request<ClientRecoveryStatement>(`/engagements/${engagementId}/recovery/statement`),

  /**
   * Write down a 25.25 motion that has gone in.
   *
   * Returns the motion, but the screen it lives on re-reads the whole board:
   * a motion that ended closes (c-1) for its year under (c-1)(3), so the row
   * that changed is never the only row whose answer changed.
   */
  recordMotion: (engagementId: string, body: RecordMotionRequest) =>
    request<CorrectionMotion>(`/engagements/${engagementId}/motions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Record a hearing date, a 25.26 payment, or how the motion ended. */
  updateMotion: (motionId: string, body: UpdateMotionRequest) =>
    request<CorrectionMotion>(`/motions/${motionId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Take back a motion recorded in error, which gives its year the route back. */
  voidMotion: (motionId: string, reason: string) =>
    request<CorrectionMotion>(`/motions/${motionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  /** Every return recorded as filed on this engagement, newest first. */
  filings: (engagementId: string) =>
    request<RenditionFiling[]>(`/engagements/${engagementId}/filings`),

  /**
   * Record that a return went out.
   *
   * Deliberately sends no numbers. The server rebuilds the rendition and
   * freezes that, so what gets recorded is what this app would have filed.
   */
  recordFiling: (engagementId: string, body: RecordFilingRequest) =>
    request<RenditionFilingRecord>(`/engagements/${engagementId}/filings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  filing: (filingId: string) => request<RenditionFilingRecord>(`/filings/${filingId}`),

  voidFiling: (filingId: string, reason: string) =>
    request<RenditionFiling>(`/filings/${filingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  /** Every extension requested on this engagement, in force or not. */
  extensions: (engagementId: string) =>
    request<RenditionExtension[]>(`/engagements/${engagementId}/extensions`),

  /**
   * Record an extension request.
   *
   * Sends no date for a standard request. May 15 is the statute's answer, and
   * the server takes it from the same calendar the rest of the season uses.
   */
  requestExtension: (engagementId: string, body: RecordExtensionRequest) =>
    request<RenditionExtension>(`/engagements/${engagementId}/extensions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** What the district said back, or a row recorded in error. */
  answerExtension: (extensionId: string, body: AnswerExtensionRequest) =>
    request<RenditionExtension>(`/extensions/${extensionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Every notice of appraised value recorded on this engagement, newest first. */
  notices: (engagementId: string) =>
    request<AssessmentNotice[]>(`/engagements/${engagementId}/notices`),

  /**
   * Record a notice that arrived.
   *
   * Only the date is required. What that date is worth — which of 41.44's two
   * legs governs, whether 22.30's shorter clock is also running — is the
   * server's answer off the statute, not a figure this screen works out.
   */
  recordNotice: (engagementId: string, body: RecordNoticeRequest) =>
    request<AssessmentNotice>(`/engagements/${engagementId}/notices`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** The asks ledger for a file — every question the mapping raised. */
  fileAsks: (fileId: string) => request<{ items: AskRecord[] }>(`/files/${fileId}/asks`),

  /** Every question outstanding against a season: mapping asks and findings. */
  engagementAsks: (engagementId: string) =>
    request<{ items: AskRecord[] }>(`/engagements/${engagementId}/asks`),

  /** Raise the question a screening finding turns on. Idempotent per finding. */
  createFindingAsk: (engagementId: string, body: CreateAskRequest) =>
    request<AskRecord>(`/engagements/${engagementId}/asks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Record the client's answer, dismiss a question, or reopen either. */
  updateAsk: (askId: string, body: UpdateAskRequest) =>
    request<AskRecord>(`/asks/${askId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /**
   * What the intake would record for an uploaded notice. Advice, freshly
   * computed; confirming goes through recordNotice like a hand-typed one.
   */
  noticeProposal: (documentId: string) =>
    request<NoticeRecordProposal>(`/priors/${documentId}/notice-proposal`),

  /** The newest drafted protest brief for a notice, or null. */
  noticeBrief: (noticeId: string) =>
    request<{ brief: ProtestBriefRecord | null }>(`/notices/${noticeId}/brief`),

  /** Draft a brief from the record as it stands — a new row, never an edit. */
  draftNoticeBrief: (noticeId: string) =>
    request<{ brief: ProtestBriefRecord }>(`/notices/${noticeId}/brief`, { method: 'POST' }),

  /** That a protest went in, or that a notice was recorded in error. */
  updateNotice: (noticeId: string, body: UpdateNoticeRequest) =>
    request<AssessmentNotice>(`/notices/${noticeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * How the protest ended.
   *
   * Returns the notice, not the resolution. What a settlement is worth is a
   * statement about two figures — what the district proposed and what it came
   * to — and only one of them is on the resolution.
   */
  recordResolution: (noticeId: string, body: RecordResolutionRequest) =>
    request<AssessmentNotice>(`/notices/${noticeId}/resolution`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Take back a resolution recorded in error. */
  voidResolution: (resolutionId: string, body: VoidResolutionRequest) =>
    request<AssessmentNotice>(`/resolutions/${resolutionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

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
      fail(response, body);
    }
    return response.json() as Promise<PriorDocument>;
  },

  priorDocument: (documentId: string) => request<MappedPriorDocument>(`/priors/${documentId}`),

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

  // ---- The operational floor ------------------------------------------------
  // Not about a return: whether the software is up, and whether the firm is
  // paid for the season. Both firm-only, and neither in the client wing's
  // allowlist — an incident names our own failure, and a fee is our own bill.

  operations: () => request<OperationsView>('/operations'),

  resolveIncident: (incidentId: string, body: ResolveIncidentInput) =>
    request<OperationsView>(`/operations/incidents/${incidentId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  fees: (engagementId: string) => request<FeeView>(`/engagements/${engagementId}/fees`),

  saveFeeTerms: (engagementId: string, body: SaveFeeTermsInput) =>
    request<FeeView>(`/engagements/${engagementId}/fees`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  issueFeeStatement: (engagementId: string, body: IssueFeeStatementInput) =>
    request<FeeView>(`/engagements/${engagementId}/fees`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  settleFeeStatement: (statementId: string, body: SettleFeeStatementInput) =>
    request<FeeStatement>(`/fee-statements/${statementId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
