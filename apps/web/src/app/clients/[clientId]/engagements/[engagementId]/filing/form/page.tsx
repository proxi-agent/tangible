import Link from 'next/link';
import type {
  FormAudience,
  FormCheckbox,
  FormFieldValue,
  FormScheduleTable,
} from '@tangible/filing';
import type { EngagementReturns, RenditionBasis } from '@tangible/types';
import { buildEngagementForm } from '@/lib/rendition';

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
  searchParams: Promise<{ basis?: string; agent?: string; copy?: string; location?: string }>;
}) {
  const { clientId, engagementId } = await params;
  const query = await searchParams;
  const basis: RenditionBasis = query.basis === 'estimate' ? 'estimate' : 'cost';
  const audience: FormAudience = query.copy === 'district' ? 'district' : 'file';
  const filedByAgent = query.agent !== 'false';
  const { form, clientName, printed, target, owed } = await buildEngagementForm(engagementId, {
    basis,
    filedByAgent,
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
      (location ? `&location=${encodeURIComponent(location)}` : '')
    );
  };
  const href = (copy: FormAudience) =>
    `/clients/${clientId}/engagements/${engagementId}/filing/form${search({ copy })}`;
  const multi = owed.returns.length > 1;

  return (
    <div className="mx-auto max-w-[850px] pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href={`/clients/${clientId}/engagements/${engagementId}/filing`}
          className="text-sm text-[var(--color-ink-muted)] underline-offset-4 hover:underline"
        >
          ← Back to the draft
        </Link>
        {multi ? (
          <div className="flex items-center gap-1 rounded-md border border-[var(--color-hairline)] p-0.5 text-[13px]">
            {owed.returns.map((entry) => (
              <Copy
                key={entry.locationId}
                href={`/clients/${clientId}/engagements/${engagementId}/filing/form${search({ location: entry.locationId })}`}
                active={target?.locationId === entry.locationId}
                label={entry.label}
              />
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {printed.blocked === null ? (
            <a
              href={
                `/api/engagements/${engagementId}/rendition/pdf?basis=${basis}&filedByAgent=${filedByAgent}` +
                (target ? `&location=${encodeURIComponent(target.locationId)}` : '')
              }
              className="rounded-md border border-[var(--color-hairline)] px-2.5 py-1.5 text-[13px] hover:bg-[var(--color-surface-raised)]"
            >
              Download Form 50-144
            </a>
          ) : (
            <span
              className="rounded-md border border-[var(--color-hairline)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink-muted)]"
              title={printed.blocked}
            >
              No {printed.revision} PDF for {form.taxYear}
            </span>
          )}
          <div className="flex items-center gap-1 rounded-md border border-[var(--color-hairline)] p-0.5 text-[13px]">
            <Copy href={href('file')} active={audience === 'file'} label="File copy" />
            <Copy href={href('district')} active={audience === 'district'} label="District copy" />
          </div>
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

      <article className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-8 print:rounded-none print:border-0 print:p-0">
        <header className="border-b-2 border-[var(--color-ink)] pb-3">
          <h1 className="text-[15px] leading-snug font-semibold">{form.formName}</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {form.formRevision} · Tax year {form.taxYear} · {clientName}
            {multi && target
              ? ` · ${target.label}, return ${returnOrdinal(owed, target.locationId)}`
              : ''}
            {audience === 'file' ? ' · file copy, not for filing' : ''}
          </p>
        </header>

        <Section title="Property owner">
          <Fields fields={form.owner} />
        </Section>
        <Section title="Property being rendered">
          <Fields fields={form.property} />
        </Section>
        <Section title="Who is making this statement">
          <Boxes boxes={form.representation} />
        </Section>
        <Section title="How this rendition is filed">
          <Boxes boxes={form.affirmations} />
        </Section>

        {form.schedules.map((schedule) => (
          <Schedule key={schedule.key} schedule={schedule} />
        ))}

        <Section title="Totals">
          <Fields fields={form.totals} />
        </Section>

        {form.decisions.length > 0 ? (
          <Section title="Decisions behind these figures (file copy only)">
            <Fields fields={form.decisions} />
          </Section>
        ) : null}

        <Section title="Signature">
          <p className="text-[13px] leading-relaxed">{form.signature.affirmation}</p>
          <dl className="mt-4 grid grid-cols-[190px_1fr] gap-x-4 gap-y-2 text-[13px]">
            <Row label="Signed by" value={form.signature.signerName || null} />
            <Row label="Capacity" value={form.signature.capacityLabel} />
            <Row
              label="Notarization"
              value={form.signature.notarization.required ? 'Required' : 'Not required'}
              note={form.signature.notarization.reason}
            />
          </dl>
          <div className="mt-8 grid grid-cols-[1fr_160px] gap-6">
            <Rule label="Signature" />
            <Rule label="Date" />
          </div>
          <p className="mt-6 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            {form.signature.penaltyNotice}
          </p>
        </Section>
      </article>
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

function Copy({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded bg-[var(--color-ink)] px-2.5 py-1 font-medium text-[var(--color-surface)]'
          : 'rounded px-2.5 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }
    >
      {label}
    </Link>
  );
}

function Omissions({
  tone,
  title,
  items,
}: {
  tone: 'critical' | 'warning';
  title: string;
  items: string[];
}) {
  const color = tone === 'critical' ? 'var(--color-critical)' : 'var(--color-warning)';
  return (
    <div
      className="mb-4 rounded-md border p-4 print:hidden"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 8%, transparent)`,
      }}
    >
      <p className="text-[13px] font-semibold">{title}</p>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" style={{ color }}>
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-ink-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fields({ fields }: { fields: FormFieldValue[] }) {
  return (
    <dl className="grid grid-cols-[190px_1fr] gap-x-4 gap-y-2 text-[13px]">
      {fields.map((field) => (
        <Row key={field.label} label={field.label} value={field.value} note={field.note} />
      ))}
    </dl>
  );
}

function Row({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <>
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd>
        {value === null ? (
          // Never a silent blank. An empty box on a signed form reads as "none".
          <span className="text-[var(--color-critical)]">not supplied</span>
        ) : (
          <span className="whitespace-pre-line">{value}</span>
        )}
        {note ? (
          <span className="mt-0.5 block text-[12px] text-[var(--color-ink-muted)]">{note}</span>
        ) : null}
      </dd>
    </>
  );
}

function Boxes({ boxes }: { boxes: FormCheckbox[] }) {
  return (
    <ul className="space-y-1.5 text-[13px]">
      {boxes.map((box) => (
        <li key={box.label} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[2px] grid h-[15px] w-[15px] shrink-0 place-items-center border border-[var(--color-ink)] text-[11px] leading-none"
          >
            {box.checked ? '✕' : ''}
          </span>
          <span className={box.checked ? 'font-medium' : 'text-[var(--color-ink-muted)]'}>
            {box.label}
            {box.basis ? (
              <span className="mt-0.5 block text-[12px] font-normal text-[var(--color-ink-muted)]">
                {box.basis}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Schedule({ schedule }: { schedule: FormScheduleTable }) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="text-[13px] font-semibold">{schedule.title}</h2>
      <p className="mt-0.5 mb-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
        {schedule.instruction}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-y border-[var(--color-hairline)] text-left text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
              <th className="py-1.5 pr-3 font-medium">Type</th>
              <th className="py-1.5 pr-3 font-medium">Year</th>
              <th className="py-1.5 pr-3 text-right font-medium">Historical cost</th>
              <th className="py-1.5 text-right font-medium">Good faith estimate</th>
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row, i) => (
              <tr
                key={`${row.type}-${row.yearAcquired}-${i}`}
                className="border-b border-[var(--color-hairline)]"
              >
                <td className="py-1.5 pr-3">{row.type}</td>
                <td className="py-1.5 pr-3">{row.yearAcquired}</td>
                <td className="py-1.5 pr-3 text-right">{row.historicalCost}</td>
                <td
                  className={
                    row.goodFaithEstimate === 'withheld'
                      ? 'py-1.5 text-right text-[var(--color-warning)]'
                      : 'py-1.5 text-right'
                  }
                >
                  {row.goodFaithEstimate}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3" colSpan={2}>
                Total
              </td>
              <td className="py-1.5 pr-3 text-right">{schedule.totalCost}</td>
              <td className="py-1.5 text-right">{schedule.totalEstimate}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {schedule.continuationRows > 0 ? (
        <p className="mt-1.5 text-[12px] text-[var(--color-ink-muted)]">
          The printed table on the form holds {schedule.rows.length - schedule.continuationRows} of
          these lines. The remaining {schedule.continuationRows} are filed as an attached
          continuation to this schedule; the total above covers every line either way.
        </p>
      ) : null}
    </section>
  );
}

function Rule({ label }: { label: string }) {
  return (
    <div>
      <div className="h-8 border-b border-[var(--color-ink)]" />
      <span className="mt-1 block text-[11px] text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}
