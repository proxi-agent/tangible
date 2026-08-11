import { SEGMENT_LIST } from '@tangible/types';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The segment vocabulary, so the UI never hardcodes labels or caveats.
 *
 * Next resolves static segments ahead of dynamic ones, so this is reached
 * before `[id]` rather than being read as a jurisdiction called "segments".
 */
export function GET(): Promise<Response> {
  return handle(async () => SEGMENT_LIST);
}
