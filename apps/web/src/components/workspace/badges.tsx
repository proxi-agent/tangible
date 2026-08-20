import type {
  ClassificationSource,
  ClassificationStatus,
  ClientStatus,
  FarFileStatus,
  LineMappingSource,
  PriorDocumentStatus,
} from '@tangible/types';
import { Badge } from '@/components/ui/primitives';

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
  verified: { tone: 'good', label: 'foots' },
  discrepant: { tone: 'warning', label: 'does not foot' },
  accepted: { tone: 'accent', label: 'accepted' },
  failed: { tone: 'critical', label: 'failed' },
};

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
  return <Badge tone={source === 'schedule' ? 'accent' : 'neutral'}>{LINE_SOURCE_LABELS[source]}</Badge>;
}
