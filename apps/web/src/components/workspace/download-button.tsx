'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/controls';

/**
 * A file download that says so when it fails.
 *
 * The obvious markup — `<a href="/api/…/export" download>` — has one bad
 * property: `download` tells the browser to save whatever comes back without
 * looking at the status. A 500 does not surface as an error, it surfaces as a
 * file on the desktop named `export` containing a line of JSON. The
 * practitioner reports that the export is corrupt; nothing anywhere says which
 * engagement failed or why.
 *
 * So fetch it, check the status, and only then hand the bytes to the browser as
 * a blob. The filename comes from the server's `content-disposition`, which is
 * where it was already being set.
 */
export function DownloadButton({
  href,
  children,
  busyLabel = 'Preparing…',
}: {
  href: string;
  children: React.ReactNode;
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.text();
        setError(messageFrom(body) ?? `The download failed (${response.status}).`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFrom(response.headers.get('content-disposition')) ?? '';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can beat the browser to the bytes in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('The download could not be reached. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button onClick={() => void download()} disabled={busy}>
        {busy ? busyLabel : children}
      </Button>
      {error ? (
        <span className="max-w-[22rem] text-right text-xs leading-snug text-[var(--color-critical)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** The API's error envelope is `{ statusCode, message }`; a platform page is HTML. */
function messageFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return null;
  }
}

function filenameFrom(header: string | null): string | null {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? null;
}
