import type {
  ClassificationSource,
  ClassificationStatus,
  ClientStatus,
  FarFileStatus,
  FindingDispositionStatus,
  FindingEffect,
  LineMappingSource,
  PriorDocumentStatus,
} from '@tangible/types';
import { Badge, type BadgeTone } from '@/components/ui/primitives';

const CLIENT_TONES: Record<ClientStatus, 'neutral' | 'accent' | 'good'> = {
  prospect: 'accent',
  active: 'good',
  archived: 'neutral',
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={CLIENT_TONES[status]}>{status}</Badge>;
}

/** One vocabulary for where a file is in the pipeline, shared by every list. */
const FILE_TONES: Record<
  FarFileStatus,
  { tone: 'neutral' | 'accent' | 'warning' | 'critical' | 'good'; label: string }
> = {
  uploaded: { tone: 'neutral', label: 'uploaded' },
  parsed: { tone: 'accent', label: 'awaiting mapping' },
  proposed: { tone: 'warning', label: 'mapping to review' },
  normalized: { tone: 'good', label: 'assets loaded' },
  failed: { tone: 'critical', label: 'failed' },
};

export function FarFileStatusBadge({ status }: { status: FarFileStatus }) {
  const { tone, label } = FILE_TONES[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const CLASSIFICATION_TONES: Record<
  ClassificationStatus,
  { tone: 'neutral' | 'accent' | 'warning' | 'good'; label: string }
> = {
  'auto-accepted': { tone: 'accent', label: 'auto' },
  'needs-review': { tone: 'warning', label: 'review' },
  confirmed: { tone: 'good', label: 'confirmed' },
};

export function ClassificationStatusBadge({ status }: { status: ClassificationStatus }) {
  const { tone, label } = CLASSIFICATION_TONES[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Where a decision came from, which matters as much as the decision. A
 * confidence of 1 means something quite different from memory than from a
 * model, so the two are never shown without this beside them.
 */
const SOURCE_LABELS: Record<ClassificationSource, string> = {
  memory: 'memory',
  ai: 'AI',
  human: 'reviewer',
};

export function ClassificationSourceBadge({ source }: { source: ClassificationSource }) {
  return <Badge tone="neutral">{SOURCE_LABELS[source]}</Badge>;
}

/**
 * How far a prior filing has got, and whether its figures can be leaned on.
 *
 * `discrepant` is warning rather than critical on purpose: a return that does
 * not foot is usually a real arithmetic error in the client's own filing, which
 * is a finding worth having, not a broken upload.
 */
const PRIOR_TONES: Record<
  PriorDocumentStatus,
  { tone: 'neutral' | 'accent' | 'warning' | 'critical' | 'good'; label: string }
> = {
  uploaded: { tone: 'neutral', label: 'reading' },
  // "Foots" is accountants' shorthand a first-time user will not have; the
  // badge says what the check found in words anyone can act on.
  verified: { tone: 'good', label: 'adds up' },
  discrepant: { tone: 'warning', label: 'does not add up' },
  accepted: { tone: 'accent', label: 'accepted' },
  failed: { tone: 'critical', label: 'failed' },
};

/**
 * Where an invoice is, in the words that matter to a preparer.
 *
 * `needs-review` is not a failure — it is the extractor saying the reading was
 * weak or the rules did not recognize enough of what they read, which is a
 * different problem from a document that would not open. And `extracted` is
 * deliberately not the end of the road: nothing is trusted at full weight until
 * somebody has said they read it, which is what `accepted` records.
 */
const INVOICE_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  uploaded: { tone: 'neutral', label: 'uploaded' },
  extracting: { tone: 'accent', label: 'reading' },
  extracted: { tone: 'accent', label: 'read' },
  'needs-review': { tone: 'warning', label: 'needs review' },
  accepted: { tone: 'good', label: 'reviewed' },
  failed: { tone: 'critical', label: 'failed' },
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const meta = INVOICE_TONES[status] ?? { tone: 'neutral' as BadgeTone, label: status };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function PriorDocumentStatusBadge({ status }: { status: PriorDocumentStatus }) {
  const { tone, label } = PRIOR_TONES[status] ?? PRIOR_TONES.uploaded;
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Where a line mapping came from. The asset vocabulary has three sources; this
 * one has a fourth, and it is the most important of them — `schedule` means the
 * form itself said so, and nothing was inferred at all.
 */
const LINE_SOURCE_LABELS: Record<LineMappingSource, string> = {
  schedule: 'the form',
  memory: 'memory',
  ai: 'AI',
  human: 'reviewer',
};

export function LineMappingSourceBadge({ source }: { source: LineMappingSource }) {
  return (
    <Badge tone={source === 'schedule' ? 'accent' : 'neutral'}>{LINE_SOURCE_LABELS[source]}</Badge>
  );
}

/**
 * Which way a finding moves the client's position.
 *
 * Exposure is warning rather than critical: finding that a client is
 * under-reported is the service working, and it is worth far more to them
 * coming from us in March than from the district in an audit letter. Rendered
 * in red it would read as a failure.
 */
const EFFECT_META: Record<FindingEffect, { tone: 'good' | 'warning' | 'neutral'; label: string }> =
  {
    saving: { tone: 'good', label: 'saving' },
    exposure: { tone: 'warning', label: 'exposure' },
    neutral: { tone: 'neutral', label: 'no effect' },
  };

export function FindingEffectBadge({ effect }: { effect: FindingEffect }) {
  const { tone, label } = EFFECT_META[effect];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * What was decided about a finding. There is no badge for undecided, because
 * there is no record for it — an absent badge is the honest rendering of "we
 * have not asked yet".
 */
const DISPOSITION_META: Record<
  FindingDispositionStatus,
  { tone: 'good' | 'neutral' | 'accent'; label: string }
> = {
  accepted: { tone: 'good', label: 'accepted' },
  rejected: { tone: 'neutral', label: 'declined' },
  'pending-client': { tone: 'accent', label: 'with the client' },
};

export function FindingDispositionBadge({ status }: { status: FindingDispositionStatus }) {
  const { tone, label } = DISPOSITION_META[status];
  return <Badge tone={tone}>{label}</Badge>;
}
