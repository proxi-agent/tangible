'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ClientListItem } from '@tangible/types';
import { api } from '@/lib/api';
import { count } from '@/lib/format';
import { ClientStatusBadge } from '@/components/workspace/badges';
import { Button, TextInput } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/data-table';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const COLUMNS: ColumnDef<ClientListItem, unknown>[] = [
  {
    id: 'name',
    header: 'Client',
    accessorFn: (row) => row.name,
    cell: ({ row }) => (
      <Link
        href={`/clients/${row.original.id}`}
        className="font-medium text-[var(--color-ink)] hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (row) => row.status,
    cell: ({ row }) => <ClientStatusBadge status={row.original.status} />,
  },
  {
    id: 'engagements',
    header: 'Engagements',
    accessorFn: (row) => row.engagementCount,
    cell: ({ row }) => count(row.original.engagementCount),
    meta: { align: 'right' as const },
  },
  {
    id: 'created',
    header: 'Created',
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => dateFormat.format(new Date(row.original.createdAt)),
    meta: { align: 'right' as const },
  },
];

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  const [name, setName] = useState('');
  const [needle, setNeedle] = useState('');
  const create = useMutation({
    mutationFn: () => api.createClient({ name: name.trim(), status: 'prospect' }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Clients"
          description="The companies whose fixed asset registers we ingest — every engagement, upload, and asset hangs off a client."
          action={
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <TextInput
                placeholder="New client name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-56"
              />
              <Button variant="primary" type="submit" disabled={!name.trim() || create.isPending}>
                <Plus size={15} strokeWidth={2} />
                Add
              </Button>
            </form>
          }
        />
        {create.error ? (
          <p className="px-5 pt-3 text-xs text-[var(--color-critical)]">
            {create.error instanceof Error ? create.error.message : String(create.error)}
          </p>
        ) : null}
        {/* Only once the list is long enough to lose a name in. A search box
            over four rows is furniture; over forty it is how the page works. */}
        {(data?.length ?? 0) > 5 ? (
          <div className="border-b border-[var(--color-hairline)] px-5 py-3">
            <TextInput
              placeholder="Find a client…"
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              className="h-8 w-64"
            />
          </div>
        ) : null}
        {error ? (
          <ErrorState error={error} />
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : (
          <DataTable
            columns={COLUMNS}
            data={(data ?? []).filter((row) =>
              row.name.toLowerCase().includes(needle.trim().toLowerCase()),
            )}
            getRowId={(row) => row.id}
            empty={
              needle.trim()
                ? { title: 'No client matches', children: `Nothing on the book matches “${needle.trim()}”.` }
                : {
                    title: 'No clients yet',
                    children:
                      'Add the first prospect above. A client starts as a name; locations and engagements come next.',
                  }
            }
          />
        )}
      </Card>
    </div>
  );
}
