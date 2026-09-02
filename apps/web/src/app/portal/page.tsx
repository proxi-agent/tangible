'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { EngagementSite, SavingsFinding, SavingsReport } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, percent, plural } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/controls';
import { PortalHeader } from '@/components/portal/portal-header';
import { usePortal } from '@/components/portal/portal-context';
import { Waterfall } from '@/components/portal/waterfall';
import { AskBox } from '@/components/portal/ask-box';
import { askStateFor, FindingAsk } from '@/components/portal/finding-ask';
import { usePortalAsks } from '@/components/portal/use-portal-asks';
import { usePublishedReport } from '@/components/portal/use-published-report';
import { RunProgressCard } from '@/components/portal/run-progress';

/**
 * The report. The client wing opens here, because this is the only page a
 * business actually wants: what we found in the register they sent, what it is
 * worth, and the rows behind each claim.
 *
 * Two rules carried over from the firm-side report, and they matter more here
 * because this reader has no tax background:
 *
 *   - A question is never printed as a saving. Screening findings sit below the
 *     total with no dollar figure, because a number that dissolves the first
 *     time it is questioned costs more trust than it buys.
 *   - Every figure is reachable down to its assets. The waterfall bars are
 *     links, not decoration.
 */
export default function PortalReportPage() {
  const { engagementId, href } = usePortal();

  const published = usePublishedReport(engagementId);
  const sites = useQuery({
    queryKey: ['engagement-sites', engagementId],
    queryFn: () => api.sites(engagementId!),
    enabled: engagementId !== null,
  });

  if (engagementId === null) {
    return (
      <>
        <PortalHeader title="Your report" description="Nothing has been opened for you yet." />
        <Card>
          <EmptyState title="No tax year open">
            Once we open a year for you, your report appears here.
          </EmptyState>
        </Card>
      </>
    );
  }

  // A year with nothing read yet must not be introduced as a finding. "What we
  // found in the register you sent" sitting directly above "we have not read a
  // register for this year" reads as a report that came back empty, which is a
  // worse and different claim than not having looked.
  const description =
    published.report && published.report.coverage.assetCount === 0
      ? 'Nothing has been read for this year yet.'
      : 'What we found in the register you sent, and what it is worth.';

  return (
    <>
      <PortalHeader
        title="Your report"
        description={description}
        actions={
          <>
            {/* Only once there is something to print. Offered against a season
                with no published report, it hands the reader a page whose whole
                answer is that there is nothing yet. */}
            {published.report && published.report.coverage.assetCount > 0 ? (
              <LinkButton href={href('/portal/print')}>Save as PDF</LinkButton>
            ) : null}
            <LinkButton href={href('/portal/documents')}>Send more files</LinkButton>
          </>
        }
      />

      {published.isLoading ? (
        <Card>
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        </Card>
      ) : published.error ? (
        <Card>
          <ErrorState error={published.error} />
        </Card>
      ) : published.report ? (
        <Report
          report={published.report}
          sites={sites.data ?? []}
          runId={published.runId}
          publishedAt={published.publishedAt}
        />
      ) : published.inFlight ? (
        // A run is working. Shown in preference to the empty state below,
        // which would tell a client to send a register they have already sent.
        <RunProgressCard run={published.inFlight} />
      ) : (
        <Card>
          <EmptyState
            title="Your report is being prepared"
            action={<LinkButton href={href('/portal/documents')}>Send your register</LinkButton>}
          >
            We have not read a fixed asset register for this year yet. Send one and we will email
            you when the report is ready.
          </EmptyState>
        </Card>
      )}
    </>
  );
}

function Report({
  report,
  sites,
  runId,
  publishedAt,
}: {
  report: SavingsReport;
  sites: EngagementSite[];
  runId: string | null;
  publishedAt: string | null;
}) {
  const { href } = usePortal();

  // Nothing to price means nothing has been read yet — a report of zeroes
  // reads like a finding of "no savings", which is a different and much worse
  // claim than "we have not looked yet".
  if (report.coverage.assetCount === 0) {
    return (
      <Card>
        <EmptyState
          title="Your report is being prepared"
          action={<LinkButton href={href('/portal/documents')}>Send your register</LinkButton>}
        >
          We have not read a fixed asset register for this year yet. Send one and we will email you
          when the report is ready.
        </EmptyState>
      </Card>
    );
  }

  const priced = report.findings.filter((f) => f.valueRemoved !== null);
  const leads = report.findings.filter((f) => f.valueRemoved === null);

  const rate = report.blendedTaxRate;
  const asStands = report.farImpliedValue + report.totalValueRemoved;
  const taxAsStands = (report.assessed?.assessedValue ?? asStands) * rate;
  // Falls back to the correction the register supports when no district account
  // is linked yet — there is no "before" without the roll, so the figure is the
  // value we take off rather than a saving against an assessment, and the note
  // under it says which of the two is on screen.
  const saving =
    report.estimatedAnnualSaving ?? (report.totalValueRemoved + report.exemption.applied) * rate;

  const flagged = new Set(priced.flatMap((f) => f.evidence.map((row) => row.assetId))).size;
  const registerCost = sites.reduce((sum, site) => sum + site.totalCost, 0);
  const registerAssets = sites.reduce((sum, site) => sum + site.assetCount + site.disposedCount, 0);
  const siteCount = sites.length;

  const { assetCount, valuedCount, inFindingsCount, needsReviewCount, unclassifiedCount } =
    report.coverage;
  const settled = valuedCount + inFindingsCount;
  const holding = needsReviewCount + unclassifiedCount + report.coverage.unvaluableCount;

  return (
    <div className="space-y-6">
      <Card>
        <StatGrid columns={5}>
          <StatCell>
            <Stat
              label="Fixed assets reviewed"
              value={money(registerCost || report.farOriginalCost)}
              help="The original cost on every line of the register you sent — held and disposed alike."
              note={`${count(registerAssets || assetCount)} ${plural(registerAssets || assetCount, 'line')}${siteCount > 0 ? ` · ${count(siteCount)} ${plural(siteCount, 'location')}` : ''}`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Tax as it stands"
              value={money(taxAsStands)}
              help={`A year of business personal property tax on the position you are in today, at ${percent(rate, 2)} \u2014 ${report.rateSource.label}. ${report.rateSource.detail}`}
              note={
                report.assessed
                  ? `The district has you at ${money(report.assessed.assessedValue)}`
                  : 'If the register were rendered exactly as it stands'
              }
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Savings identified"
              value={money(saving)}
              tone="good"
              size="lg"
              help={`A year of tax on the value that comes off, at ${percent(rate, 2)} \u2014 ${report.rateSource.label}. Only findings we can put a number on are counted \u2014 the questions below are not.`}
              note={
                report.estimatedAnnualSaving === null
                  ? 'On the corrected position; no account linked yet'
                  : `Against the ${money(report.assessed?.assessedValue)} the district has you at`
              }
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Assets flagged"
              value={count(flagged)}
              help="Register lines behind the findings below. Each one is listed with the reason it was flagged."
              // "Open question" was the wrong word for these: the Questions
              // page is the asks ledger, and a reader sent looking for one
              // there finds nothing. They live on the card below.
              note={`${percent(assetCount > 0 ? flagged / assetCount : 0, 1)} of the register${leads.length > 0 ? ` · ${count(leads.length)} worth asking about` : ''}`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Register read"
              value={percent(assetCount > 0 ? settled / assetCount : 0, 0)}
              tone={holding > 0 ? 'warning' : 'good'}
              help="How much of what you sent this report actually speaks for. A total that quietly omits a third of the assets looks complete, which is worse than one that admits the gap."
              note={
                holding > 0
                  ? `${count(holding)} ${plural(holding, 'line')} still being read`
                  : 'Every line accounted for'
              }
            />
          </StatCell>
        </StatGrid>
      </Card>

      {report.totalExpectedRecovery > 0 ? (
        /**
         * The way this report is meant to be worked, above the category list
         * rather than beside it. The waterfall answers "where does the number
         * come from"; it cannot answer "what should I spend this afternoon on",
         * because the biggest line in the smallest category outranks most of
         * the biggest one and no category page can see across the others.
         */
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-sm font-medium">Work it in order</p>
              <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
                Every finding below as one ranked list — the decisions worth the most first,
                whichever category they came from. {money(report.totalExpectedRecovery)} of expected
                recovery across the report, after allowing for what a district is likely to concede.
              </p>
            </div>
            <LinkButton href={href('/portal/queue')}>Start with the top 25</LinkButton>
          </div>
        </Card>
      ) : null}

      {priced.length > 0 ? (
        <Card>
          <CardHeader
            title="Where the value comes off"
            description={
              report.assessed
                ? 'From what the district has you at today to what a corrected return supports. Click any line to see the assets behind it — this is the view for checking that nothing was missed.'
                : 'From what your register says today to what a corrected return supports. Click any line to see the assets behind it — this is the view for checking that nothing was missed.'
            }
            help={`Each step is an adjustment with a statutory basis and the register rows that produced it. Of the corrections, ${money(report.leakage.measuredValue * rate)} a year is measured from your own data and ${money(report.leakage.modeledValue * rate)} rests on a stated assumption.`}
          />
          <Waterfall report={report} />
        </Card>
      ) : (
        <Card>
          <EmptyState title="No corrections found yet">
            We priced your register on the district’s schedules and did not find value to take off.
            If that changes as we finish reading, it will appear here.
          </EmptyState>
        </Card>
      )}

      {leads.length > 0 ? (
        <Card>
          <CardHeader
            title="Worth asking about"
            description="Money a register cannot settle on its own. Each turns on one fact about your business — answer it here and we take it from there."
            help="None of these is counted in the savings above, and answering one does not move the number by itself: your team works the answer into the return, and the report follows. An unanswered question is not a saving — but these are usually the largest ones."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {leads.map((finding) => (
              <Lead key={finding.key} finding={finding} />
            ))}
          </ul>
        </Card>
      ) : null}

      <AskBox />

      <Callout tone="neutral" title="How these numbers were arrived at">
        {/* The schedule's own title already carries its year, so printing the
            year again beside it read as a typo rather than as provenance. */}
        {report.schedule
          ? `Every asset was valued on the district’s own published depreciation schedule, ${report.schedule.title}${report.schedule.isFallbackYear ? ' — the closest year they have published' : ''}. `
          : 'Every asset was valued on the district’s own published depreciation schedule. '}
        {report.sic
          ? `Machinery uses the ${report.sic.description} life (${report.sic.machineryLife} years). `
          : 'Machinery uses a ten-year life, as no line of business has been set yet. '}
        Tax is figured at {percent(rate, 2)}, the blended rate for{' '}
        {report.jurisdictionName ?? 'your jurisdiction'}.
        {runId ? (
          <>
            {' '}
            {/* The one line that makes this quotable. A client ringing us in
                eighteen months about "the number you sent me" is otherwise
                asking about a report that has since been recomputed twice. */}
            <span className="block pt-2 text-xs text-[var(--color-ink-muted)]">
              Published{' '}
              {publishedAt
                ? new Date(publishedAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : null}{' '}
              · reference <span className="font-mono">{runId}</span>. Quote it to us and we can show
              you exactly these numbers again.
            </span>
          </>
        ) : null}
      </Callout>
    </div>
  );
}

function Lead({ finding }: { finding: SavingsFinding }) {
  const { engagementId, href } = usePortal();
  const { asks } = usePortalAsks(engagementId);
  const state = askStateFor(asks, finding);

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={href(`/portal/report/${encodeURIComponent(finding.key)}`)}
          className="text-sm font-medium hover:text-[var(--color-accent)]"
        >
          {finding.title}
        </Link>
        {/* The badge tracks the question, not the money — the card header
            already says none of these is counted. Until the answer form
            existed this said "not counted yet", because a badge that asks for
            something the screen cannot take reads as a broken control. */}
        {state === 'answered' ? (
          <Badge tone="good">answered</Badge>
        ) : (
          <Badge tone="warning">{state === 'asked' ? 'waiting on you' : 'needs your answer'}</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{finding.summary}</p>
      {finding.originalCost > 0 ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {money(finding.originalCost)} of cost behind the question, across{' '}
          {count(finding.assetCount)} {plural(finding.assetCount, 'asset')}.
          {state === 'answered'
            ? ' What comes off it is what your team works out from your answer.'
            : ' The amount is unknown until it is answered.'}
        </p>
      ) : null}
      <div className="mt-3">
        <FindingAsk finding={finding} />
      </div>
    </li>
  );
}
