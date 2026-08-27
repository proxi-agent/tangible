import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Inbox } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { InfoTip } from '@/components/ui/tooltip';

/* ─────────────────────────────────────────────────────────────────────────────
 * Surfaces
 * ────────────────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  /** Inner padding, for a card that holds prose rather than its own sections. */
  padded = false,
  /** Lifts the card off the page — for the one card on a screen that leads. */
  raised = false,
}: {
  className?: string;
  children: ReactNode;
  padded?: boolean;
  raised?: boolean;
}) {
  return (
    <section
      className={cn(
        'card',
        padded && 'px-5 py-4',
        raised && 'shadow-[var(--shadow-raised)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  help,
  action,
  /** Optional leading icon — used where a board carries several unlike cards. */
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  /**
   * The "why" behind the card, tucked behind a help icon beside the title.
   * The description below stays for what the reader needs every visit; this
   * holds the statutory reasoning they need once.
   */
  help?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}) {
  return (
    // Wraps rather than squeezes. Several of these headers carry a whole form
    // in the action slot, and against a half-width card that form wins the
    // width fight — leaving the description in a column four words wide. Below
    // a readable minimum the action drops to its own line instead.
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--color-hairline)] px-5 py-3.5">
      <div className="flex min-w-[15rem] flex-1 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-[var(--color-sunken)] text-[var(--color-ink-secondary)]">
            <Icon size={13} strokeWidth={2} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-1.5 text-base leading-tight font-semibold tracking-[-0.011em]">
            {title}
            {help ? <InfoTip content={help} size={13} /> : null}
          </h2>
          {description ? (
            // Capped to a measure, not to the card. A card on a full-width
            // page gave its description a thousand pixels to run in, which at
            // this size is a hundred and fifty characters a line — long enough
            // that the eye loses the return sweep and re-reads the line it
            // just finished. The cap only ever narrows: a short description
            // never reaches it.
            <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-[var(--color-ink-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/**
 * The way back to the parent, above the title.
 *
 * Beside the title — where every page had been putting it — a back link reads
 * as part of the heading, and the eye has to work out which half is the name of
 * this page and which is the name of the last one. Above it, on its own line,
 * the question never arises.
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        '-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs',
        'text-[var(--color-ink-secondary)] transition-colors outline-none',
        'hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]',
        'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
      )}
    >
      <ArrowLeft size={13} strokeWidth={2} />
      {children}
    </Link>
  );
}

/**
 * A link in a line of text, or at the end of a row.
 *
 * Four files had each written their own version of this — accent, medium
 * weight, underline on hover — and they disagreed about the underline offset
 * and about whether there was a focus ring at all. A row action set in the same
 * ink as the sentence beside it is an action nobody finds.
 *
 * Not for the name in a table cell: those stay ink at rest and warm to the
 * accent on hover, because fifty accent-coloured names down a page is a wall
 * rather than a column you can read.
 */
export function TextLink({
  href,
  children,
  className,
  external,
  scroll,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** Opens in a new tab — for a destination outside the app. */
  external?: boolean;
  /**
   * `false` for a link that only swaps a tab on the page you are already on:
   * the router's default is to jump to the top, which throws away the reader's
   * place on a long screen for a change that happened halfway down it.
   */
  scroll?: boolean;
}) {
  const classes = cn(
    'inline-flex items-center gap-1 font-medium text-[var(--color-accent)] underline-offset-2',
    'outline-none hover:underline',
    'focus-visible:rounded-sm focus-visible:ring-[3px]',
    'focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} scroll={scroll} className={classes}>
      {children}
    </Link>
  );
}

/**
 * The bar at the top of a screen: where you are, and what you can do here.
 *
 * Every page had been assembling this by hand out of a flex row and a heading,
 * which is why no two pages agreed on the title size or the gap beneath it.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  /** A small line above the title — usually the parent this page belongs to. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Chips, pickers, badges that qualify the title without acting on it. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** A "← parent" link, rendered above the title. */
  back?: ReactNode;
  className?: string;
}) {
  return (
    /*
     * Below `sm` the header stacks unconditionally. As a wrapping row it never
     * wrapped: the title block is `flex-1` — basis 0 — so it shrinks to nothing
     * rather than push a `shrink-0` action group onto a second line, and on a
     * phone that turned "Clients" plus a sentence of description into a column
     * one word wide beside a search box. There is no width at which a title and
     * a toolbar both fit across 375px, so they take turns instead.
     */
    <header
      className={cn(
        'flex flex-col gap-y-3',
        'sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-6',
        className,
      )}
    >
      <div className="min-w-0 sm:flex-1">
        {back ? <div className="mb-1.5">{back}</div> : null}
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-[var(--color-ink-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Figures
 *
 * `Stat` replaces eight near-identical local components — `Figure`, `Tile`,
 * `Stat`, `SmallStat` — that had drifted to five different label sizes and
 * three different gaps between label and number. One component, three sizes.
 * ────────────────────────────────────────────────────────────────────────── */

export type StatSize = 'sm' | 'md' | 'lg' | 'xl';
export type StatTone = 'default' | 'accent' | 'good' | 'warning' | 'critical' | 'muted';

const STAT_VALUE: Record<StatSize, string> = {
  sm: 'text-sm font-semibold',
  md: 'text-lg font-semibold',
  lg: 'text-2xl font-semibold',
  xl: 'text-3xl font-semibold',
};

const STAT_TONE: Record<StatTone, string> = {
  default: '',
  accent: 'text-[var(--color-accent)]',
  good: 'text-[var(--color-good)]',
  warning: 'text-[var(--color-warning)]',
  critical: 'text-[var(--color-critical)]',
  muted: 'text-[var(--color-ink-muted)]',
};

export function Stat({
  label,
  value,
  help,
  note,
  size = 'md',
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** What the figure means, for a reader who has never seen a rendition. */
  help?: ReactNode;
  /** A qualifier under the number — what it excludes, or where it is soft. */
  note?: ReactNode;
  size?: StatSize;
  tone?: StatTone;
  className?: string;
}) {
  return (
    // A column with the figure pushed to the bottom. Across a row of tiles the
    // labels are not the same length — "Assets" beside "Total original cost" —
    // and left to flow, a label that wraps drags its number down out of line
    // with its neighbours. Bottom-aligned, the numbers read as one row again.
    <div className={cn('flex h-full min-w-0 flex-col', className)}>
      <div className="eyebrow flex items-start gap-1">
        <span className="line-clamp-2">{label}</span>
        {help ? (
          <InfoTip title={typeof label === 'string' ? label : undefined} content={help} size={12} />
        ) : null}
      </div>
      <div
        // A figure is short; a name, a site or an email is not, and the cell
        // truncates it. The full string stays reachable on hover rather than
        // being lost to the ellipsis.
        title={typeof value === 'string' ? value : undefined}
        className={cn('tabular mt-auto truncate pt-1', STAT_VALUE[size], STAT_TONE[tone])}
      >
        {value}
      </div>
      {note ? (
        <p className="mt-1 text-xs leading-snug tracking-normal text-[var(--color-ink-muted)] normal-case">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A row of figures across the top of a card, divided rather than boxed.
 *
 * The dividers come from a background grid so the tiles keep equal widths and
 * the last one never trails a hanging rule.
 */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const cols: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
  };
  return (
    /*
     * The rules between cells are drawn by the cells, not by a hairline showing
     * through the container's gaps. Five stats in a two-column phone grid leave
     * the sixth position empty, and under the old technique that empty position
     * was a solid grey tile — a broken-looking hole in an otherwise finished
     * card. Painted from the cells, an unfilled position is simply nothing.
     */
    <div className={cn('grid gap-px overflow-hidden', cols[columns], className)}>{children}</div>
  );
}

/** One cell of a `StatGrid` — carries the surface, and the rules around itself. */
export function StatCell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        // The ring reaches 1px in every direction, which is exactly the gap, so
        // neighbours meet in a single line and the outermost ring is clipped
        // away by the container's `overflow-hidden`.
        'bg-[var(--color-surface)] px-5 py-3.5 shadow-[0_0_0_1px_var(--color-hairline)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Labels & annotations
 * ────────────────────────────────────────────────────────────────────────── */

export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'critical' | 'good' | 'serious';

export function Badge({
  children,
  tone = 'neutral',
  /** A leading status dot — for a badge that reports state rather than kind. */
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral:
      'bg-[var(--color-sunken)] text-[var(--color-ink-secondary)] border-[var(--color-hairline)]',
    accent:
      'bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] border-[color-mix(in_oklab,var(--color-accent)_28%,transparent)]',
    warning:
      'bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-[color-mix(in_oklab,var(--color-warning)_32%,transparent)]',
    serious:
      'bg-[var(--color-serious-soft)] text-[var(--color-serious)] border-[color-mix(in_oklab,var(--color-serious)_32%,transparent)]',
    critical:
      'bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[color-mix(in_oklab,var(--color-critical)_32%,transparent)]',
    good: 'bg-[var(--color-good-soft)] text-[var(--color-good)] border-[color-mix(in_oklab,var(--color-good)_32%,transparent)]',
  };

  const dots: Record<BadgeTone, string> = {
    neutral: 'bg-[var(--color-ink-muted)]',
    accent: 'bg-[var(--color-accent)]',
    warning: 'bg-[var(--color-warning)]',
    serious: 'bg-[var(--color-serious)]',
    critical: 'bg-[var(--color-critical)]',
    good: 'bg-[var(--color-good)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-xs font-semibold tracking-normal whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn('size-1.5 shrink-0 rounded-full', dots[tone])} /> : null}
      {children}
    </span>
  );
}

/**
 * A bordered note inside a card — the thing the reader must know before
 * trusting the numbers beside it. Distinct from a Badge, which labels; this
 * explains.
 */
export function Callout({
  tone = 'neutral',
  title,
  children,
  icon: Icon,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'warning' | 'critical' | 'good';
  title?: ReactNode;
  children?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-[var(--color-sunken)] border-[var(--color-hairline)] text-[var(--color-ink)]',
    accent:
      'bg-[var(--color-accent-soft)] border-[color-mix(in_oklab,var(--color-accent)_25%,transparent)]',
    warning:
      'bg-[var(--color-warning-soft)] border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)]',
    critical:
      'bg-[var(--color-critical-soft)] border-[color-mix(in_oklab,var(--color-critical)_28%,transparent)]',
    good: 'bg-[var(--color-good-soft)] border-[color-mix(in_oklab,var(--color-good)_28%,transparent)]',
  };
  const marks = {
    neutral: 'text-[var(--color-ink-muted)]',
    accent: 'text-[var(--color-accent)]',
    warning: 'text-[var(--color-warning)]',
    critical: 'text-[var(--color-critical)]',
    good: 'text-[var(--color-good)]',
  };

  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3.5 py-2.5', tones[tone], className)}>
      {Icon ? (
        <Icon size={15} strokeWidth={2} className={cn('mt-0.5 shrink-0', marks[tone])} />
      ) : null}
      <div className="min-w-0 text-xs leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'mt-0.5', 'text-[var(--color-ink-secondary)]')}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * States
 * ────────────────────────────────────────────────────────────────────────── */

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        'relative overflow-hidden rounded-lg bg-[var(--color-sunken)]',
        // A sweep rather than a pulse: a pulsing block reads as a warning, a
        // sweep reads as work in progress.
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite]',
        'after:bg-gradient-to-r after:from-transparent after:via-[var(--color-hairline)] after:to-transparent',
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-[var(--color-sunken)] text-[var(--color-ink-muted)]">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">{title}</p>
        {children ? (
          <div className="mx-auto max-w-md text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {children}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-[var(--color-critical-soft)] text-[var(--color-critical)]">
        <AlertTriangle size={18} strokeWidth={1.75} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-[var(--color-critical)]">
          Could not load this view
        </p>
        <p className="mx-auto max-w-lg text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          {message}
        </p>
      </div>
      <p className="text-xs tracking-normal text-[var(--color-ink-muted)] normal-case">
        Is the API running?{' '}
        <code className="tabular rounded bg-[var(--color-sunken)] px-1 py-0.5">pnpm dev</code>{' '}
        starts both apps.
      </p>
    </div>
  );
}
