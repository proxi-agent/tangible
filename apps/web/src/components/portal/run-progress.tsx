'use client';

import { RUN_STEPS, RUN_STEP_LABEL, type RunProgress } from '@tangible/types';
import { Card, EmptyState } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/controls';
import { usePortal } from '@/components/portal/portal-context';

/**
 * What a client sees while their report is being made.
 *
 * A blank page during the minutes an analysis takes reads as a product that
 * lost the files they sent. This says which of three things is happening in
 * their words, not the pipeline's — and it deliberately shows no percentage
 * and no estimate, because both would be invented.
 *
 * A failed run says nothing about the failure. The error on the row was written
 * for whoever debugs it, and a taxpayer reading a stack-shaped sentence about
 * their own books learns only that something is wrong with them.
 */
export function RunProgressCard({ run }: { run: RunProgress }) {
  const { href } = usePortal();

  if (run.status === 'failed') {
    return (
      <Card>
        <EmptyState
          title="We hit a problem reading your register"
          action={<LinkButton href={href('/portal/documents')}>Send another file</LinkButton>}
        >
          Nothing you did caused this and nothing you sent was lost. Someone here has been told, and
          will be in touch.
        </EmptyState>
      </Card>
    );
  }

  const current = run.step;
  const reached = current === null ? -1 : RUN_STEPS.indexOf(current);

  return (
    <Card>
      <div className="space-y-4 px-5 py-6">
        <div>
          <h2 className="text-sm font-medium">Your report is being prepared</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            This usually takes a few minutes. You can close this page — we will email you when it is
            ready.
          </p>
        </div>
        <ol className="space-y-2">
          {RUN_STEPS.map((step, index) => {
            const done = index < reached;
            const active = index === reached;
            return (
              <li
                key={step}
                className={`flex items-center gap-2 text-sm ${
                  done || active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)]'
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    done
                      ? 'bg-[var(--color-ink-muted)]'
                      : active
                        ? 'bg-[var(--color-accent)]'
                        : 'bg-[var(--color-hairline)]'
                  }`}
                />
                {RUN_STEP_LABEL[step]}
                {active ? <span className="sr-only"> — in progress</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
