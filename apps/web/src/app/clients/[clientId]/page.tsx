'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APPRAISAL_DISTRICTS } from '@tangible/filing/districts';
import type { ClientLocation } from '@tangible/types';
import { scheduledJurisdictions } from '@tangible/valuation';
import { api } from '@/lib/api';
import { AgentAppointmentCard } from '@/components/workspace/agent-appointment-card';
import { ClientStatusBadge } from '@/components/workspace/badges';
import { FilingProfileCard } from '@/components/workspace/filing-profile-card';
import { Button, Field, Select, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

export default function ClientPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId),
  });

  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(String(currentYear + 1));
  const validYear = /^\d{4}$/.test(taxYear.trim());
  const createEngagement = useMutation({
    mutationFn: () => api.createEngagement(clientId, { taxYear: Number(taxYear) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      // The clients list carries an engagement count for this client.
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  const [label, setLabel] = useState('');
  const [city, setCity] = useState('');
  const createLocation = useMutation({
    mutationFn: () =>
      api.createLocation(clientId, { label: label.trim(), city: city.trim() || undefined }),
    onSuccess: () => {
      setLabel('');
      setCity('');
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    },
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-48 w-full" />;

  const { client, engagements, locations, filingProfile } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/clients"
          className="flex items-center gap-1 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          Clients
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">{client.name}</h1>
        <ClientStatusBadge status={client.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Engagements"
            description="One per tax season. The FAR files, mapped assets, and every later analysis and filing live inside an engagement."
            action={
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (validYear) createEngagement.mutate();
                }}
              >
                <Field label="Tax year">
                  <TextInput
                    type="number"
                    value={taxYear}
                    onChange={(e) => setTaxYear(e.target.value)}
                    className="w-24"
                  />
                </Field>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!validYear || createEngagement.isPending}
                >
                  <Plus size={15} strokeWidth={2} />
                  New
                </Button>
              </form>
            }
          />
          {createEngagement.error ? (
            <p className="px-5 pt-3 text-xs text-[var(--color-critical)]">
              {createEngagement.error instanceof Error
                ? createEngagement.error.message
                : String(createEngagement.error)}
            </p>
          ) : null}
          {engagements.length === 0 ? (
            <EmptyState title="No engagements yet">
              Create one for the upcoming season — tax year {currentYear + 1} renditions are due
              April 15, {currentYear + 1}.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)]">
              {engagements.map((engagement) => (
                <li key={engagement.id}>
                  <Link
                    href={`/clients/${clientId}/engagements/${engagement.id}`}
                    className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-[var(--color-plane)]"
                  >
                    <span className="text-sm font-medium">Tax year {engagement.taxYear}</span>
                    <span className="flex items-center gap-2.5">
                      <SeasonHint engagementId={engagement.id} />
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        created {new Date(engagement.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Locations"
            description="Where the property sits on January 1."
            help="Each situs is its own account and its own rendition, so a multi-site client is several filings — the sites here are what the filing page turns into forms."
            action={
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (label.trim()) createLocation.mutate();
                }}
              >
                <Field label="Label">
                  <TextInput
                    placeholder="HQ, Plant 2…"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-32"
                  />
                </Field>
                <Field label="City">
                  <TextInput
                    placeholder="Houston"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-32"
                  />
                </Field>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!label.trim() || createLocation.isPending}
                >
                  <Plus size={15} strokeWidth={2} />
                  Add
                </Button>
              </form>
            }
          />
          {locations.length === 0 ? (
            <EmptyState title="No locations yet">
              Optional until analysis — but situs decides the jurisdiction, so it pays to record it
              early.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)]">
              {locations.map((location) => (
                <LocationRow key={location.id} clientId={clientId} location={location} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <FilingProfileCard clientId={clientId} clientName={client.name} profile={filingProfile} />

      <AgentAppointmentCard clientId={clientId} locations={locations} />
    </div>
  );
}

/**
 * Where the engagement's season stands, on the row that opens it.
 *
 * "Tax year 2027 · created 8/19" says an engagement exists, not whether it
 * needs anyone. This reads the same season the engagement page shows — the
 * fetch doubles as a prefetch for the page the row links to — and reduces it
 * to the one word worth knowing before clicking: blocked, ready, or filed.
 */
function SeasonHint({ engagementId }: { engagementId: string }) {
  const { data } = useQuery({
    queryKey: ['engagement-season', engagementId],
    queryFn: () => api.season(engagementId),
  });
  if (!data || data.returns.length === 0) return null;

  const blocked = data.returns.filter((entry) => entry.status === 'blocked').length;
  const unfiled = data.returns.filter((entry) => entry.status !== 'filed').length;
  if (blocked > 0) {
    return (
      <Badge tone="critical">
        {blocked} blocked
      </Badge>
    );
  }
  if (unfiled > 0) return <Badge tone="accent">ready to file</Badge>;
  return <Badge tone="good">filed</Badge>;
}

const DISTRICT_NAMES = new Map(APPRAISAL_DISTRICTS.map((d) => [d.id, d.name]));
const SCHEDULED = new Set(scheduledJurisdictions().map((j) => j.id));

/**
 * What choosing a district costs, said before the choice is saved.
 *
 * Two different unknowns hide behind an unset district and they are worth
 * separating. Leaving it unset is right for the ordinary client whose sites are
 * all in one county — the engagement already names it, and repeating it here
 * would be a second place to get it wrong. It is only wrong for the client
 * whose plant is over a county line, and that client's operator is the one
 * reading this line.
 *
 * The list offered is every district we can print a form for, not the shorter
 * list we can value against. A site in a county whose schedules we have not
 * loaded still owes a return there on the date the statute says, and filing it
 * on the cost basis needs no schedule at all — so refusing to name the district
 * would block a return we are perfectly able to file.
 */
function DistrictNote({ jurisdictionId }: { jurisdictionId: string }) {
  if (jurisdictionId === '') {
    return (
      <p className="w-full text-xs text-[var(--color-ink-muted)]">
        This site files wherever the engagement points. Right where every site is in one county,
        wrong the moment one is not — property is taxed where it stood on January 1.
      </p>
    );
  }
  const name = DISTRICT_NAMES.get(jurisdictionId) ?? jurisdictionId;
  return SCHEDULED.has(jurisdictionId) ? (
    <p className="w-full text-xs text-[var(--color-ink-muted)]">
      Returns for this site print for {name} and are valued on its schedule.
    </p>
  ) : (
    <p className="w-full text-xs text-[var(--color-warning)]">
      Returns for this site print for {name}. No depreciation schedule is loaded for it, so property
      here is classified but carries no value — which the cost basis does not ask for.
    </p>
  );
}

/**
 * A location, and the address the district needs, filled in when it is known.
 *
 * Sites are usually created from a register's own shorthand — "Houston Plant"
 * is enough for an operator to place a thousand rows against, and it is all the
 * file gives us. The street address arrives later, from the client or a notice,
 * and until it does the label is genuinely all we have. So the address is an
 * edit on an existing row rather than a precondition for making one: requiring
 * it up front would only mean placements wait on a phone call.
 *
 * It stops being optional at the form. Line 1 of Form 50-144 wants the physical
 * location of the property, and a label nobody outside this app recognises will
 * not do.
 *
 * The account number sits here for the same reason it sits on the district's
 * side: Harris opens one BPP account per business location, so the account
 * belongs to the site rather than to a season's engagement, and it is the same
 * number next year. It is what each of this client's returns files under, and
 * what a prior year's assessment is looked up by.
 *
 * So does the appraisal district, and for a while nothing here let anyone say
 * it. Everything downstream reads the site's district and falls back to the
 * engagement's, which meant a client with a plant across a county line filed
 * both returns in one county without anything on screen saying so.
 */
function LocationRow({ clientId, location }: { clientId: string; location: ClientLocation }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    accountId: location.accountId ?? '',
    addressLine1: location.addressLine1 ?? '',
    city: location.city ?? '',
    stateCode: location.stateCode ?? '',
    zip: location.zip ?? '',
    jurisdictionId: location.jurisdictionId ?? '',
  });

  const save = useMutation({
    mutationFn: () => api.updateLocation(clientId, location.id, draft),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      // A situs the rendition could not print may have just become printable,
      // on whichever of this client's engagements has property here. The same
      // goes for the account: the returns list, the savings report's prior
      // assessment and the form all read it off this row.
      void queryClient.invalidateQueries({ queryKey: ['engagement-rendition'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-returns'] });
      // The district moves more than the paper: it decides whose schedule
      // prices this site's property, and which Form 50-162 has to be on file
      // before we may sign for it.
      void queryClient.invalidateQueries({ queryKey: ['engagement-valuation'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season'] });
      void queryClient.invalidateQueries({ queryKey: ['client-appointments', clientId] });
    },
  });

  const address = [
    location.addressLine1,
    [location.city, location.stateCode].filter(Boolean).join(', '),
    location.zip,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex items-center gap-2">
        <MapPin size={14} strokeWidth={2} className="text-[var(--color-ink-muted)]" />
        <span className="font-medium">{location.label}</span>
        {address ? (
          <span className="text-xs text-[var(--color-ink-muted)]">{address}</span>
        ) : (
          <span className="text-xs text-[var(--color-warning)]">no address yet</span>
        )}
        {location.accountId ? (
          <span className="tabular text-xs text-[var(--color-ink-muted)]">
            account {location.accountId}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-warning)]">no account</span>
        )}
        <span className="text-xs text-[var(--color-ink-muted)]">
          {location.jurisdictionId
            ? (DISTRICT_NAMES.get(location.jurisdictionId) ?? location.jurisdictionId)
            : 'district from the engagement'}
        </span>
        <Button variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setOpen(!open)}>
          {open ? 'Cancel' : address || location.accountId ? 'Edit' : 'Add address'}
        </Button>
      </div>

      {open ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Street">
            <TextInput
              placeholder="1200 Commerce St"
              value={draft.addressLine1}
              onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })}
              className="w-56"
            />
          </Field>
          <Field label="City">
            <TextInput
              placeholder="Houston"
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              className="w-36"
            />
          </Field>
          <Field label="State">
            <TextInput
              placeholder="TX"
              maxLength={2}
              value={draft.stateCode}
              onChange={(e) => setDraft({ ...draft, stateCode: e.target.value })}
              className="w-16"
            />
          </Field>
          <Field label="ZIP">
            <TextInput
              placeholder="77002"
              value={draft.zip}
              onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
              className="w-24"
            />
          </Field>
          <Field label="Account">
            <TextInput
              placeholder="2349508"
              value={draft.accountId}
              onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
              className="w-28"
            />
          </Field>
          <Field label="Appraisal district">
            <Select
              value={draft.jurisdictionId}
              onChange={(e) => setDraft({ ...draft, jurisdictionId: e.target.value })}
              className="h-8 w-64 text-xs"
            >
              <option value="">Take the engagement’s</option>
              {APPRAISAL_DISTRICTS.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name}
                </option>
              ))}
            </Select>
          </Field>
          <DistrictNote jurisdictionId={draft.jurisdictionId} />
          <Button variant="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save site'}
          </Button>
          {save.error ? (
            <span className="text-xs text-[var(--color-critical)]">
              {save.error instanceof Error ? save.error.message : String(save.error)}
            </span>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
