'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The report the client is entitled to see: the last published run.
 *
 * Every portal screen reads through this rather than `api.savings`, and the
 * difference is the whole point of runs. The firm's report is derived on read
 * and moves whenever a preparer settles a row — correct for the person causing
 * the change, and indefensible for the taxpayer who reads $84,000 on Tuesday
 * and $61,000 on Thursday with nothing in between they did or were told about.
 *
 * While a run is in flight the query polls. It is the only place in the app
 * that does: everywhere else the data changes because the reader changed it, so
 * a refetch would be noise, and here the reader is waiting on work happening
 * somewhere else entirely.
 */
export function usePublishedReport(engagementId: string | null) {
  const query = useQuery({
    queryKey: ['published-report', engagementId],
    queryFn: () => api.publishedReport(engagementId!),
    enabled: engagementId !== null,
    // A published report does not change. Only an in-flight run is worth
    // asking about again, and five seconds is roughly the granularity of the
    // steps it moves through.
    refetchInterval: (query) => (query.state.data?.inFlight ? 5_000 : false),
  });

  return {
    report: query.data?.report ?? null,
    runId: query.data?.runId ?? null,
    publishedAt: query.data?.publishedAt ?? null,
    inFlight: query.data?.inFlight ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
