'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ClientStatusBadge } from '@/components/workspace/badges';
import { FilingProfileCard } from '@/components/workspace/filing-profile-card';
import { Button, Field, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

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
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      created {new Date(engagement.createdAt).toLocaleDateString()}
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
            description="Where the property sits on January 1. Each situs is its own account and rendition, so a multi-site client is several filings."
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
                <li key={location.id} className="flex items-center gap-2 px-5 py-3 text-sm">
                  <MapPin size={14} strokeWidth={2} className="text-[var(--color-ink-muted)]" />
                  <span className="font-medium">{location.label}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {[location.city, location.stateCode].filter(Boolean).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <FilingProfileCard clientId={clientId} clientName={client.name} profile={filingProfile} />
    </div>
  );
}
