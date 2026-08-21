'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ClientLocation, EngagementSite } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, plural } from '@/lib/format';
import { Button, Select } from '@/components/ui/controls';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Where this register says its property sits, and where we have decided it does.
 *
 * The register's location column is the client's own shorthand, and it is
 * usually the only situs evidence in the file. This card turns each distinct
 * string into one decision rather than a thousand, because that is the number
 * of decisions there actually are.
 *
 * It matters more than a data-entry screen suggests: property is assessed where
 * it stood on January 1, districts open one account per business location, and
 * so a register spanning two sites is two returns. That fact is invisible until
 * somebody resolves the sites, which is why this sits with the pipeline rather
 * than in a settings screen.
 */
export function SitesCard({ clientId, engagementId }: { clientId: string; engagementId: string }) {
  const queryClient = useQueryClient();
  const sites = useQuery({
    queryKey: ['sites', engagementId],
    queryFn: () => api.sites(engagementId),
  });
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId),
  });

  const settled = () => {
    void queryClient.invalidateQueries({ queryKey: ['sites', engagementId] });
    void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    // The rendition reads situs off these placements, so the draft is stale the
    // moment one moves. Keyed by engagement only — the draft is cached per basis,
    // per agent flag and per site, and a placement changes every one of them.
    void queryClient.invalidateQueries({ queryKey: ['engagement-rendition', engagementId] });
    // And a placement can be the moment this engagement becomes two returns
    // rather than one, which is the picker on the filing screen and the board
    // on the engagement page.
    void queryClient.invalidateQueries({ queryKey: ['engagement-returns', engagementId] });
    void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
  };

  const place = useMutation({
    mutationFn: (body: { text: string | null; locationId: string }) =>
      api.placeSite(engagementId, body),
    onSuccess: settled,
  });

  // Creating from the register's own words, then placing in the same gesture.
  // The client already named this site; making somebody retype it to agree
  // would be asking them to prove they read it.
  const createAndPlace = useMutation({
    mutationFn: async (text: string) => {
      const location = await api.createLocation(clientId, { label: text });
      return api.placeSite(engagementId, { text, locationId: location.id });
    },
    onSuccess: settled,
  });

  if (sites.error) return <ErrorState error={sites.error} />;
  if (sites.isLoading || !sites.data) return <Skeleton className="h-32 w-full" />;

  const rows = sites.data;
  if (rows.length === 0) return null;

  const locations = client.data?.locations ?? [];
  const resolved = new Set(rows.flatMap((s) => s.placements.map((p) => p.locationId)));
  const unplaced = rows.reduce((n, s) => n + s.unplacedCount, 0);
  const failure = place.error ?? createAndPlace.error;
  const busy = place.isPending || createAndPlace.isPending;

  return (
    <Card>
      <CardHeader
        title="Sites"
        description="What the register calls each place, and where we have decided it is."
        help="Property is assessed where it stood on January 1 (Tax Code 21.02), so placement decides which district values each asset — and how many returns there are."
        action={
          unplaced > 0 ? (
            <span className="text-xs text-[var(--color-warning)]">
              {count(unplaced)} {plural(unplaced, 'asset')} unplaced
            </span>
          ) : null
        }
      />

      {resolved.size > 1 ? (
        <p className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
          This register spans {count(resolved.size)} sites, which is {count(resolved.size)}{' '}
          renditions rather than one. Districts assess per business location and each situs gets its
          own account, so filing them on a single form would put one site&rsquo;s property in
          another&rsquo;s taxing units.
        </p>
      ) : null}

      {failure ? (
        <p className="px-5 pt-3 text-xs text-[var(--color-critical)]">
          {failure instanceof Error ? failure.message : String(failure)}
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--color-hairline)]">
        {rows.map((site) => (
          <SiteRow
            // Prefixed rather than the bare text: a register is free to call a
            // site "no-site", and the group for rows that named none is a
            // different row from that one.
            key={site.text === null ? 'group:none' : `text:${site.text}`}
            site={site}
            locations={locations}
            busy={busy}
            onPlace={(locationId) => place.mutate({ text: site.text, locationId })}
            onCreate={() => {
              if (site.text) createAndPlace.mutate(site.text);
            }}
          />
        ))}
      </ul>
    </Card>
  );
}

function SiteRow({
  site,
  locations,
  busy,
  onPlace,
  onCreate,
}: {
  site: EngagementSite;
  locations: ClientLocation[];
  busy: boolean;
  onPlace: (locationId: string) => void;
  onCreate: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const placed = site.placements.length > 0 && site.unplacedCount === 0;
  const split = site.placements.length > 1;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-56 flex-1">
        <p className="text-sm font-medium">
          {site.text ?? (
            <span className="text-[var(--color-ink-secondary)] italic">
              No location on the register
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {count(site.assetCount)} {plural(site.assetCount, 'asset')}, {money(site.totalCost)}
          {site.disposedCount > 0 ? (
            <>
              {', '}
              {count(site.disposedCount)} disposed and not on the return
            </>
          ) : null}
        </p>
      </div>

      {placed && !moving ? (
        <div className="flex items-center gap-2">
          <MapPin size={14} strokeWidth={2} className="text-[var(--color-ink-muted)]" />
          <span className="text-sm">
            {split
              ? site.placements.map((p) => `${p.label} (${p.assetCount})`).join(', ')
              : site.placements[0]!.label}
          </span>
          <Button onClick={() => setMoving(true)} disabled={busy}>
            Move
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {split ? (
            <span className="text-xs text-[var(--color-warning)]">
              split across {count(site.placements.length)}
            </span>
          ) : null}
          <Select
            value=""
            aria-label={`Place ${site.text ?? 'the unnamed group'}`}
            disabled={busy || locations.length === 0}
            onChange={(e) => {
              if (!e.target.value) return;
              setMoving(false);
              onPlace(e.target.value);
            }}
            className="h-8 text-xs"
          >
            <option value="">{locations.length === 0 ? 'No locations yet' : 'Place at...'}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </Select>
          {site.text ? (
            <Button variant="primary" onClick={onCreate} disabled={busy}>
              <Plus size={14} strokeWidth={2} />
              New from this name
            </Button>
          ) : null}
          {moving ? (
            <Button onClick={() => setMoving(false)} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
