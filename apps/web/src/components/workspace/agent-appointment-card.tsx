'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  APPOINTMENT_DELIVERIES,
  type AgentAppointment,
  type AppointmentDelivery,
  type AppointmentMatters,
  type AppointmentScope,
  type AppointmentSignerCapacity,
  type ClientLocation,
  type FilingAgent,
} from '@tangible/types';
// The district table only, not the package index: `@tangible/filing` reaches a
// PDF writer and `node:fs` through its barrel, and this runs in the browser.
import { APPRAISAL_DISTRICTS, appraisalDistrictName } from '@tangible/filing/districts';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { day, dayShort } from '@/lib/format';
import { today } from '@/lib/today';

/**
 * Every Form 50-162 this client has signed, and whether any of them lets us
 * file.
 *
 * The app already refuses to sign a rendition as agent without one. This is
 * where the one comes from — and the form is worth recording in full rather
 * than as the single date the filing profile used to carry, because three of
 * its answers decide things nothing else in the app can see:
 *
 *   - **It is per appraisal district.** Field one is the district's own name,
 *     and districts keep their own agent files. One filed in Harris is
 *     invisible in Fort Bend, so a two-county client needs two forms.
 *   - **Signed is not filed.** The form says the designation takes effect only
 *     when the district has it. The week a signed form spends in an envelope is
 *     a week we may not sign anything, and it is the ordinary case.
 *   - **Confidentiality is its own box.** 22.27 makes the rendition
 *     confidential; Step 4's radio is the only thing that lets the district
 *     hand the client's own file to us. An appointment that says no is
 *     perfectly valid and still leaves us working blind.
 *
 * So each row says what it is worth today in a sentence, not a checkmark.
 */
export function AgentAppointmentCard({
  clientId,
  locations,
}: {
  clientId: string;
  locations: ClientLocation[];
}) {
  const appointments = useQuery({
    queryKey: ['client-appointments', clientId],
    queryFn: () => api.appointments(clientId),
  });

  return (
    <Card>
      <CardHeader
        title="Agent appointments"
        description="Form 50-162, one per appraisal district."
        help="The appointment is what lets us sign a rendition for this client — and it authorises nothing until the district has it. Tax Code 1.111 governs who may act for a property owner."
      />
      <AgentRecord />
      <div className="space-y-4 px-5 py-4">
        {appointments.isLoading ? (
          <Skeleton className="h-16" />
        ) : appointments.error ? (
          <ErrorState error={appointments.error} />
        ) : appointments.data && appointments.data.length > 0 ? (
          <ul className="space-y-3">
            {appointments.data.map((appointment) => (
              <Recorded
                key={appointment.id}
                appointment={appointment}
                clientId={clientId}
                locations={locations}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            Nothing on file. Record the appointment you want, print it from here for the client to
            sign, and mark it filed once the district has it — a return signed as agent is blocked
            until then.
          </p>
        )}
        <RecordForm clientId={clientId} locations={locations} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: us
// ---------------------------------------------------------------------------

/**
 * Who the form appoints, which is the same firm on every one of them.
 *
 * Kept as one record rather than copied onto each appointment, because Step 4
 * has the owner direct the district to deliver documents "only to the agent at
 * the agent's address indicated above" — so a stale address here is not a
 * cosmetic problem, it is a protest notice arriving somewhere we left.
 */
function AgentRecord() {
  const queryClient = useQueryClient();
  const agent = useQuery({ queryKey: ['filing-agent'], queryFn: () => api.filingAgent() });
  const [open, setOpen] = useState(false);

  if (agent.isLoading) {
    return (
      <div className="border-b border-[var(--color-hairline)] px-5 py-3">
        <Skeleton className="h-5" />
      </div>
    );
  }
  const record = agent.data ?? null;
  const named = Boolean(record?.name?.trim());

  return (
    <div className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xs font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
          Filing as
        </span>
        {named ? (
          <span className="text-xs text-[var(--color-ink)]">
            {record?.name}
            <span className="text-[var(--color-ink-muted)]">
              {[record?.addressLine1, joinAddress(record), record?.phone]
                .filter((part) => Boolean(part))
                .map((part) => ` · ${part}`)
                .join('')}
            </span>
          </span>
        ) : (
          <span className="text-xs text-[var(--color-warning)]">
            Nobody. Step 3 is the agent being appointed, so no form will print until this is filled
            in.
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="ml-auto cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
        >
          {open ? 'Close' : named ? 'Edit' : 'Fill it in'}
        </button>
      </div>
      {open ? (
        <AgentForm
          agent={record}
          onSaved={() => {
            setOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['filing-agent'] });
          }}
        />
      ) : null}
    </div>
  );
}

function AgentForm({ agent, onSaved }: { agent: FilingAgent | null; onSaved: () => void }) {
  const [name, setName] = useState(agent?.name ?? '');
  const [phone, setPhone] = useState(agent?.phone ?? '');
  const [addressLine1, setAddressLine1] = useState(agent?.addressLine1 ?? '');
  const [city, setCity] = useState(agent?.city ?? '');
  const [stateCode, setStateCode] = useState(agent?.stateCode ?? '');
  const [zip, setZip] = useState(agent?.zip ?? '');

  const save = useMutation({
    mutationFn: () => api.updateFilingAgent({ name, phone, addressLine1, city, stateCode, zip }),
    onSuccess: onSaved,
  });

  return (
    <form
      className="mt-3 space-y-3 border-t border-[var(--color-hairline)] pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Firm" help="Exactly as it should read on Step 3 of every form we send out.">
          <TextInput
            className="w-56"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tangible Property Tax LLC"
          />
        </Field>
        <Field label="Phone" help="The number the district calls about an account.">
          <TextInput
            className="w-40"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(713) 555-0142"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Address"
          help="Where the district sends everything Step 4 redirects to us. Not a box the client sees — a box the appraisal review board mails a hearing notice to."
        >
          <TextInput
            className="w-64"
            value={addressLine1}
            onChange={(event) => setAddressLine1(event.target.value)}
            placeholder="1200 Commerce St, Suite 400"
          />
        </Field>
        <TextInput
          aria-label="City"
          className="w-36"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="Houston"
        />
        <TextInput
          aria-label="State"
          className="w-14"
          maxLength={2}
          value={stateCode}
          onChange={(event) => setStateCode(event.target.value.toUpperCase())}
          placeholder="TX"
        />
        <TextInput
          aria-label="ZIP"
          className="w-24"
          value={zip}
          onChange={(event) => setZip(event.target.value)}
          placeholder="77002"
        />
      </div>
      {save.error ? <Failure error={save.error} /> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Used on every appointment, including ones already signed — the form is reprinted from
          this, not from a copy taken when it was recorded.
        </p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One appointment on file
// ---------------------------------------------------------------------------

/**
 * What an appointment is worth today, in the two registers a reader needs.
 *
 * The badge is the state; the sentence under it is the remedy, and they are not
 * the same information. "Not filed" and "revoked" are both "we cannot sign",
 * but one of them is this afternoon's errand and the other is a phone call to
 * find out who else the client appointed.
 */
function state(appointment: AgentAppointment): {
  tone: 'good' | 'warning' | 'critical';
  label: string;
} {
  if (appointment.revokedOn) return { tone: 'critical', label: 'revoked' };
  if (appointment.effective) return { tone: 'good', label: 'in force' };
  if (!appointment.filedOn) return { tone: 'warning', label: 'not filed' };
  return { tone: 'critical', label: 'expired' };
}

function Recorded({
  appointment,
  clientId,
  locations,
}: {
  appointment: AgentAppointment;
  clientId: string;
  locations: ClientLocation[];
}) {
  const { tone, label } = state(appointment);
  const district = appraisalDistrictName(appointment.jurisdictionId) ?? appointment.jurisdictionId;

  return (
    <li className="space-y-1.5 rounded-lg border border-[var(--color-hairline)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <Badge tone={tone}>{label}</Badge>
        <span className="font-medium">{district}</span>
        <span className="tabular text-[var(--color-ink-secondary)]">
          signed {dayShort(appointment.signedOn)}
          {appointment.filedOn ? ` · filed ${dayShort(appointment.filedOn)}` : ''}
          {appointment.endsOn ? ` · ends ${dayShort(appointment.endsOn)}` : ''}
        </span>
        <span className="ml-auto text-[var(--color-ink-muted)]">
          {appointment.signerName}
          {appointment.signerTitle ? `, ${appointment.signerTitle}` : ''}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {coverage(appointment, locations)} {appointment.standing}
      </p>

      {appointment.matters === 'specific' ? (
        <p className="text-xs leading-relaxed text-[var(--color-warning)]">
          Limited to: {appointment.specificMatters}. Anything outside that is not ours to do,
          including signing a return if the wording does not reach it.
        </p>
      ) : null}

      {!appointment.receivesConfidential ? (
        <p className="text-xs leading-relaxed text-[var(--color-warning)]">
          Step 4 says no to 22.27(b)(2), so the district may not release this client’s file to us —
          no prior rendition, no account detail. We can file; we cannot see what was filed before.
        </p>
      ) : null}

      {appointment.note ? (
        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">{appointment.note}</p>
      ) : null}

      <Actions appointment={appointment} clientId={clientId} />
    </li>
  );
}

/** What Step 2 reached, said in this client's own site names. */
function coverage(appointment: AgentAppointment, locations: ClientLocation[]): string {
  if (appointment.scope === 'all-at-address') {
    return 'Covers all property listed at the owner’s mailing address.';
  }
  const byId = new Map(locations.map((location) => [location.id, location.label]));
  const named = appointment.locationIds.map((id) => byId.get(id) ?? 'a site since removed');
  return `Covers ${named.join(', ')}.`;
}

type Pending = 'file' | 'revoke' | null;

/**
 * The three things anybody does to a form on file: print it, record that it
 * arrived, record that it ended.
 *
 * There is no edit. A form whose terms were wrong is not corrected here — it is
 * a new form, which is what the district would need anyway, and under 1.111(d)
 * the new designation revokes the old one for the same property by itself.
 */
function Actions({ appointment, clientId }: { appointment: AgentAppointment; clientId: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const [date, setDate] = useState(() => today());
  const [reason, setReason] = useState('');

  const update = useMutation({
    mutationFn: (kind: Exclude<Pending, null>) =>
      api.updateAppointment(
        appointment.id,
        kind === 'file'
          ? { filedOn: date }
          : { revokedOn: date, revokedReason: reason.trim() || null },
      ),
    onSuccess: () => {
      setPending(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['client-appointments', clientId] });
      // Every rendition for this client reads its appointment to decide whether
      // we may sign, and the returns board reads the same blockers.
      void queryClient.invalidateQueries({ queryKey: ['engagement-rendition'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season'] });
    },
  });

  if (pending === null) {
    return (
      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        <a
          href={api.appointmentPdfUrl(appointment.id)}
          className="cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
        >
          Download Form 50-162
        </a>
        {!appointment.filedOn && !appointment.revokedOn ? (
          <button
            type="button"
            onClick={() => setPending('file')}
            className="cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
          >
            The district has it
          </button>
        ) : null}
        {!appointment.revokedOn ? (
          <button
            type="button"
            onClick={() => setPending('revoke')}
            className="cursor-pointer text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]"
          >
            Revoke
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-plane)] p-2.5">
      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {pending === 'file'
          ? 'The day the district received it, which is the day the designation took effect. A return signed before that date was signed unappointed, so this is the date and not today’s.'
          : 'Revocation is the district’s record ending, not ours. Use the date the written revocation was filed — or, where the client appointed somebody else, the date that form was filed, because 1.111(d) revoked ours the moment it was.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={pending === 'file' ? 'Received' : 'Revoked'}>
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {pending === 'revoke' ? (
          <TextInput
            className="min-w-52 flex-1"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why, and who told us"
          />
        ) : null}
        <Button
          variant={pending === 'file' ? 'primary' : 'secondary'}
          disabled={update.isPending}
          onClick={() => update.mutate(pending)}
        >
          {update.isPending ? 'Saving…' : pending === 'file' ? 'Record it as filed' : 'Revoke it'}
        </Button>
        <Button variant="ghost" onClick={() => setPending(null)}>
          Never mind
        </Button>
      </div>
      {update.error ? <Failure error={update.error} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recording one
// ---------------------------------------------------------------------------

const DELIVERY_LABEL: Readonly<Record<AppointmentDelivery, string>> = {
  'chief-appraiser': 'the chief appraiser',
  arb: 'the appraisal review board',
  'taxing-units': 'the taxing units in the district',
};

const CAPACITY_LABEL: Readonly<Record<AppointmentSignerCapacity, string>> = {
  owner: 'The property owner',
  'property-manager': 'A property manager authorised to appoint agents',
  'other-authorized': 'Somebody else authorised to act for the owner',
};

/**
 * The form as it will be signed.
 *
 * Recorded before it goes out rather than after it comes back, which is why
 * "filed" is a separate box that starts empty: the printable form is built from
 * this record, so the record has to exist first. The week between the two is
 * the thing this card exists to make visible.
 */
function RecordForm({ clientId, locations }: { clientId: string; locations: ClientLocation[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // A client with sites in one county is the ordinary case, and the district
  // those sites sit in is the answer nine times out of ten.
  const situs = [...new Set(locations.map((l) => l.jurisdictionId).filter((id) => id !== null))];
  const [jurisdictionId, setJurisdictionId] = useState(situs.length === 1 ? situs[0]! : '');
  const [scope, setScope] = useState<AppointmentScope>('listed');
  const [locationIds, setLocationIds] = useState<string[]>(() => locations.map((l) => l.id));
  const [matters, setMatters] = useState<AppointmentMatters>('all');
  const [specificMatters, setSpecificMatters] = useState('');
  const [receivesConfidential, setReceivesConfidential] = useState(true);
  const [deliveries, setDeliveries] = useState<AppointmentDelivery[]>([...APPOINTMENT_DELIVERIES]);
  const [signedOn, setSignedOn] = useState(() => today());
  const [filedOn, setFiledOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerCapacity, setSignerCapacity] = useState<AppointmentSignerCapacity>('owner');
  const [note, setNote] = useState('');

  const record = useMutation({
    mutationFn: () =>
      api.recordAppointment(clientId, {
        jurisdictionId,
        scope,
        locationIds: scope === 'listed' ? locationIds : [],
        matters,
        specificMatters: specificMatters.trim() || null,
        receivesConfidential,
        deliveries,
        signedOn,
        filedOn: filedOn || null,
        endsOn: endsOn || null,
        signerName: signerName.trim(),
        signerTitle: signerTitle.trim() || null,
        signerCapacity,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOpen(false);
      setSignerName('');
      setSignerTitle('');
      setNote('');
      setFiledOn('');
      void queryClient.invalidateQueries({ queryKey: ['client-appointments', clientId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-rendition'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season'] });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs font-medium hover:underline"
      >
        Record an appointment
      </button>
    );
  }

  const elsewhere = jurisdictionId !== '' && situs.length > 0 && !situs.includes(jurisdictionId);
  const ready = jurisdictionId !== '' && signerName.trim().length > 0;

  return (
    <div className="space-y-4 border-t border-[var(--color-hairline)] pt-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Appraisal district"
          help="Field one of the form, and the limit of what it does. Districts keep their own agent files, so an appointment filed in one county is invisible in the next."
        >
          <Select
            value={jurisdictionId}
            onChange={(event) => setJurisdictionId(event.target.value)}
          >
            <option value="">Choose a district</option>
            {APPRAISAL_DISTRICTS.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="What it covers"
          help="Step 2 is a check-one. “All property at the mailing address” is the convenient box and usually the wrong one for business personal property: the property sits at each site, and a client whose post goes to a downtown office has none listed there at all."
        >
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value as AppointmentScope)}
          >
            <option value="listed">The sites listed on the form</option>
            <option value="all-at-address">All property at the owner’s mailing address</option>
          </Select>
        </Field>
      </div>

      {elsewhere ? (
        <p className="text-xs leading-relaxed text-[var(--color-warning)]">
          None of this client’s sites is recorded in that district. Worth a second look — an
          appointment filed with the wrong district reaches nothing, and nobody will say so.
        </p>
      ) : null}

      {scope === 'listed' ? (
        locations.length === 0 ? (
          <p className="text-xs leading-relaxed text-[var(--color-warning)]">
            This client has no sites recorded, so there is nothing for Step 2 to list. Add the
            locations first — the form identifies property by account and situs, not by client.
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-[var(--color-ink-secondary)]">
              Step 2 prints four rows. Anything past the fourth has to go on an attached sheet, and
              the form will say so rather than dropping it.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {locations.map((location) => (
                <label
                  key={location.id}
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]"
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={locationIds.includes(location.id)}
                    onChange={(event) =>
                      setLocationIds((current) =>
                        event.target.checked
                          ? [...current, location.id]
                          : current.filter((id) => id !== location.id),
                      )
                    }
                  />
                  {location.label}
                  {location.accountId ? (
                    <span className="tabular text-[var(--color-ink-muted)]">
                      #{location.accountId}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        )
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="How wide the authority runs"
          help="Step 4. “All property tax matters” is what a filing agent needs; anything narrower has to be written out, and we are then bound by the wording."
        >
          <Select
            value={matters}
            onChange={(event) => setMatters(event.target.value as AppointmentMatters)}
          >
            <option value="all">All property tax matters</option>
            <option value="specific">Only the matters written below</option>
          </Select>
        </Field>
        {matters === 'specific' ? (
          <Field
            label="Limited to"
            help="Verbatim what the form will say. Make sure it reaches signing and filing the rendition, or it does not authorise the thing we are here to do."
          >
            <TextInput
              value={specificMatters}
              onChange={(event) => setSpecificMatters(event.target.value)}
              placeholder="Preparing, signing and filing the annual rendition"
            />
          </Field>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--color-ink-secondary)]">
          <input
            type="checkbox"
            className="mt-0.5 cursor-pointer"
            checked={receivesConfidential}
            onChange={(event) => setReceivesConfidential(event.target.checked)}
          />
          <span>
            The district may release the client’s confidential information to us
            <span className="block text-xs text-[var(--color-ink-muted)]">
              Step 4’s 22.27(b)(2) radio. Answered either way, never left blank — a district reading
              an unanswered box will not open the file, so silence is a no nobody chose. Without it
              we cannot get the prior rendition or the account detail behind an assessment.
            </span>
          </span>
        </label>
        <div className="space-y-1">
          <p className="text-xs text-[var(--color-ink-secondary)]">
            Send their communications to us instead of the client:
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {APPOINTMENT_DELIVERIES.map((delivery) => (
              <label
                key={delivery}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]"
              >
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={deliveries.includes(delivery)}
                  onChange={(event) =>
                    setDeliveries((current) =>
                      event.target.checked
                        ? [...current, delivery]
                        : current.filter((value) => value !== delivery),
                    )
                  }
                />
                {DELIVERY_LABEL[delivery]}
              </label>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
            A redirection, not a copy: the form has the owner acknowledge these will no longer be
            delivered to them. The review board box is the one that decides whether a hearing notice
            reaches us in time to answer it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Signed"
          help="The date that prints on Step 6. Where you are producing the form to send out, use the day it goes — the district reads this date, and the designation still does nothing until it is filed."
        >
          <TextInput
            type="date"
            value={signedOn}
            onChange={(event) => setSignedOn(event.target.value)}
          />
        </Field>
        <Field
          label="Filed with the district"
          help="Leave empty until it has actually arrived. This is the box that decides whether we may sign anything, and guessing at it is how a rendition gets sworn to unappointed."
        >
          <TextInput
            type="date"
            value={filedOn}
            onChange={(event) => setFiledOn(event.target.value)}
          />
        </Field>
        <Field
          label="Expires"
          help="Step 5, and usually blank: with no date the designation runs until somebody revokes it. A date here is read as the day authority stops, not the last day it holds."
        >
          <TextInput
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Signed by" help="The person signing Step 6, as they will sign it.">
          <TextInput
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="Dana Ruiz"
          />
        </Field>
        <Field label="Title" help="Their title at the company. Optional on the form.">
          <TextInput
            value={signerTitle}
            onChange={(event) => setSignerTitle(event.target.value)}
            placeholder="Controller"
          />
        </Field>
        <Field
          label="Signing as"
          help="Step 6’s check-one. It is the owner’s own authority that makes the appointment good, so a form signed by somebody who cannot appoint agents is worth nothing however carefully it is filled in."
        >
          <Select
            value={signerCapacity}
            onChange={(event) => setSignerCapacity(event.target.value as AppointmentSignerCapacity)}
          >
            {(Object.keys(CAPACITY_LABEL) as AppointmentSignerCapacity[]).map((capacity) => (
              <option key={capacity} value={capacity}>
                {CAPACITY_LABEL[capacity]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Note" help="Anything a reader in two years would want about this form.">
        <TextArea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. sent with the Fort Bend form in one envelope"
        />
      </Field>

      {record.error ? <Failure error={record.error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!ready || record.isPending}
          onClick={() => record.mutate()}
        >
          {record.isPending ? 'Recording…' : 'Record the appointment'}
        </Button>
        <Button onClick={() => setOpen(false)}>Never mind</Button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {filedOn
            ? `Authorises us in ${appraisalDistrictName(jurisdictionId) ?? 'that district'} from ${day(filedOn)}.`
            : 'Recorded as signed and unfiled — print it, get it signed, and mark it filed once the district has it.'}
        </p>
      </div>
    </div>
  );
}

function Failure({ error }: { error: unknown }) {
  return (
    <p className="text-xs leading-relaxed text-[var(--color-critical)]">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** The agent's city/state/ZIP as one line, for the summary strip. */
function joinAddress(agent: FilingAgent | null): string | null {
  if (!agent) return null;
  const left = [agent.city, agent.stateCode].filter((part) => Boolean(part?.trim())).join(', ');
  return [left, agent.zip?.trim()].filter(Boolean).join(' ') || null;
}
