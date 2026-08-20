/**
 * A digest of what an analysis was computed from.
 *
 * Committed with the set and recomputed on read, so a set can say it is behind
 * the workspace it came out of. Deliberately over the *inputs* rather than the
 * output: a report whose numbers happen not to have changed is still a report
 * computed before three assets were reclassified, and a reader deciding whether
 * to send it wants to know that. Hashing the output would call that fresh.
 *
 * Readable rather than hashed, for the reason the asset natural keys are: when
 * a set is flagged stale and nobody can see why, the answer should be in the
 * value itself. The parts are counts and timestamps, so it stays short.
 */
export function sourceFingerprint(parts: Array<string | number | Date | null | undefined>): string {
  return parts
    .map((part) => {
      if (part === null || part === undefined) return '~';
      if (part instanceof Date) return part.toISOString();
      return String(part);
    })
    .join('|');
}
