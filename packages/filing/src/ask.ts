import type { GraphAnswer, GraphDigest, GraphReference } from '@tangible/types';

/**
 * The code half of ask-the-graph's answer: reference validation.
 *
 * The model is told to cite only ids that appear in the digest, but a told
 * rule is not an enforced one — a reference the record cannot back would
 * render as a link into nothing, which is worse than no link. So before the
 * answer is stored, every reference is checked against the digest it was
 * drafted from: asset ids against the asset list, site ids against the season
 * scoreboard. Dropping one is not silent — the answer's own limits say it
 * happened, because a pruned citation is a fact about the answer's
 * reliability that the reader is owed.
 */

function key(ref: GraphReference): string {
  return `${ref.kind}|${ref.id ?? ''}`;
}

export function sanitizeAnswer(digest: GraphDigest, answer: GraphAnswer): GraphAnswer {
  const assetIds = new Set(digest.assets.map((asset) => asset.id));
  const siteIds = new Set(digest.season.sites.map((site) => site.locationId));

  const references: GraphReference[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const ref of answer.references) {
    let valid: GraphReference | null = null;
    if (ref.kind === 'asset') {
      valid = ref.id !== null && assetIds.has(ref.id) ? ref : null;
    } else if (ref.kind === 'site') {
      valid = ref.id !== null && siteIds.has(ref.id) ? ref : null;
    } else {
      // The two singleton screens carry no id, whatever the model attached.
      valid = { ...ref, id: null };
    }
    if (!valid) {
      dropped += 1;
      continue;
    }
    if (seen.has(key(valid))) continue;
    seen.add(key(valid));
    references.push(valid);
  }

  if (dropped === 0) return { ...answer, references };
  return {
    ...answer,
    references,
    limits: [
      ...answer.limits,
      dropped === 1
        ? 'One reference the draft cited did not match anything in the record and was dropped.'
        : `${dropped} references the draft cited did not match anything in the record and were dropped.`,
    ],
  };
}
