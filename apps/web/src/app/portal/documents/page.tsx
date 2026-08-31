'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Inbox, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import type { IntakeFile } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { day } from '@/lib/format';
import { usePortal } from '@/components/portal/portal-context';
import { PortalHeader } from '@/components/portal/portal-header';
import { ReadOnlyNote } from '@/components/portal/read-only';
import { LinkButton } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';

/**
 * The drop zone, from the sending end.
 *
 * The firm's version of this screen is a triage queue: every file carries a
 * proposed route and a control to confirm it. None of that belongs here. A
 * business does not know whether their PDF is a rendition or a notice, and
 * asking them to say would put a guess into the record that the pipeline then
 * treats as a fact. So the client sends, and sees only that it arrived and
 * that somebody has looked at it.
 */
export default function PortalDocumentsPage() {
  const { engagementId, canAct, href } = usePortal();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // What the last send contained, so the confirmation can name it. Cleared the
  // moment another send starts — a receipt for files that are still uploading
  // is a lie the reader has no way to catch.
  const [sent, setSent] = useState<string[] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-intake', engagementId],
    queryFn: () => api.intakeFiles(engagementId!),
    enabled: Boolean(engagementId),
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      setSent(null);
      return api.uploadIntake(engagementId!, files).then((result) => {
        setSent(files.map((file) => file.name));
        return result;
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement-intake', engagementId] });
    },
  });

  if (!engagementId) {
    return (
      <>
        <PortalHeader title="Documents" />
        <Card>
          <EmptyState title="No season open yet">
            There is nowhere to file documents until a tax year is underway.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PortalHeader
        title="Documents"
        description="Drop in your fixed asset register and any prior-year tax documents — all at once, in whatever shape they are in. Sorting them out is our job."
      />

      <Card>
        <CardHeader
          title="Send files"
          description="Fixed asset registers, depreciation schedules, last year's rendition, appraisal notices, invoices for anything you bought."
          help="Files go to private storage. Only your account team can open them."
          icon={Inbox}
        />
        {/* A register is a tax position before anybody reads it: what is sent
          here is what the return gets filed from. A read-only viewer sees the
          history below and no way to add to it. */}
        {!canAct ? (
          <div className="px-5 py-4">
            <ReadOnlyNote what="Sending files" />
          </div>
        ) : (
          <div className="px-5 py-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) upload.mutate(files);
              }}
              className={cn(
                'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-10 text-sm transition-colors outline-none',
                'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
                dragging
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)]'
                  : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-accent)_45%,transparent)] hover:bg-[var(--color-plane)]',
              )}
            >
              <Inbox size={22} strokeWidth={1.7} className="text-[var(--color-ink-muted)]" />
              <span className="font-medium">
                {upload.isPending ? 'Uploading…' : 'Drop files here, or click to choose'}
              </span>
              <span className="text-xs text-[var(--color-ink-secondary)]">
                Excel, CSV, PDF or images — several at a time is fine
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) upload.mutate(files);
                e.target.value = '';
              }}
            />
            {sent && sent.length > 0 ? (
              <Callout
                tone="good"
                className="mt-3"
                icon={CheckCircle2}
                title={`Submitted successfully — ${sent.length} file${sent.length === 1 ? '' : 's'} received`}
              >
                <p>
                  We will read {sent.length === 1 ? 'it' : 'them'} and email you when your report is
                  ready. Nothing else is needed from you right now.
                </p>
                <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">
                  {sent.join(', ')}
                </p>
                <div className="mt-2">
                  <LinkButton href={href('/portal')}>See your report</LinkButton>
                </div>
              </Callout>
            ) : null}
            {upload.error ? (
              <p className="mt-3 text-xs text-[var(--color-critical)]">
                {upload.error instanceof Error ? upload.error.message : 'Upload failed.'}
              </p>
            ) : null}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
              <ShieldCheck size={13} strokeWidth={2} />
              Stored privately and used only for your filing.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="What you have sent" description="Newest first." />
        {error ? (
          <ErrorState error={error} />
        ) : isLoading || !data ? (
          <div className="px-5 py-5">
            <Skeleton className="h-20 w-full" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="Nothing sent yet" icon={FileText}>
            Start with a fixed asset register — an export from your accounting system listing what
            you own, what it cost, and the year you bought it.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {[...data.items]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <FileText
                    size={15}
                    strokeWidth={2}
                    className="shrink-0 text-[var(--color-ink-muted)]"
                  />
                  <div className="min-w-[12rem] flex-1">
                    <p className="truncate text-sm font-medium">{item.originalFilename}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      Sent {day(item.createdAt.slice(0, 10))} · {sizeLabel(item.byteSize)}
                    </p>
                  </div>
                  <IntakeBadge item={item} />
                </li>
              ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * Intake status in the sender's terms.
 *
 * `dismissed` is the interesting one. Internally it means a person decided the
 * file belongs to no pipeline — a signature page, a duplicate, a photo. To the
 * sender that is not a rejection and should not read as one: the file arrived,
 * somebody looked at it, and nothing about the filing turns on it.
 */
function IntakeBadge({ item }: { item: IntakeFile }) {
  if (item.status === 'failed') {
    return (
      <Badge tone="critical" dot>
        Could not open — please resend
      </Badge>
    );
  }
  if (item.status === 'routed') {
    return (
      <Badge tone="good" dot>
        Accepted
      </Badge>
    );
  }
  if (item.status === 'dismissed') {
    return <Badge tone="neutral">Not needed for the filing</Badge>;
  }
  return (
    <Badge tone="accent" dot>
      Received — being reviewed
    </Badge>
  );
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
