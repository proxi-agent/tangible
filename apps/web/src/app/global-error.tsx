'use client';

/**
 * The boundary for a throw in the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch the layout
 * failing — a bad font load, a provider that throws on mount, a missing
 * environment variable read at module scope. That case replaces the whole
 * document, which is why this file supplies its own `html` and `body`.
 *
 * It also means the stylesheet is not loaded: `globals.css` is imported by the
 * layout that just failed. Every style here is inline on purpose. This screen
 * should be impossible to reach and legible when it is.
 *
 * Legible in both themes, too. Inline styles cannot carry a media query, so the
 * palette lives in the one `<style>` block below and the elements only name
 * variables — otherwise a reader on a dark machine meets the one failure screen
 * in the app as a full-page flash of white.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <head>
        <style>{PALETTE}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: 'var(--plane)',
          color: 'var(--ink)',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            The application could not start
          </h1>
          <p
            style={{
              fontSize: '0.8rem',
              lineHeight: 1.6,
              color: 'var(--ink-secondary)',
              margin: '0 0 1.25rem',
            }}
          >
            This is the app itself failing to load rather than anything wrong with your data.
            Reloading is worth trying once; if it repeats, the deployment needs looking at.
          </p>
          {/* A link to /season re-entered the same layout that just failed and
              called it a reload. The prose above says reloading is worth trying
              once, so the button does that. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid var(--hairline)',
              background: 'var(--surface)',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              fontFamily: 'inherit',
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ fontSize: '0.7rem', color: 'var(--ink-muted)', marginTop: '1.25rem' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}

/** The two palettes, kept to the handful of roles this page actually paints with. */
const PALETTE = `
  :root {
    color-scheme: light dark;
    --plane: #ffffff;
    --surface: #ffffff;
    --ink: #18181b;
    --ink-secondary: #52525b;
    --ink-muted: #a1a1aa;
    --hairline: #e4e4e7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --plane: #101013;
      --surface: #17171a;
      --ink: #f4f4f5;
      --ink-secondary: #a1a1aa;
      --ink-muted: #71717a;
      --hairline: #2a2a30;
    }
  }
`;
