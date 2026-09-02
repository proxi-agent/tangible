import { Download } from 'lucide-react';
import type { FormAudience } from '@tangible/filing';
import type { EngagementReturns, RenditionBasis } from '@tangible/types';
import { buildEngagementForm } from '@/lib/rendition';
import { buttonClasses } from '@/components/ui/controls';
import { BackLink } from '@/components/ui/primitives';
import { Copy, CopyTrack, FormSheet, Omissions } from '@/components/workspace/form-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The rendition as a document, laid out the way Form 50-144 asks for it.
 *
 * The draft screen answers "what is on the return and what still needs
 * deciding". This answers a narrower question — what does the paper say — and
 * it is deliberately dull to look at, because it is meant to be printed,
 * checked line by line against the register, and signed.
 *
 * Two copies come off the same build. The district copy is the filing. The file
 * copy adds our own schedule arithmetic and the decision log behind the
 * numbers: useful to a reviewer, and nothing the appraiser asked for.
 */
export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; engagementId: string }>;
  searchParams: Promise<{
    basis?: string;
    agent?: string;
    certify?: string;
    copy?: string;
    location?: string;
  }>;
}) {
  const { clientId, engagementId } = await params;
  const query = await searchParams;
  const basis: RenditionBasis = query.basis === 'estimate' ? 'estimate' : 'cost';
  const audience: FormAudience = query.copy === 'district' ? 'district' : 'file';
  const filedByAgent = query.agent !== 'false';
  // Absent means the builder's own election, the same as the draft page.
  const certify = query.certify === undefined ? undefined : query.certify === 'true';
  const { form, clientName, printed, target, owed } = await buildEngagementForm(engagementId, {
    basis,
    filedByAgent,
    certify,
    audience,
    locationId: query.location ?? null,
  });

  const blocking = form.omissions.filter((o) => o.severity === 'blocking');
  const warnings = form.omissions.filter((o) => o.severity === 'warning');
  // Every link off this page carries the whole question with it. Dropping the
  // basis, the agent flag or the site would silently show a different form
  // under the same heading, which on a page meant to be printed and signed is
  // the one mistake worth the extra characters.
  const search = (overrides: { copy?: FormAudience; location?: string | null }) => {
    const copy = overrides.copy ?? audience;
    const location = 'location' in overrides ? overrides.location : (target?.locationId ?? null);
    return (
      `?basis=${basis}&agent=${filedByAgent}&copy=${copy}` +
      (certify === undefined ? '' : `&certify=${certify}`) +
      (location ? `&location=${encodeURIComponent(location)}` : '')
    );
  };
  const href = (copy: FormAudience) =>
    `/clients/${clientId}/engagements/${engagementId}/filing/form${search({ copy })}`;
  const multi = owed.returns.length > 1;

  return (
    <div className="mx-auto max-w-[850px] pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <BackLink href={`/clients/${clientId}/engagements/${engagementId}/filing`}>
          Back to the draft
        </BackLink>
        {multi ? (
          <CopyTrack label="Which site's return">
            {owed.returns.map((entry) => (
              <Copy
                key={entry.locationId}
                href={`/clients/${clientId}/engagements/${engagementId}/filing/form${search({ location: entry.locationId })}`}
                active={target?.locationId === entry.locationId}
                label={entry.label}
              />
            ))}
          </CopyTrack>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {printed.blocked === null ? (
            // A real `<a>`, not a `LinkButton`: routing a download through the
            // client router loses the browser's own save behaviour.
            <a
              href={
                `/api/engagements/${engagementId}/rendition/pdf?basis=${basis}&filedByAgent=${filedByAgent}` +
                (certify === undefined ? '' : `&certify=${certify}`) +
                (target ? `&location=${encodeURIComponent(target.locationId)}` : '')
              }
              className={buttonClasses('secondary', 'sm')}
            >
              <Download size={13} strokeWidth={2} />
              Download Form 50-144
            </a>
          ) : (
            <span
              className="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--color-hairline)] px-2.5 text-xs text-[var(--color-ink-muted)]"
              title={printed.blocked}
            >
              No {printed.revision} PDF for {form.taxYear}
            </span>
          )}
          <CopyTrack label="Which copy of this return">
            <Copy href={href('file')} active={audience === 'file'} label="File copy" />
            <Copy href={href('district')} active={audience === 'district'} label="District copy" />
          </CopyTrack>
        </div>
      </div>

      {blocking.length > 0 ? (
        <Omissions
          tone="critical"
          title={`${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} this form cannot be signed without`}
          items={blocking.map((o) => `${o.field} — ${o.missing}`)}
        />
      ) : null}
      {warnings.length > 0 ? (
        <Omissions
          tone="warning"
          title="Worth settling before it goes out"
          items={warnings.map((o) => `${o.field} — ${o.missing}`)}
        />
      ) : null}
      {printed.blocked !== null ? (
        <Omissions
          tone="critical"
          title={`The ${printed.revision} PDF cannot carry this rendition`}
          items={[
            `${printed.blocked} The Schedule E rungs are printed on the page, so every cost would ` +
              'land on the wrong year. This screen is still correct; the download is not available ' +
              'until the revision for that tax year is pinned.',
          ]}
        />
      ) : null}
      {printed.overflow.length > 0 ? (
        <Omissions
          tone="warning"
          title="What the printed form has no box for"
          items={printed.overflow.map(
            (o) =>
              `${o.schedule} — ${o.reason} (${o.assetCount} ${o.assetCount === 1 ? 'asset' : 'assets'}, $${Math.round(o.historicalCost).toLocaleString('en-US')})`,
          )}
        />
      ) : null}

      <FormSheet
        form={form}
        subtitle={`${form.formRevision} · Tax year ${form.taxYear} · ${clientName}${
          multi && target
            ? ` · ${target.label}, return ${returnOrdinal(owed, target.locationId)}`
            : ''
        }${audience === 'file' ? ' · file copy, not for filing' : ''}`}
      />
    </div>
  );
}

/**
 * "return 2 of 3" on the face of the paper.
 *
 * A multi-site filing is several forms that look almost identical, and an
 * appraiser holding one of them has no way to know the others exist. Numbering
 * them says so — and says how many should have arrived.
 */
function returnOrdinal(owed: EngagementReturns, locationId: string): string {
  const index = owed.returns.findIndex((r) => r.locationId === locationId);
  return `${index + 1} of ${owed.returns.length}`;
}
