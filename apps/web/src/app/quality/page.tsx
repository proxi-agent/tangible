'use client';

import { QualityBoard } from '@/components/workspace/quality-board';

/**
 * Firm-only, and deliberately not in the client wing's route allowlist.
 *
 * A client reading "situs-error is right 71% of the time" learns nothing they
 * can act on and one thing that would make them doubt a finding that happens to
 * be right. What they see instead is the confidence on their own rows, which is
 * a statement about their property rather than about our tooling.
 */
export default function QualityPage() {
  return <QualityBoard />;
}
