'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { PortalRole } from '@tangible/types';
import { api } from '@/lib/api';
import { Button, Field, Select, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Who at the client can sign in, and what they can do once they have.
 *
 * The portal used to ask a reader which business they were. This card is what
 * replaced that question: access is something the firm grants to a named
 * address, and the session is what carries it afterwards. Two things it says
 * out loud rather than leaving to be inferred —
 *
 *   - **Invited is not signed in.** A grant with no claim date is somebody who
 *     was sent an invitation and never came, and that is the state the firm
 *     actually needs to see: it is the difference between "they have not read
 *     the report" and "they cannot".
 *   - **Read-only means read-only.** A viewer can open the report and forward
 *     it. Sending a register and answering a screening question both end up on
 *     a signed rendition, so both need the other role.
 */
export function PortalAccessCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PortalRole>('admin');

  const grants = useQuery({
    queryKey: ['portal-users', clientId],
    queryFn: () => api.portalUsers(clientId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['portal-users', clientId] });
  };

  const grant = useMutation({
    mutationFn: () => api.grantPortalAccess(clientId, { email: email.trim(), role }),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
  });

  const change = useMutation({
    mutationFn: (input: { grantId: string; role: PortalRole }) =>
      api.updatePortalAccess(clientId, input.grantId, { role: input.role }),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) => api.revokePortalAccess(clientId, grantId),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader
        title="Portal access"
        description={`Who at ${clientName} can sign in to see their own report, send files, and answer the questions we ask.`}
        help="Granting access emails an invitation to set a password. Access is per address and reaches one business only — the same address cannot be given a second client's portal."
        icon={KeyRound}
        action={
          <Link
            href={`/portal?client=${clientId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            <ExternalLink size={13} strokeWidth={2} />
            View their portal
          </Link>
        }
      />

      <form
        className="flex flex-wrap items-end gap-2 border-b border-[var(--color-hairline)] px-5 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) grant.mutate();
        }}
      >
        <Field label="Email" className="min-w-56 flex-1">
          <TextInput
            type="email"
            value={email}
            placeholder="controller@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Can">
          <Select
            className="w-44"
            value={role}
            onChange={(e) => setRole(e.target.value as PortalRole)}
          >
            <option value="admin">Send files and answer</option>
            <option value="viewer">Read the report only</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={!email.trim() || grant.isPending}>
          {grant.isPending ? 'Inviting…' : 'Grant access'}
        </Button>
      </form>

      {grant.error ? (
        <div className="px-5 pt-4">
          <ErrorState error={grant.error} />
        </div>
      ) : null}

      {grants.isLoading ? (
        <div className="px-5 py-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : grants.error ? (
        <div className="px-5 py-5">
          <ErrorState error={grants.error} />
        </div>
      ) : (grants.data?.length ?? 0) === 0 ? (
        <EmptyState title="Nobody can sign in yet">
          Until somebody here is given access, this client&rsquo;s portal exists and nobody can
          reach it.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {grants.data!.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.email}</p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {row.claimedAt
                    ? `First signed in ${new Date(row.claimedAt).toLocaleDateString()}`
                    : 'Invited — has not signed in yet'}
                  {row.invitedBy ? ` · by ${row.invitedBy}` : ''}
                </p>
              </div>
              {row.claimedAt ? null : <Badge tone="warning">invited</Badge>}
              <Select
                compact
                className="w-44"
                value={row.role}
                disabled={change.isPending}
                onChange={(e) =>
                  change.mutate({ grantId: row.id, role: e.target.value as PortalRole })
                }
              >
                <option value="admin">Send files and answer</option>
                <option value="viewer">Read the report only</option>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                title="Revoke access"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(row.id)}
              >
                <Trash2 size={14} strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
