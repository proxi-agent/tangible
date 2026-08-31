'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { MotionGround } from '@tangible/filing';
import type { CorrectionRouteKey, MotionDraftRecord, OpenYear } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dayShort, moneyExact } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { DownloadButton } from '@/components/workspace/download-button';

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
    /* With nothing drafted and the form shut this is a single button, and it
       belongs in the year's row of actions beside the recorder rather than
       stacked above it — `contents` lets the button itself be the item in that
       row. A draft, or the form, is a block and takes the whole line. */
    <div className={cn(record || open ? 'w-full space-y-2' : 'contents')}>
      {record && !open ? (
        // Redrafting belongs to the draft, in its footer, rather than loose
        // beneath it where it reads as a second choice on the year itself.
        <DraftBody
          record={record}
          action={
            <div className="space-y-2.5">
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                Redraft the motion
              </Button>
              <MotionForm record={record} engagementId={engagementId} />
            </div>
          }
        />
      ) : null}
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
      ) : record ? null : (
        <Button size="sm" onClick={() => setOpen(true)}>
          Draft the motion
        </Button>
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
        <Button
          variant="primary"
          disabled={!ready || draft.isPending}
          onClick={() => draft.mutate()}
        >
          {draft.isPending ? 'Drafting…' : hasDraft ? 'Redraft it' : 'Draft it'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Never mind
        </Button>
      </div>
      {draft.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {draft.error instanceof Error ? draft.error.message : String(draft.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The drafted motion on the district's own paper.
 *
 * The route already chose the form — 50-771 for (c) and (c-1), 50-230 for (d) —
 * so this asks only for what neither the record nor the draft holds. The
 * certification date is the awkward one: it is the ARB's own calendar rather
 * than a document we receive, both forms recite it, and both refuse to print
 * without it, so it is asked for here rather than guessed at from the season.
 */
function MotionForm({ record, engagementId }: { record: MotionDraftRecord; engagementId: string }) {
  const route = record.facts.route.key;
  const [certified, setCertified] = useState('');
  const [units, setUnits] = useState('');
  const [ground, setGround] = useState<MotionGround>('omitted-tpp');

  const query = new URLSearchParams({ key: record.yearKey });
  if (certified.trim()) query.set('certified', certified.trim());
  if (units.trim()) query.set('units', units.trim());
  if (route !== 'd') query.set('ground', ground);

  return (
    <div className="space-y-2 rounded border border-[var(--color-hairline)] p-2">
      <p className="text-[var(--color-ink-muted)]">
        {route === 'd'
          ? 'Form 50-230 — the (d) motion, which asserts the one-third over-appraisal on its face.'
          : `Form 50-771 — the ${record.facts.route.cite} motion, which selects one of five grounds.`}{' '}
        Filled from the draft above and left fillable, with the signature line empty.
      </p>
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Roll certified"
          help="The day this appraisal review board certified the roll being corrected. Both forms recite it — a 25.25 motion asks to change a certified roll, and without the date it does not say which one. Nothing here records it, so it comes off the board's own notice."
        >
          <TextInput
            type="date"
            className="w-40"
            value={certified}
            onChange={(event) => setCertified(event.target.value)}
          />
        </Field>
        {route === 'd' ? null : (
          <Field
            label="Ground"
            help="25.25(c) and (c-1) are a closed list, and the form ticks exactly one. A mis-scheduled register is usually the last: an error of tangible personal property in a rendition."
          >
            <Select
              value={ground}
              onChange={(event) => setGround(event.target.value as MotionGround)}
            >
              {GROUND_LABEL.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field
        label="Taxing units"
        help="The board notifies the presiding officer of each unit that taxes the property, so an empty line is a hearing they are not told about. Comma separated."
      >
        <TextInput
          className="w-full"
          value={units}
          onChange={(event) => setUnits(event.target.value)}
          placeholder="Harris County, Houston ISD, City of Houston"
        />
      </Field>
      <DownloadButton
        href={`/api/engagements/${engagementId}/motion-draft/pdf?${query.toString()}`}
        busyLabel="Filling…"
      >
        {route === 'd' ? 'Form 50-230' : 'Form 50-771'}
      </DownloadButton>
    </div>
  );
}

/** The five grounds as the form prints them, shortened to fit a picker. */
const GROUND_LABEL: readonly (readonly [MotionGround, string])[] = [
  ['omitted-tpp', '(c-1) — error or omission of personal property in a rendition'],
  ['clerical', '(c)(1) — clerical error affecting liability'],
  ['multiple-appraisals', '(c)(2) — multiple appraisals of one property'],
  ['non-existent', '(c)(3) — property that does not exist in that form or place'],
  ['ownership', '(c)(4) — an error of ownership'],
];

function DraftBody({ record, action }: { record: MotionDraftRecord; action?: ReactNode }) {
  const { draft, facts } = record;
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5 text-xs leading-relaxed">
      <p className="text-[var(--color-ink-muted)]">
        Drafted {dayShort(record.createdAt.slice(0, 10))} under {facts.route.cite}, claiming{' '}
        {moneyExact(facts.claimedValue)}
        {facts.rolledValue !== null ? (
          <> against {moneyExact(facts.rolledValue)} on the roll</>
        ) : null}
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
      {action ? <div className="pt-0.5">{action}</div> : null}
    </div>
  );
}
