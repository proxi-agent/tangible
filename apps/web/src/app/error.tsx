'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

/**
 * The last thing between a render-time throw and Next's default error page.
 *
 * Without this file a component that throws while rendering takes the whole
 * route down to an unstyled "Application error: a client-side exception has
 * occurred" with no way back — the deployed build strips the message, so the
 * practitioner sees a blank page and the reason lives only in the logs. This
 * keeps the app's shell, says what happened, and offers the two ways out that
 * actually work: try the render again, or go back to the board.
 *
 * Deliberately self-contained. An error boundary that imports the component
 * tree it is catching for can fail the same way the page did, and then there
 * is nothing left to render.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[render]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-[var(--color-critical-soft)] text-[var(--color-critical)]">
        <AlertTriangle size={18} strokeWidth={1.75} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-[var(--color-critical)]">
          This screen did not load
        </p>
        <p className="mx-auto max-w-lg text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          Nothing you were working on was lost — this is the screen failing to draw, not a change
          failing to save.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="cursor-pointer rounded-md bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-plane)]"
        >
          Try again
        </button>
        <a
          href="/season"
          className="cursor-pointer rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)]"
        >
          Back to the season
        </a>
      </div>
      {/* The digest is the only handle on the server-side log entry for this throw. */}
      {error.digest ? (
        <p className="text-xs text-[var(--color-ink-muted)]">Reference {error.digest}</p>
      ) : null}
    </div>
  );
}
