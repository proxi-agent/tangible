'use client';

import { KeyRound, LogIn, MailCheck, Send } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { safeNext } from '@/lib/auth-session';
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
 * Two ways in, for two audiences.
 *
 * **A mailed link is the primary one**, because it is the only one a client
 * has. A business admitted by a `portal_users` grant never chose a password and
 * has no screen on which to choose one; before this the whole portal wing was
 * unreachable from outside the firm, and the invitation mail arrived at a form
 * that could only ask for something the recipient did not have.
 *
 * **A password is kept underneath it**, and not as a nicety. Magic links go out
 * over Supabase's own mailer, which is rate-limited and is the thing most
 * likely to be misconfigured on a fresh project. Making it the only way in
 * would mean one piece of mail configuration standing between the firm and its
 * own workspace during a filing season. The password path needs no mail at all,
 * so it is the floor under the feature — folded away, because it is the answer
 * for a handful of people rather than for the reader this page mostly gets.
 */
function LoginForm() {
  const params = useSearchParams();
  const rejection = params.get('error');
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
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

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    /**
     * The origin is read off the browser rather than from `NEXT_PUBLIC_APP_URL`
     * on purpose: this is the one link in the product that is guaranteed to
     * come back to the deployment the person is actually looking at. A preview
     * that mailed a link into production would sign them in somewhere else.
     */
    const redirect = new URL('/auth/callback', window.location.origin);
    if (next) redirect.searchParams.set('next', next);

    const { error: sendError } = await getSupabaseBrowser().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirect.toString(),
        /**
         * A grant is the durable half of portal access — `portal_users` is what
         * confers reach, and the invitation that creates the Supabase account
         * is swallowed on failure by design. Refusing to create the account
         * here would mean a client whose invitation bounced could never sign
         * in, and nobody would know why.
         *
         * Creating one confers nothing. `audienceFor` admits an address on the
         * firm allowlist or holding a grant, and answers `none` for everything
         * else — an account made this way by a stranger reaches a login page
         * with a sign-out button and not one row of anybody's data.
         */
        shouldCreateUser: true,
      },
    });
    if (sendError) {
      setError(sendError.message);
      setBusy(false);
      return;
    }
    setSent(email);
    setBusy(false);
  }

  async function submitPassword(event: React.FormEvent) {
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
    window.location.assign(next ?? '/clients');
  }

  if (sent) {
    return (
      <Shell>
        <Callout tone="good" icon={MailCheck} title="Check your email">
          <p>
            We sent a sign-in link to <span className="font-medium">{sent}</span>. Open it on this
            device and you will land straight in your account.
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            The link works once and expires. If it does not arrive in a few minutes, check the spam
            folder or ask for another.
          </p>
        </Callout>
        <button
          type="button"
          className="mt-4 cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] underline hover:text-[var(--color-ink)]"
          onClick={() => {
            setSent(null);
            setError(null);
          }}
        >
          Use a different address
        </button>
      </Shell>
    );
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
          ) : rejection === 'link' ? (
            // Its own case because it is the ordinary one, not a fault: a magic
            // link is single-use and expires, so the second click on the same
            // mail lands here. Telling this reader about an allowlist they have
            // never heard of would send them to the firm for a problem they can
            // solve themselves in one click.
            <>That sign-in link has expired or was already used. Ask for a fresh one below.</>
          ) : (
            <>
              This account signed in but has not been given access to anything here. Ask us to add
              you, or use a different address.
              <button
                type="button"
                className="ml-2 cursor-pointer font-medium underline"
                onClick={() => void getSupabaseBrowser().auth.signOut()}
              >
                Sign out
              </button>
            </>
          )}
        </Callout>
      ) : null}

      <form
        onSubmit={(event) => void (usePassword ? submitPassword(event) : sendLink(event))}
        className="flex flex-col gap-4"
      >
        <Field label="Email">
          <TextInput
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        {usePassword ? (
          <Field label="Password">
            <TextInput
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : null}

        {error ? <p className="text-xs text-[var(--color-critical)]">{error}</p> : null}

        <Button variant="primary" type="submit" disabled={busy} className="justify-center">
          {usePassword ? <LogIn size={15} strokeWidth={2} /> : <Send size={15} strokeWidth={2} />}
          {busy
            ? usePassword
              ? 'Signing in…'
              : 'Sending…'
            : usePassword
              ? 'Sign in'
              : 'Email me a sign-in link'}
        </Button>

        <button
          type="button"
          onClick={() => {
            setUsePassword((on) => !on);
            setError(null);
          }}
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 text-xs font-medium text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          <KeyRound size={12} strokeWidth={2} />
          {usePassword ? 'Email me a link instead' : 'Use a password instead'}
        </button>

        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
          There is no self-serve signup — this holds client asset data. A business reaches its own
          report once we grant it access; everyone at the firm is admitted by the workspace
          allowlist.
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
