import {
  DeleteClientRequestSchema,
  type DeletionPreview,
  type DeletionReceipt,
} from '@tangible/types';
import { deleteClient, previewClientDeletion } from '@/lib/client-deletion';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The bucket sweep is one round trip per file on the local-disk fallback. */
export const maxDuration = 300;

type Params = { params: Promise<{ clientId: string }> };

export function GET(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<{ preview: DeletionPreview }> => {
    const { clientId } = await params;
    return { preview: await previewClientDeletion(clientId) };
  });
}

export function POST(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<{ receipt: DeletionReceipt }> => {
    const { clientId } = await params;
    const body = DeleteClientRequestSchema.parse(await request.json());
    return { receipt: await deleteClient(clientId, body.confirmName) };
  });
}
