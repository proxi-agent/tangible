import type {
  IntakeFile,
  IntakeRoute,
  AccountQuery,
  AccountSeries,
  AgentAppointment,
  AnswerExtensionRequest,
  AssessmentNotice,
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
  CorrectionMotion,
  Engagement,
  EngagementResult,
  EngagementDetail,
  EngagementReturns,
  EngagementSite,
  EngagementValuation,
  FarFile,
  FarMapping,
  FilingAgent,
  FilingSeason,
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
  RecordNoticeRequest,
  NoticeRecordProposal,
  MappingAskRecord,
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
  appointmentPdfUrl: (appointmentId: string) =>
    `${BASE_URL}/api/appointments/${appointmentId}/pdf`,

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
      throw new ApiError(errorMessage(body) || response.statusText, response.status);
    }
    return response.json() as Promise<FarFile>;
  },

  farFile: (fileId: string) => request<FarFile>(`/files/${fileId}`),

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
      throw new ApiError(errorMessage(body) || response.statusText, response.status);
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

  /**
   * The same question across every client, for one tax year.
   *
   * The most expensive read in the app — a rendition per return in the whole
   * book — and the only place the question "what is holding up the most
   * returns" can be answered at all.
   */
  practiceSeason: (taxYear?: number) =>
    request<PracticeSeason>(`/season${taxYear ? `?taxYear=${taxYear}` : ''}`),

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
  fileAsks: (fileId: string) => request<{ items: MappingAskRecord[] }>(`/files/${fileId}/asks`),

  /** Record the client's answer, dismiss a question, or reopen either. */
  updateAsk: (askId: string, body: UpdateAskRequest) =>
    request<MappingAskRecord>(`/asks/${askId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /**
   * What the intake would record for an uploaded notice. Advice, freshly
   * computed; confirming goes through recordNotice like a hand-typed one.
   */
  noticeProposal: (documentId: string) =>
    request<NoticeRecordProposal>(`/priors/${documentId}/notice-proposal`),

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
      throw new ApiError(errorMessage(body) || response.statusText, response.status);
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
};
