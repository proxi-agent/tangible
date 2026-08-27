import { AlertTriangle, OctagonAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Form50144, FormCheckbox, FormFieldValue, FormScheduleTable } from '@tangible/filing';
import { cn } from '@/lib/cn';
import { Callout } from '@/components/ui/primitives';

/**
 * Form 50-144 as a sheet of paper.
 *
 * Deliberately dull: it is meant to be printed, checked line by line against
 * the register, and signed. It is a component rather than part of the draft
 * screen because the same document is rendered twice from two very different
 * sources — once from the live register as a draft, and once from the frozen
 * inputs of a return that was already filed. A filed return that laid out
 * differently from the draft it came from would be unreviewable, and two copies
 * of this markup would drift within a season.
 */
export function FormSheet({
  form,
  subtitle,
}: {
  form: Form50144;
  /** Whose form, which return, which copy — the line under the form name. */
  subtitle: string;
}) {
  return (
    <article className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-8 print:rounded-none print:border-0 print:p-0">
      <header className="border-b-2 border-[var(--color-ink)] pb-3">
        <h1 className="text-base leading-snug font-semibold">{form.formName}</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{subtitle}</p>
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
        <p className="text-xs leading-relaxed">{form.signature.affirmation}</p>
        <dl className="mt-4 grid grid-cols-[190px_1fr] gap-x-4 gap-y-2 text-xs">
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
        <p className="mt-6 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          {form.signature.penaltyNotice}
        </p>
      </Section>
    </article>
  );
}

/**
 * The track the copy and site switchers sit in.
 *
 * Both form screens had inlined this as a bare bordered row — no fill behind
 * the choices, so the switcher read as two loose links rather than as one
 * control with a current position. It is the same shape as `Segmented`, which
 * is what it is: a segmented control whose options happen to be URLs.
 */
export function CopyTrack({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--color-hairline)] bg-[var(--color-sunken)] p-0.5"
    >
      {children}
    </div>
  );
}

export function Copy({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center justify-center rounded-[calc(var(--radius-control)-2px)] px-2.5',
        'text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]',
        'focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
        active
          ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]'
          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
      )}
    >
      {label}
    </Link>
  );
}

export function Omissions({
  tone,
  title,
  items,
}: {
  tone: 'critical' | 'warning';
  title: string;
  items: string[];
}) {
  // The same callout the rest of the app uses for the same thing. It had been
  // a second implementation with its own colour arithmetic, which drifted: a
  // blocking omission on this screen was tinted differently from a blocking
  // one on the draft screen it came from.
  return (
    <Callout
      tone={tone}
      title={title}
      icon={tone === 'critical' ? OctagonAlert : AlertTriangle}
      className="mb-4 print:hidden"
    >
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-[var(--color-ink-muted)]">
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="text-2xs mb-2.5 font-semibold tracking-[0.08em] text-[var(--color-ink-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fields({ fields }: { fields: FormFieldValue[] }) {
  return (
    <dl className="grid grid-cols-[190px_1fr] gap-x-4 gap-y-2 text-xs">
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
          <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">{note}</span>
        ) : null}
      </dd>
    </>
  );
}

function Boxes({ boxes }: { boxes: FormCheckbox[] }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {boxes.map((box) => (
        <li key={box.label} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[2px] grid h-[15px] w-[15px] shrink-0 place-items-center border border-[var(--color-ink)] text-xs leading-none"
          >
            {box.checked ? '✕' : ''}
          </span>
          <span className={box.checked ? 'font-medium' : 'text-[var(--color-ink-muted)]'}>
            {box.label}
            {box.basis ? (
              <span className="mt-0.5 block text-xs font-normal text-[var(--color-ink-muted)]">
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
      <h2 className="text-xs font-semibold">{schedule.title}</h2>
      <p className="mt-0.5 mb-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        {schedule.instruction}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-2xs border-y border-[var(--color-hairline)] text-left tracking-wide text-[var(--color-ink-muted)] uppercase">
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
        <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
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
      <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}
