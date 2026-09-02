'use client';

import { Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { EngagementSite, SavingsFinding, SavingsReport } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, money, percent, plural } from '@/lib/format';
import { Button, LinkButton } from '@/components/ui/controls';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { usePortal } from '@/components/portal/portal-context';
import { usePublishedReport } from '@/components/portal/use-published-report';
import { waterfallShape } from '@/lib/waterfall';

/**
 * The report as a document.
 *
 * Everything else in this wing is built to be worked: bars that open into their
 * assets, questions with an answer box under them, a queue that reorders itself.
 * None of that survives a printer, and none of it is what a controller needs
 * when they forward the analysis to a CFO who will never sign in — which is the
 * form this report spends most of its life in.
 *
 * So this is the same numbers with the interaction taken out and the evidence
 * put back in. The waterfall becomes a table, because a bar whose length is the
 * information is worth nothing in a column of figures. Each priced finding
 * prints its basis and its assumption in full rather than behind a tooltip,
 * since there is nothing to hover. The questions print with their questions and
 * without amounts, which is the report's own rule and matters more here: on
 * paper, next to a column of dollars, an unpriced lead is read as priced.
 *
 * Save-as-PDF rather than a generated file. The browser's own print pipeline
 * already paginates, embeds fonts and honours the styles below, and every PDF
 * library that would replace it is a dependency that renders a second, subtly
 * different version of this page — which is the failure worth avoiding, because
 * the version a client keeps is the one they will quote back.
 */
export default function PortalPrintPage() {
  const { engagementId, detail, href } = usePortal();

  const published = usePublishedReport(engagementId);
  const sites = useQuery({
    queryKey: ['engagement-sites', engagementId],
    queryFn: () => api.sites(engagementId!),
    enabled: engagementId !== null,
  });

  if (published.isLoading || engagementId === null) {
    return (
      <Card>
        <div className="space-y-3 px-5 py-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Card>
    );
  }
  if (published.error) {
    return (
      <Card>
        <ErrorState error={published.error} />
      </Card>
    );
  }
  if (!published.report || published.report.coverage.assetCount === 0) {
    return (
      <Card>
        <EmptyState
          title="There is no published report to print yet"
          action={<LinkButton href={href('/portal')}>Back to your report</LinkButton>}
        >
          Once a register has been read and a report published, it can be saved as a PDF from here.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Document
      report={published.report}
      sites={sites.data ?? []}
      runId={published.runId}
      publishedAt={published.publishedAt}
      clientName={detail.client.name}
      back={href('/portal')}
    />
  );
}

function Document({
  report,
  sites,
  runId,
  publishedAt,
  clientName,
  back,
}: {
  report: SavingsReport;
  sites: EngagementSite[];
  runId: string | null;
  publishedAt: string | null;
  clientName: string;
  back: string;
}) {
  const rate = report.blendedTaxRate;
  const shape = waterfallShape(report);
  const priced = report.findings.filter((f) => f.valueRemoved !== null);
  const leads = report.findings.filter((f) => f.valueRemoved === null);
  const registerCost = sites.reduce((sum, site) => sum + site.totalCost, 0);
  const saving =
    report.estimatedAnnualSaving ?? (report.totalValueRemoved + report.exemption.applied) * rate;
  const asStands = report.assessed?.assessedValue ?? report.farImpliedValue + report.totalValueRemoved;

  const { assetCount, valuedCount, inFindingsCount } = report.coverage;
  const holding =
    report.coverage.needsReviewCount +
    report.coverage.unclassifiedCount +
    report.coverage.unvaluableCount;

  return (
    <div className="space-y-8">
      {/* The only control on the page, and the only thing the printer must not
          see. `print:hidden` rather than the global `[data-chrome]` rule,
          because this is content on screen — it is the page's whole purpose. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <LinkButton href={back}>← Back to your report</LinkButton>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={15} strokeWidth={2} />
          Print or save as PDF
        </Button>
      </div>

      <article className="print-document space-y-7 text-[var(--color-ink)]">
        <header className="border-b border-[var(--color-hairline)] pb-4">
          <p className="eyebrow">{clientName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {report.taxYear} business personal property report
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">
            {report.jurisdictionName ?? 'Jurisdiction not set'}
            {report.assessed ? ` · account ${report.assessed.accountId}` : ''}
            {publishedAt ? ` · published ${day(publishedAt)}` : ''}
          </p>
          {runId ? (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Reference <span className="font-mono">{runId}</span>. Quote it and we can show you
              exactly these numbers again.
            </p>
          ) : null}
        </header>

        <Section title="In summary">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Figure
              label="Fixed assets reviewed"
              value={money(registerCost || report.farOriginalCost)}
              note={`${count(assetCount)} ${plural(assetCount, 'line')} read`}
            />
            <Figure
              label="Tax as it stands"
              value={money(asStands * rate)}
              note={
                report.assessed
                  ? `On the ${money(asStands)} the district has you at`
                  : `On the ${money(asStands)} your register supports`
              }
            />
            <Figure
              label="Savings identified"
              value={money(saving)}
              note={`A year of tax at ${percent(rate, 2)}`}
            />
            <Figure
              label="Register read"
              value={percent(assetCount > 0 ? (valuedCount + inFindingsCount) / assetCount : 0, 0)}
              note={
                holding > 0
                  ? `${count(holding)} ${plural(holding, 'line')} still being read`
                  : 'Every line accounted for'
              }
            />
          </dl>
        </Section>

        {shape ? (
          <Section
            title="Where the value comes off"
            lede={
              report.assessed
                ? 'From what the district has you at today to what a corrected return supports.'
                : 'From what your register says today to what a corrected return supports.'
            }
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-left">
                  <th className="py-1.5 font-medium">Step</th>
                  <th className="py-1.5 text-right font-medium">Taxable value</th>
                  <th className="py-1.5 text-right font-medium">A year of tax</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--color-hairline)]">
                  <td className="py-1.5">
                    {shape.fromRoll
                      ? 'What the district has you at today'
                      : 'Your register, valued as it stands'}
                  </td>
                  <td className="tabular py-1.5 text-right">{money(shape.start)}</td>
                  <td className="tabular py-1.5 text-right">{money(shape.start * rate)}</td>
                </tr>
                {shape.steps.map((step) => (
                  <tr key={step.key} className="border-b border-[var(--color-hairline)]">
                    <td className="py-1.5 pl-4">{step.label}</td>
                    <td className="tabular py-1.5 text-right">− {money(step.amount)}</td>
                    <td className="tabular py-1.5 text-right">− {money(step.amount * rate)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">What a corrected return supports</td>
                  <td className="tabular py-2 text-right">{money(shape.end)}</td>
                  <td className="tabular py-2 text-right">{money(report.proposedTax)}</td>
                </tr>
              </tbody>
            </table>
          </Section>
        ) : null}

        {priced.length > 0 ? (
          <Section
            title="The findings behind that"
            lede={`Of the corrections, ${money(report.leakage.measuredValue * rate)} a year is measured from your own register and ${money(report.leakage.modeledValue * rate)} rests on a stated assumption.`}
          >
            <div className="space-y-4">
              {priced
                .slice()
                .sort((a, b) => (b.valueRemoved ?? 0) - (a.valueRemoved ?? 0))
                .map((finding) => (
                  <Finding key={finding.key} finding={finding} rate={rate} />
                ))}
            </div>
          </Section>
        ) : null}

        {leads.length > 0 ? (
          <Section
            title="Worth asking about"
            lede="Money a register cannot settle on its own. None of these is counted in the figures above — each turns on one fact about your business, and until it is answered the amount is unknown."
          >
            <div className="space-y-4">
              {leads.map((finding) => (
                <div key={finding.key} className="break-inside-avoid">
                  <p className="text-sm font-medium">{finding.title}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-ink-secondary)]">
                    {finding.summary}
                  </p>
                  {finding.question ? (
                    <p className="mt-1 text-sm">
                      <span className="font-medium">What we need to know:</span> {finding.question}
                    </p>
                  ) : null}
                  {finding.originalCost > 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                      {money(finding.originalCost)} of cost behind the question, across{' '}
                      {count(finding.assetCount)} {plural(finding.assetCount, 'asset')}.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="How these numbers were arrived at">
          <div className="space-y-2 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
            <p>
              {report.schedule
                ? `Every asset was valued on the district’s own published depreciation schedule, ${report.schedule.title}${report.schedule.isFallbackYear ? ' — the closest year they have published' : ''}. `
                : 'Every asset was valued on the district’s own published depreciation schedule. '}
              {report.sic
                ? `Machinery uses the ${report.sic.description} life (${report.sic.machineryLife} years). `
                : 'Machinery uses a ten-year life, as no line of business has been set yet. '}
              Tax is figured at {percent(rate, 2)}, the blended rate for{' '}
              {report.jurisdictionName ?? 'your jurisdiction'} — {report.rateSource.label}.{' '}
              {report.rateSource.detail}
            </p>
            {report.exemption.applied > 0 ? <p>{report.exemption.caveat}</p> : null}
            {/* The estimate's own terms, printed rather than implied. A number
                on a PDF outlives the screen it was read on, and this one is a
                position we intend to argue — not an amount anybody has agreed
                to pay back. */}
            <p>
              These figures are what a corrected return supports on the district’s published
              schedules. They are the position we would argue, not an amount the district has
              agreed to. What a district concedes is settled through the rendition and, where it
              comes to it, the protest that follows the notice.
            </p>
          </div>
        </Section>
      </article>
    </div>
  );
}

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    // `break-inside-avoid` on the whole section is deliberately not set: a
    // findings list longer than a page has to break somewhere, and forbidding
    // it there leaves half a sheet blank. The rows inside avoid breaking, which
    // is the level at which a split is actually unreadable.
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {lede ? <p className="text-sm text-[var(--color-ink-secondary)]">{lede}</p> : null}
      {children}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="break-inside-avoid">
      <dt className="eyebrow">{label}</dt>
      <dd className="tabular mt-0.5 text-lg font-semibold">{value}</dd>
      <dd className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{note}</dd>
    </div>
  );
}

function Finding({ finding, rate }: { finding: SavingsFinding; rate: number }) {
  return (
    <div className="break-inside-avoid border-b border-[var(--color-hairline)] pb-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-sm font-medium">{finding.title}</p>
        <p className="tabular text-sm font-semibold">
          {money((finding.valueRemoved ?? 0) * rate)} a year
        </p>
      </div>
      <p className="mt-0.5 text-sm text-[var(--color-ink-secondary)]">{finding.summary}</p>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {money(finding.valueRemoved ?? 0)} of taxable value, from {count(finding.assetCount)}{' '}
        {plural(finding.assetCount, 'asset')} carrying {money(finding.originalCost)} of cost.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed">
        <span className="font-medium">Basis:</span> {finding.basis}
      </p>
      {/* Printed for the same reason the report refuses to price a question:
          an assumption a reader cannot see is an assumption they cannot
          disagree with, and this is the copy that leaves the building. */}
      {finding.assumption ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          <span className="font-medium">Assumption:</span> {finding.assumption}
        </p>
      ) : null}
    </div>
  );
}
