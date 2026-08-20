import { handle } from '@/lib/route';
import { farFileDto, fetchFarFile } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { fileId } = await params;
    return farFileDto(await fetchFarFile(fileId));
  });
}
