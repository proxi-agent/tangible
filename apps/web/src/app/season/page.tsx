'use client';

import { PracticeBoard } from '@/components/workspace/practice-board';

/**
 * The season, across every client.
 *
 * Its own route rather than a card on the clients list, because it is not about
 * clients. It is about returns and dates, and the client is a column on it.
 */
export default function SeasonPage() {
  return <PracticeBoard />;
}
