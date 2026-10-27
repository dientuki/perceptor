// Spec 107, T004
export type SubtitleCandidate = {
  id: string;
  release: string;
  fileCount: number;
  hearingImpaired: boolean;
  foreignPartsOnly: boolean;
  machineTranslated: boolean;
  aiTranslated: boolean;
  hashMatch: boolean;
  downloadCount: number;
  // Spec 107, REQ-14
  fileName?: string;
};

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
  candidates: SubtitleCandidate[],
  releaseName: string,
): SubtitleCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.fileCount === 1 &&
        !candidate.foreignPartsOnly &&
        !candidate.machineTranslated &&
        !candidate.aiTranslated,
    )
    .map((candidate, index) => ({
      candidate,
      index,
      similarity: releaseSimilarity(candidate.release, releaseName),
    }))
    .sort(
      (a, b) =>
        Number(b.candidate.hashMatch) - Number(a.candidate.hashMatch) ||
        b.similarity - a.similarity ||
        Number(a.candidate.hearingImpaired) -
          Number(b.candidate.hearingImpaired) ||
        b.candidate.downloadCount - a.candidate.downloadCount ||
        a.index - b.index,
    )
    .slice(0, MAX_CANDIDATES_PER_LANGUAGE)
    .map(({ candidate }) => candidate);
}
