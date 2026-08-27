'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AskRecord } from '@tangible/types';
import { api } from '@/lib/api';

/**
 * Every question the firm has outstanding against this season.
 *
 * This used to fan out per file from the browser, on the reasoning that an ask
 * always hangs off the register it came from. Findings broke that: the question
 * a screening finding turns on is about the business, not about a spreadsheet,
 * and has no file to be fetched under. The union is made on the server now —
 * see `engagementAsks`.
 */
export function usePortalAsks(engagementId: string | null): {
  asks: AskRecord[];
  isLoading: boolean;
  error: unknown;
} {
  const query = useQuery({
    queryKey: ['engagement-asks', engagementId],
    queryFn: () => api.engagementAsks(engagementId!),
    enabled: Boolean(engagementId),
    staleTime: 30_000,
  });

  return {
    asks: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Refresh both views of the ledger after an answer.
 *
 * The same row is read two ways — by season here, by file on the Proxi wing's
 * file page — so an answer recorded in one wing has to invalidate the other's
 * key or the firm keeps looking at a question the client has already settled.
 */
export function useAskInvalidation(): (ask: AskRecord) => void {
  const queryClient = useQueryClient();
  return (ask: AskRecord) => {
    void queryClient.invalidateQueries({ queryKey: ['engagement-asks'] });
    if (ask.farFileId) {
      void queryClient.invalidateQueries({ queryKey: ['file-asks', ask.farFileId] });
    }
  };
}
