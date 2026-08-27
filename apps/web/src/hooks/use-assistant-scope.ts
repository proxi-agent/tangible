'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import type { AssistantScope } from '@tangible/types';
import { useScope } from '@/hooks/use-scope';

/**
 * Where the reader is standing, in the form the assistant is given it.
 *
 * This exists because most of what a preparer types is deictic. "Is this ready
 * to file", "what's blocking these", "how does this compare to the roll" — none
 * of those name a client, and all of them are perfectly clear to a colleague
 * standing at the same screen. The scope is what makes the assistant that
 * colleague: it carries the ids the page is already addressed by, so the model
 * resolves "this client" the same way a person would.
 *
 * The two wings contribute different halves. A workspace path carries a client
 * and possibly an engagement in the URL itself. A market path carries no ids at
 * all — its subject is the state, county and year in the scope selectors — so
 * those come from `useScope`, which is already mounted in the shell and has the
 * resolved jurisdiction rather than the raw query string. The jurisdiction id
 * travels alongside the county name because it is what the lookup tools take,
 * and a model that has it skips a round trip discovering it.
 *
 * Nothing here is authorization. The scope narrows what a question is *about*;
 * it does not widen or restrict what the tools may read, and a question asked
 * from a client page can still be answered from another client's record if
 * that is what it asked for.
 */

/**
 * Page names, longest match first. Deliberately the words on the screen rather
 * than the route: the label is shown back to the reader on the stored turn, and
 * "Findings" is what they will remember standing on, not `/findings/[setId]`.
 */
const LABELS: readonly [RegExp, string][] = [
  [/^\/assistant/, 'the assistant'],
  [/^\/season/, 'the practice season board'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/findings/, 'the findings screen of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/report/, 'the savings report of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/filing\/form/, 'a rendition form draft'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/filing/, 'the filing screen of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/priors/, 'a prior year return of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/assets/, 'an asset profile in an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/files/, 'an uploaded register file of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+\/ask/, 'the ask-the-record screen of an engagement'],
  [/^\/clients\/[^/]+\/engagements\/[^/]+/, 'an engagement'],
  [/^\/clients\/[^/]+/, 'a client'],
  [/^\/clients/, 'the client list'],
  [/^\/filings\/[^/]+/, 'a filed rendition'],
  [/^\/market/, 'the market overview'],
  [/^\/accounts\/[^/]+/, 'one account on the public appraisal roll'],
  [/^\/accounts/, 'the account list on the public appraisal roll'],
  [/^\/owners/, 'the owner rollup on the public appraisal roll'],
  [/^\/data/, 'the data sources catalogue'],
];

function labelFor(pathname: string): string | null {
  for (const [pattern, label] of LABELS) if (pattern.test(pathname)) return label;
  return null;
}

function isMarketPath(pathname: string): boolean {
  return (
    pathname.startsWith('/market') ||
    pathname.startsWith('/accounts') ||
    pathname.startsWith('/owners') ||
    pathname.startsWith('/data')
  );
}

export function useAssistantScope(): AssistantScope {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = useScope();

  // The account page carries its jurisdiction and year in the query string
  // rather than in the selectors, so read both and let the selectors lose.
  const queryYear = Number(searchParams.get('taxYear'));
  const onMarket = isMarketPath(pathname);
  const current = scope.current;

  const inClient = /^\/clients\/([^/]+)(?:\/engagements\/([^/]+))?/.exec(pathname);
  const clientId = inClient?.[1] ?? null;
  const engagementId = inClient?.[2] ?? null;

  return useMemo(
    () => ({
      path: pathname,
      label: labelFor(pathname),
      clientId,
      engagementId,
      // A client engagement has no county scope. Sending one anyway would tell
      // the model the page is about a county it is not about.
      state: onMarket ? scope.stateCode : null,
      county: onMarket && current ? `${current.name} — jurisdictionId ${current.id}` : null,
      taxYear: onMarket
        ? Number.isFinite(queryYear) && queryYear
          ? queryYear
          : scope.taxYear
        : null,
    }),
    [
      pathname,
      clientId,
      engagementId,
      onMarket,
      scope.stateCode,
      scope.taxYear,
      current,
      queryYear,
    ],
  );
}
