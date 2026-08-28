'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PortalSettings } from '@tangible/types';
import { api } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * How much of a finding you want to see when you open one.
 *
 * A control rather than a setting we chose for them: a controller with an
 * afternoon wants the high-confidence rows and nothing else, and the same
 * person in March wants everything. It is stored against the business, not the
 * browser, so it holds across devices and a colleague opening the same finding
 * sees the same starting point.
 *
 * It seeds the filter and never hides anything. The chips it ticks are visible
 * and one click from being cleared — a floor applied silently on the server
 * would produce a page whose totals nobody could reconcile against the report
 * it came from.
 */
export function ConfidenceFloor({
  clientId,
  settings,
  disabled,
}: {
  clientId: string;
  settings: PortalSettings | undefined;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (confidenceFloor: 'high' | 'medium' | 'low') =>
      api.updatePortalSettings(clientId, { confidenceFloor }),
    onSuccess: (saved) => queryClient.setQueryData(['portal-settings', clientId], saved),
  });

  return (
    <label className="flex items-center gap-2 text-xs text-[var(--color-ink-secondary)]">
      Open findings at
      <InfoTip
        title="Default confidence"
        content="Which rows are selected when you open a finding. It only sets the filter — nothing is hidden, and clearing the confidence chips always shows every row."
        size={12}
      />
      <Select
        compact
        aria-label="Default confidence when a finding is opened"
        value={settings?.confidenceFloor ?? 'low'}
        disabled={disabled || save.isPending}
        onChange={(event) => save.mutate(event.target.value as 'high' | 'medium' | 'low')}
        className="w-36"
      >
        <option value="high">High only</option>
        <option value="medium">High and medium</option>
        <option value="low">Everything</option>
      </Select>
    </label>
  );
}
