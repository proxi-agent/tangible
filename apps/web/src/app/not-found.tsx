import Link from 'next/link';

/**
 * A wrong address, which in this app usually means a stale link: an engagement
 * that was deleted, a client someone bookmarked before a cleanup, or an id
 * pasted a character short. Without this file Next serves its own bare 404
 * outside the app shell, which reads like the deployment is broken rather than
 * like the record is gone.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-[var(--color-ink)]">Nothing at this address</p>
        <p className="mx-auto max-w-lg text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          The page may have been deleted, or the link may be missing a character. Records are never
          removed on their own — if this was a client or an engagement, check the list it belonged
          to.
        </p>
      </div>
      <Link
        href="/season"
        className="cursor-pointer rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)]"
      >
        Back to the season
      </Link>
    </div>
  );
}
