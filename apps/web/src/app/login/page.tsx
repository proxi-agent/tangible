'use client';

import { LogIn } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Field, TextInput } from '@/components/ui/controls';
import { Callout, Card } from '@/components/ui/primitives';
import { authConfigured, getSupabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/**
 * Where to land after signing in, when the session expired mid-task.
 *
 * A session that lapses while a tab sits open sends the practitioner here from
 * wherever they were; landing them back on the client list loses the return
 * they had half-recorded. Only same-origin *paths* are honoured — a `next` of
 * `https://elsewhere.example` or the protocol-relative `//elsewhere.example`
 * would make this login page an open redirect, which is worth exactly as much
 * to a phisher as a stolen password.
 */
function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

function LoginForm() {
  const params = useSearchParams();
  const rejection = params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!authConfigured()) {
    return (
      <Shell>
        <p className="text-sm leading-relaxed text-[var(--color-ink-secondary)]">
          Auth is not configured in this environment, so the app runs open. Set{' '}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
          require sign-in.
        </p>
      </Shell>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await getSupabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }
    // Full navigation, not a router push: the middleware reads the fresh
    // cookies on the next request, and a soft transition would race it.
    window.location.assign(safeNext(params.get('next')) ?? '/clients');
  }

  return (
    <Shell>
      {rejection ? (
        <Callout tone="critical" className="mb-4">
          {rejection === 'noallowlist' ? (
            <>
              This workspace has no <code>AUTH_ALLOWED_EMAILS</code> allowlist, so no account can be
              admitted. Set it to the emails that may use this workspace — the gate holds client
              asset data and fails closed rather than admitting anyone who can sign up.
            </>
          ) : (
            <>
              This account signed in but is not on the allowlist. Add it to{' '}
              <code>AUTH_ALLOWED_EMAILS</code> or use a different account.
            </>
          )}
          <button
            type="button"
            className="ml-2 cursor-pointer font-medium underline"
            onClick={() => void getSupabaseBrowser().auth.signOut()}
          >
            Sign out
          </button>
        </Callout>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field label="Email">
          <TextInput
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="text-xs text-[var(--color-critical)]">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy} className="justify-center">
          <LogIn size={15} strokeWidth={2} />
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
          Accounts are created in the Supabase dashboard (Authentication → Users). This workspace
          holds client data, so there is no self-serve signup.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <Card raised className="w-full max-w-sm p-6">
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-accent)] text-xs font-bold text-[var(--color-on-accent)]">
              T
            </span>
            <span className="text-sm font-semibold tracking-tight">Tangible</span>
          </div>
          {/* The card had a wordmark and no heading, so the page announced the
              product and never said what it was asking for. */}
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Sign in</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}
