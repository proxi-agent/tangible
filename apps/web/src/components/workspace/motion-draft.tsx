'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CorrectionRouteKey, MotionDraftRecord, OpenYear } from '@tangible/types';
import { api } from '@/lib/api';
import { dayShort, moneyExact } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';

/**
 * The step between "this route is open" and "we filed on this date".
 *
 * The routes above say what 25.25 leaves; the recorder below writes down a
 * motion after it went in. Drafting the document itself was the manual step in
 * the middle, and the one with the arithmetic in it. The form asks for the two
 * facts the record cannot supply — the value the firm claims is correct and
 * what is wrong in the firm's words — because they are assertions, and they
 * are the same two fields the recorder stores once the motion is filed.
 *
 * The draft argues from the outlook as the server recomputes it, not from
 * what this screen shows: a route that shut since the page loaded blocks the
 * draft with its bar. Signing and filing stay the person's steps.
 */
export function MotionDraftSection({
  year,
  engagementId,
}: {
  year: OpenYear;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['motion-draft', engagementId, year.key],
    queryFn: () => api.motionDraft(engagementId, year.key),
  });
  const record = query.data?.draft ?? null;

  return (
    <div className="space-y-2">
      {record ? <DraftBody record={record} /> : null}
      {open ? (
        <DraftForm
          year={year}
          engagementId={engagementId}
          hasDraft={record !== null}
          onDrafted={(drafted) => {
            queryClient.setQueryData(['motion-draft', engagementId, year.key], { draft: drafted });
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-[11px] font-medium text-[var(--color-ink-secondary)] hover:underline"
        >
          {record ? 'Redraft the motion' : 'Draft the motion'}
        </button>
      )}
    </div>
  );
}

/**
 * What the person asserts; everything else the server takes from the record.
 *
 * Only open routes are offered — the recorder above lists shut ones too,
 * because a motion that went in late is a fact, but a draft under a shut route
 * would only be refused by the server's own check.
 */
function DraftForm({
  year,
  engagementId,
  hasDraft,
  onDrafted,
  onClose,
}: {
  year: OpenYear;
  engagementId: string;
  hasDraft: boolean;
  onDrafted: (record: MotionDraftRecord) => void;
  onClose: () => void;
}) {
  const openRoutes = year.outlook.routes.filter((route) => route.open);
  const [route, setRoute] = useState<CorrectionRouteKey>(openRoutes[0]?.key ?? 'c');
  const [claimedValue, setClaimedValue] = useState('');
  const [ground, setGround] = useState('');

  const draft = useMutation({
    mutationFn: () =>
      api.draftCorrectionMotion(engagementId, {
        yearKey: year.key,
        route,
        claimedValue: Number(claimedValue),
        ground,
      }),
    onSuccess: (result) => onDrafted(result.draft),
  });

  const claimed = Number(claimedValue);
  const ready = claimedValue.trim() !== '' && Number.isFinite(claimed) && ground.trim() !== '';
  const roll = year.rolledValue;

  return (
    <div className="space-y-2.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Route"
          help="The draft invokes exactly this subsection and argues only its grounds. The server re-checks that it is still open — including 25.25(d)'s one-third test, which needs the claimed value before it can be run at all."
        >
          <Select
            value={route}
            onChange={(event) => setRoute(event.target.value as CorrectionRouteKey)}
          >
            {openRoutes.map((one) => (
              <option key={one.key} value={one.key}>
                {one.cite}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Correct value"
          help={
            roll === null
              ? 'What the motion asserts the value should be. No roll value is on file to measure it against.'
              : `What the motion asserts the value should be. The roll says ${moneyExact(roll)}; the claim has to come in below it, and under (d) below ${moneyExact(roll * 0.75)}.`
          }
        >
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={claimedValue}
            onChange={(event) => setClaimedValue(event.target.value)}
            placeholder="0"
          />
        </Field>
      </div>

      <TextArea
        rows={2}
        value={ground}
        onChange={(event) => setGround(event.target.value)}
        placeholder="What is wrong, in your own words — the draft argues this, it does not invent a theory"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!ready || draft.isPending} onClick={() => draft.mutate()}>
          {draft.isPending ? 'Drafting…' : hasDraft ? 'Redraft it' : 'Draft it'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Never mind
        </Button>
      </div>
      {draft.error ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-critical)]">
          {draft.error instanceof Error ? draft.error.message : String(draft.error)}
        </p>
      ) : null}
    </div>
  );
}

function DraftBody({ record }: { record: MotionDraftRecord }) {
  const { draft, facts } = record;
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5 text-[11px] leading-relaxed">
      <p className="text-[var(--color-ink-muted)]">
        Drafted {dayShort(record.createdAt.slice(0, 10))} under {facts.route.cite}, claiming{' '}
        {moneyExact(facts.claimedValue)}
        {facts.rolledValue !== null ? <> against {moneyExact(facts.rolledValue)} on the roll</> : null}
        . Review, sign, file — then record the filing below.
      </p>
      <div className="rounded border border-[var(--color-hairline)] p-2">
        <p className="font-medium text-[var(--color-ink)]">{draft.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-[var(--color-ink-secondary)]">{draft.body}</p>
      </div>
      {draft.cautions.length > 0 ? (
        <div>
          <p className="font-medium text-[var(--color-warning)]">Before filing</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--color-ink-muted)]">
            {draft.cautions.map((caution) => (
              <li key={caution}>{caution}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
