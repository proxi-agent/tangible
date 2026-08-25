import { z } from 'zod';
import { EngagementResultSchema } from './filing.js';
import {
  AssessedPositionSchema,
  SavingsCoverageSchema,
  SavingsFindingSchema,
  SavingsLeakageSchema,
} from './savings.js';

/**
 * Ask-the-graph: a question about the engagement, answered from the record.
 *
 * Same discipline as the drafting agents — the digest is assembled by code
 * from the same builders the screens render, the model answers from the digest
 * and nothing else, and both are frozen together so an answer read months
 * later is a statement about what the record said then. What is new here is
 * the direction: the person supplies the question, and the answer's job is to
 * point back into the workspace — every claim carries references the UI turns
 * into links, and a reference the record cannot back is dropped by code
 * before the answer is stored.
 */

export const DIGEST_ASSET_STATUSES = [
  /** Settled, taxable, on the corrected position. */
  'in-service',
  'disposed',
  'excluded',
  'needs-review',
  'unclassified',
] as const;

export const DigestAssetStatusSchema = z.enum(DIGEST_ASSET_STATUSES);
export type DigestAssetStatus = (typeof DIGEST_ASSET_STATUSES)[number];

/** One register line as the answerer is allowed to see it. */
export const DigestAssetSchema = z.object({
  id: z.string(),
  tag: z.string().nullable(),
  description: z.string().nullable(),
  /** The site label where placed; null for property placed nowhere yet. */
  site: z.string().nullable(),
  /** The classification's human label; null while unclassified. */
  category: z.string().nullable(),
  status: DigestAssetStatusSchema,
  acquisitionYear: z.number().int().nullable(),
  originalCost: z.number().nullable(),
});

export type DigestAsset = z.infer<typeof DigestAssetSchema>;

/** A savings finding without its evidence rows — the assets are already here. */
export const DigestFindingSchema = SavingsFindingSchema.omit({ evidence: true });
export type DigestFinding = z.infer<typeof DigestFindingSchema>;

/** Everything an answer may rest on, frozen on the row at answer time. */
export const GraphDigestSchema = z.object({
  clientName: z.string(),
  taxYear: z.number().int(),
  jurisdictionName: z.string().nullable(),
  generatedAt: z.string().datetime(),

  /** The season scoreboard: per-site phases, totals, standing prose. */
  season: EngagementResultSchema,
  /** What the public roll says, where an account is linked. */
  assessed: AssessedPositionSchema.nullable(),
  coverage: SavingsCoverageSchema,
  leakage: SavingsLeakageSchema,
  findings: z.array(DigestFindingSchema),

  /** Largest cost first. The cap keeps the digest bounded; the count says so. */
  assets: z.array(DigestAssetSchema),
  assetsOmitted: z.number().int().nonnegative(),
});

export type GraphDigest = z.infer<typeof GraphDigestSchema>;

export const GRAPH_REFERENCE_KINDS = ['asset', 'site', 'report', 'returns'] as const;
export const GraphReferenceKindSchema = z.enum(GRAPH_REFERENCE_KINDS);
export type GraphReferenceKind = (typeof GRAPH_REFERENCE_KINDS)[number];

/**
 * Where an answer's claim lives in the workspace. `id` is the digest's own
 * asset id or site locationId; null for the two singleton screens. The UI
 * renders these as links, which is the reason ask-the-graph waited for the
 * screens to exist.
 */
export const GraphReferenceSchema = z.object({
  kind: GraphReferenceKindSchema,
  id: z.string().nullable(),
  label: z.string(),
});

export type GraphReference = z.infer<typeof GraphReferenceSchema>;

/**
 * What the model answers. `limits` face the firm: what the digest could not
 * settle and what would — empty when the record answered outright.
 */
export const GraphAnswerSchema = z.object({
  answer: z.string(),
  references: z.array(GraphReferenceSchema),
  limits: z.array(z.string()),
});

export type GraphAnswer = z.infer<typeof GraphAnswerSchema>;

export const AskGraphRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
});

export type AskGraphRequest = z.infer<typeof AskGraphRequestSchema>;

/** A stored exchange: the question, the frozen digest, and the answer. */
export const GraphAskRecordSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  question: z.string(),
  facts: GraphDigestSchema,
  answer: GraphAnswerSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type GraphAskRecord = z.infer<typeof GraphAskRecordSchema>;
