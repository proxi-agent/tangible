'use client';

import { OperationsBoard } from '@/components/workspace/operations-board';

/**
 * Firm-only, and not in the client wing's route allowlist.
 *
 * An incident names our own failure. A client who could read "the register
 * parser threw on a latin-1 byte, 14 times" would learn that their report was
 * late for a reason nobody told them, from a page rather than from a person —
 * which is the wrong order. What they see is their own run's status; what the
 * firm sees is why it is that.
 */
export default function OperationsPage() {
  return <OperationsBoard />;
}
