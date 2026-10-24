import { RemoteSubtitleCandidate } from '@/clients/media-server/types';

// Spec 103, REQ-8
export const MAX_CANDIDATES_PER_LANGUAGE = 3;

const tokens = (name: string): Set<string> =>
  new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );

// Spec 103, REQ-8
export function releaseSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;

  return shared / (left.size + right.size - shared);
}

// Spec 103, REQ-8
export function filterAndRank(
  candidates: RemoteSubtitleCandidate[],
  releaseName: string,
): RemoteSubtitleCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.format.toLowerCase() === 'srt' &&
        !candidate.isForced &&
        !candidate.isMachineTranslated &&
        !candidate.isAiTranslated,
    )
    .map((candidate, index) => ({
      candidate,
      index,
      similarity: releaseSimilarity(candidate.name, releaseName),
    }))
    .sort(
      (a, b) =>
        Number(b.candidate.isHashMatch) - Number(a.candidate.isHashMatch) ||
        b.similarity - a.similarity ||
        Number(a.candidate.isHearingImpaired) -
          Number(b.candidate.isHearingImpaired) ||
        b.candidate.downloadCount - a.candidate.downloadCount ||
        a.index - b.index,
    )
    .slice(0, MAX_CANDIDATES_PER_LANGUAGE)
    .map(({ candidate }) => candidate);
}
