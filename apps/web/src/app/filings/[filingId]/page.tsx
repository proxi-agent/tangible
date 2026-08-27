import { Download } from 'lucide-react';
import type { FormAudience } from '@tangible/filing';
import { buildFiledForm } from '@/lib/filings';
import { buttonClasses } from '@/components/ui/controls';
import { BackLink, Card, CardHeader, Stat, StatCell, StatGrid } from '@/components/ui/primitives';
import { Copy, CopyTrack, FormSheet, Omissions } from '@/components/workspace/form-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METHOD_LABEL: Record<string, string> = {
  'certified-mail': 'certified mail',
  mail: 'regular mail',
  efile: 'e-filed',
  email: 'email',
  'hand-delivered': 'hand delivered',
};

/**
 * A return as it was filed.
 *
 * Nothing on this page reads the register. It is rebuilt from the inputs frozen
 * the day the return went out, so it says the same thing in 2031 that it said
 * when it was signed — which is the entire reason the record exists. A
 * reviewer, an appraiser's letter, or a 22.28 penalty argument all start here.
 *
 * The one honest caveat is printed on the page: if the Comptroller has
 * republished Form 50-144 since, this reproduces the filed *content* on a later
 * sheet. Same numbers, different paper, and the page says so rather than
 * letting a reader assume they are holding a facsimile.
 */
export default async function FiledRenditionPage({
  params,
  searchParams,
}: {
  params: Promise<{ filingId: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const { filingId } = await params;
  const query = await searchParams;
  const audience: FormAudience = query.copy === 'district' ? 'district' : 'file';
  const { form, filing, printed, clientId } = await buildFiledForm(filingId, audience);
  const href = (copy: FormAudience) => `/filings/${filingId}?copy=${copy}`;
  const reprinted = printed.revision !== filing.formRevision;

  return (
    <div className="mx-auto max-w-[850px] pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <BackLink href={`/clients/${clientId}/engagements/${filing.engagementId}/filing`}>
          Back to the draft
        </BackLink>
        <div className="ml-auto flex items-center gap-2">
          {/* Offered only where it can actually be produced. The alternative —
              a link that returns an error document — reads as a broken app on
              the one page whose whole job is to be dependable. */}
          {printed.blocked === null ? (
            // A real `<a>`, not a `LinkButton`: routing a download through the
            // client router loses the browser's own save behaviour.
            <a href={`/api/filings/${filingId}/pdf`} className={buttonClasses('secondary', 'sm')}>
              <Download size={13} strokeWidth={2} />
              Download the filed PDF
            </a>
          ) : (
            <span
              className="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--color-hairline)] px-2.5 text-xs text-[var(--color-ink-muted)]"
              title={printed.blocked}
            >
              No {printed.revision} PDF for {filing.taxYear}
            </span>
          )}
          <CopyTrack label="Which copy of this return">
            <Copy href={href('file')} active={audience === 'file'} label="File copy" />
            <Copy href={href('district')} active={audience === 'district'} label="District copy" />
          </CopyTrack>
        </div>
      </div>

      {filing.status !== 'filed' ? (
        <Omissions
          tone="critical"
          title={
            filing.status === 'void'
              ? 'This record was voided'
              : 'This return was superseded by a later filing'
          }
          items={[
            filing.status === 'void'
              ? `${filing.voidReason ?? 'No reason recorded.'} It is kept because a return that was recorded and withdrawn is a different fact from one that was never recorded.`
              : 'An amendment for this site and tax year was recorded after it. This page still shows what actually went out on the date below, which is what the district worked from until the amendment landed.',
          ]}
        />
      ) : null}

      {printed.blocked !== null ? (
        <Omissions
          tone="warning"
          title={`The ${printed.revision} PDF cannot carry this return`}
          items={[
            `${printed.blocked} Schedule E's year rungs are printed on the sheet, so filling this ` +
              'one would put every cost on the wrong year. Nothing below is affected — this page ' +
              'is rebuilt from the frozen inputs and says exactly what was filed.',
          ]}
        />
      ) : null}

      {reprinted ? (
        <Omissions
          tone="warning"
          title="Reproduced on a later revision of the form"
          items={[
            `This was filed on Form ${filing.formRevision}; the pinned form is now ${printed.revision}. ` +
              'The content below is exactly what was filed — the sheet it is laid out on is not the one that was signed.',
          ]}
        />
      ) : null}

      {/* The receipt. Every fact here is one somebody will be asked to produce
          on its own — "which account", "how did it go", "who signed" — and they
          had been run together into a single middot-separated line where the
          answer has to be picked back out of the sentence. */}
      <Card className="mb-4 print:hidden">
        <CardHeader
          title={`Filed ${filing.filedOn} by ${METHOD_LABEL[filing.method] ?? filing.method}`}
          description={filing.confirmation ? `Confirmation ${filing.confirmation}` : undefined}
        />
        <StatGrid columns={5}>
          <StatCell>
            <Stat size="sm" label="Site" value={filing.locationLabel} />
          </StatCell>
          <StatCell>
            <Stat
              size="sm"
              label="Account"
              value={filing.accountId ?? '—'}
              note={filing.accountId ? undefined : 'No account number'}
            />
          </StatCell>
          <StatCell>
            <Stat size="sm" label="Assets" value={filing.assetCount} />
          </StatCell>
          <StatCell>
            <Stat size="sm" label="Signed as" value={filing.filedByAgent ? 'Agent' : 'The owner'} />
          </StatCell>
          <StatCell>
            <Stat size="sm" label="Recorded by" value={filing.recordedBy ?? '—'} />
          </StatCell>
        </StatGrid>
        {filing.note ? (
          <p className="border-t border-[var(--color-hairline)] px-5 py-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {filing.note}
          </p>
        ) : null}
      </Card>

      <FormSheet
        form={form}
        subtitle={`${form.formRevision} · Tax year ${form.taxYear} · ${form.owner[0]?.value ?? ''} · ${filing.locationLabel} · filed ${filing.filedOn}${audience === 'file' ? ' · file copy' : ''}`}
      />
    </div>
  );
}
