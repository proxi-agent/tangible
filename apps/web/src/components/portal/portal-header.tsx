'use client';

import type { ReactNode } from 'react';
import { usePortal } from '@/components/portal/portal-context';
import { Select } from '@/components/ui/controls';
import { PageHeader } from '@/components/ui/primitives';

/**
 * The same header on every portal page: whose account this is, and which
 * season is on screen.
 *
 * The season picker rides in the header rather than sitting on one page,
 * because every figure under this wing is a figure about one tax year and a
 * reader who changed years on the documents page would otherwise carry a
 * silent assumption onto the results page.
 */
export function PortalHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const { detail, seasons, engagement, setEngagementId } = usePortal();

  return (
    <PageHeader
      eyebrow={detail.client.name}
      title={title}
      description={description}
      meta={
        seasons.length > 1 && engagement ? (
          <label className="flex items-center gap-1.5">
            <span className="eyebrow">Tax year</span>
            <Select
              compact
              className="w-24"
              value={engagement.id}
              onChange={(e) => setEngagementId(e.target.value)}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.taxYear}
                </option>
              ))}
            </Select>
          </label>
        ) : null
      }
      // The "Not <name>?" escape hatch left with the identity picker. A reader
      // signed in as this business has nothing to switch to, and a preparer
      // previewing has the banner and the back button.
      actions={actions}
    />
  );
}
