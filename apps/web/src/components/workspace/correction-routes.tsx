'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CorrectionOutlook, CorrectionRoute } from '@tangible/types';
import { cn } from '@/lib/cn';
import { day, plural } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';

/**
 * What 25.25 leaves after Chapter 41 has run out.
 *
 * Collapsed, because it is not the day's work — but it is the answer to the
 * question every new client asks first, which is whether anything can be done
 * about the years already gone, and a firm that does not know the answer sells
 * one protest a year instead of an audit.
 *
 * It appears only once protesting has stopped being an option, and the routes
 * are listed cheapest first. 25.25(d) is last on purpose: it carries a 10%
 * late-correction penalty, so a firm that reaches for it while (c) or (c-1) is
 * open has paid for nothing.
 *
 * The heading is the caller's, because this reads in two places with two
 * different subjects: on a notice it is one more thing about *this* notice, and
 * on the open-years board it is one row among the client's history, where the
 * year is the thing that identifies it.
 */
export function CorrectionRoutes({
  outlook,
  heading,
}: {
  outlook: CorrectionOutlook;
  heading?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const left = outlook.routes.filter((route) => route.open).length;
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex w-full cursor-pointer items-baseline gap-2.5 text-left text-xs"
      >
        <Badge tone={outlook.open ? 'accent' : 'neutral'}>
          {left === 0 ? 'nothing left' : `${left} ${plural(left, 'route')} left`}
        </Badge>
        <span className="font-medium">{heading ?? 'After the protest window'}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 self-center text-[var(--color-ink-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {outlook.standing}
      </p>

      {open ? (
        <ul className="space-y-2 border-t border-[var(--color-hairline)] pt-2">
          {outlook.routes.map((route) => (
            <Route key={route.key} route={route} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Route({ route }: { route: CorrectionRoute }) {
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <Badge tone={route.open ? 'good' : 'neutral'}>{route.cite}</Badge>
        <span className={route.open ? 'font-medium' : 'text-[var(--color-ink-muted)]'}>
          {route.label}
        </span>
        {/* The year, not just the day: these three deadlines sit in three
            different years, and "by Dec 31" on two of them would read as the
            same date. */}
        {route.deadline ? (
          <span
            className={
              route.open
                ? 'tabular ml-auto font-medium text-[var(--color-ink-secondary)]'
                : 'tabular ml-auto text-[var(--color-ink-muted)] line-through'
            }
          >
            by {day(route.deadline)}
          </span>
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {route.grounds}
      </p>
      {route.barred ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-muted)]">{route.barred}</p>
      ) : null}
      {route.open && route.cost ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-warning)]">{route.cost}</p>
      ) : null}
    </li>
  );
}
