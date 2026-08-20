'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import type { ClientFilingProfile, UpdateFilingProfileRequest } from '@tangible/types';
import { Button, Field, TextArea, TextInput } from '@/components/ui/controls';
import { Card, CardHeader } from '@/components/ui/primitives';
import { api } from '@/lib/api';

/**
 * The facts Form 50-144 asks for that a fixed asset register does not carry.
 *
 * Every box here answers a question on the return, so the labels are the
 * form's questions rather than column names, and the help text says what goes
 * wrong when the box is empty. Three of them are the difference between a
 * rendition that can be filed and one that cannot: without a mailing address
 * the district has nowhere to send the notice, and without a 50-162 date an
 * agent is not authorised to swear to any of it.
 */

/** The nine boxes, as strings — an empty one means unknown, not the empty string. */
type Draft = Record<keyof UpdateFilingProfileRequest, string>;

const EMPTY: Draft = {
  ownerName: '',
  mailingAddressLine1: '',
  mailingAddressLine2: '',
  mailingCity: '',
  mailingStateCode: '',
  mailingZip: '',
  businessDescription: '',
  agentAppointmentDate: '',
  signerTitle: '',
};

const draftOf = (profile: ClientFilingProfile | null): Draft =>
  profile === null
    ? EMPTY
    : {
        ownerName: profile.ownerName ?? '',
        mailingAddressLine1: profile.mailingAddressLine1 ?? '',
        mailingAddressLine2: profile.mailingAddressLine2 ?? '',
        mailingCity: profile.mailingCity ?? '',
        mailingStateCode: profile.mailingStateCode ?? '',
        mailingZip: profile.mailingZip ?? '',
        businessDescription: profile.businessDescription ?? '',
        agentAppointmentDate: profile.agentAppointmentDate ?? '',
        signerTitle: profile.signerTitle ?? '',
      };

const toRequest = (draft: Draft): UpdateFilingProfileRequest =>
  Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, value.trim() === '' ? null : value.trim()]),
  ) as UpdateFilingProfileRequest;

export function FilingProfileCard({
  clientId,
  clientName,
  profile,
}: {
  clientId: string;
  clientName: string;
  profile: ClientFilingProfile | null;
}) {
  const queryClient = useQueryClient();
  // What the server last told us it holds, and what the user has typed over it.
  // Both are local: comparing the draft against the `profile` prop instead would
  // read as dirty for the moment between a successful save and the refetch
  // landing, which is exactly when the user is looking for confirmation.
  const [stored, setStored] = useState<Draft>(() => draftOf(profile));
  const [draft, setDraft] = useState<Draft>(stored);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updateFilingProfile(clientId, toRequest(draft)),
    onSuccess: (next) => {
      const settled = draftOf(next);
      setStored(settled);
      setDraft(settled);
      setJustSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      // Every rendition draft for this client reads the profile. The printable
      // form is a server component and re-reads on its own.
      void queryClient.invalidateQueries({ queryKey: ['engagement-rendition'] });
    },
  });

  const set = (key: keyof Draft) => (value: string) => {
    setJustSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  return (
    <Card>
      <CardHeader
        title="Filing profile"
        description="What Form 50-144 asks about the taxpayer. The register cannot answer any of it, and a blank box is a blocking omission on the return."
      />
      <form
        className="space-y-5 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Owner’s name on the roll"
          help={`How the appraisal district has the owner, which is not always how we have them. Leave it empty to file as “${clientName}”.`}
        >
          <TextInput
            placeholder={clientName}
            value={draft.ownerName}
            onChange={(e) => set('ownerName')(e.target.value)}
          />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
            Mailing address
          </legend>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Where the district sends notices, including the one that starts the 41.44 protest clock.
            Not the situs — property is taxed where it stood on January 1, and that is recorded per
            location.
          </p>
          <TextInput
            aria-label="Mailing address line 1"
            placeholder="1200 Commerce St"
            value={draft.mailingAddressLine1}
            onChange={(e) => set('mailingAddressLine1')(e.target.value)}
            className="w-full"
          />
          <TextInput
            aria-label="Mailing address line 2"
            placeholder="Suite 400 (optional)"
            value={draft.mailingAddressLine2}
            onChange={(e) => set('mailingAddressLine2')(e.target.value)}
            className="w-full"
          />
          <div className="flex gap-2">
            <TextInput
              aria-label="City"
              placeholder="Houston"
              value={draft.mailingCity}
              onChange={(e) => set('mailingCity')(e.target.value)}
              className="flex-1"
            />
            <TextInput
              aria-label="State"
              placeholder="TX"
              maxLength={2}
              value={draft.mailingStateCode}
              onChange={(e) => set('mailingStateCode')(e.target.value.toUpperCase())}
              className="w-16"
            />
            <TextInput
              aria-label="ZIP"
              placeholder="77002"
              value={draft.mailingZip}
              onChange={(e) => set('mailingZip')(e.target.value)}
              className="w-28"
            />
          </div>
        </fieldset>

        <Field
          label="What the business does"
          help="In the owner’s own words, not the SIC code restated. Texas keys machinery life to the business rather than the machine, so this is what an appraiser reads when the code is generic — and a wrong reading is how a 15-year life becomes 8."
        >
          <TextArea
            placeholder="Precision machine shop producing parts for oilfield equipment"
            value={draft.businessDescription}
            onChange={(e) => set('businessDescription')(e.target.value)}
            className="w-full"
          />
        </Field>

        <div className="flex gap-3">
          <Field
            label="Form 50-162 appointment"
            help="The date of the signed agent appointment. Without one on file an agent is not authorised to make this statement, and the rendition cannot be filed by us."
          >
            <TextInput
              type="date"
              value={draft.agentAppointmentDate}
              onChange={(e) => set('agentAppointmentDate')(e.target.value)}
              className="w-44"
            />
          </Field>
          <Field label="Signing title" help="The title the signature is made in — “Agent” where we file, an officer’s title where the owner does.">
            <TextInput
              placeholder="Agent"
              value={draft.signerTitle}
              onChange={(e) => set('signerTitle')(e.target.value)}
              className="w-40"
            />
          </Field>
        </div>

        {save.error ? (
          <p className="text-xs text-[var(--color-critical)]">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button variant="primary" type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
          {justSaved && !dirty ? (
            <span className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
              <Check size={13} strokeWidth={2} />
              Saved
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
