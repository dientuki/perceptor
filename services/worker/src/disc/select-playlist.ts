// Spec 100, REQ-2 REQ-13 REQ-15
import type { MplsPlayItem } from './mpls';

export const TIE_WINDOW_TICKS = 45_000;

export interface PlaylistCandidate {
  name: string;
  items: MplsPlayItem[];
  entryMarkCount: number;
  playable: boolean;
}

export type PlaylistSelection =
  | { kind: 'match'; playlist: PlaylistCandidate }
  | { kind: 'ambiguous'; playlists: string[] }
  | { kind: 'none' };

function durations(candidate: PlaylistCandidate): { total: number; distinct: number } {
  let total = 0;
  const longestPerClip = new Map<string, number>();
  for (const item of candidate.items) {
    const length = Math.max(0, item.outTicks - item.inTicks);
    total += length;
    longestPerClip.set(item.clipName, Math.max(longestPerClip.get(item.clipName) ?? 0, length));
  }
  let distinct = 0;
  for (const length of longestPerClip.values()) distinct += length;
  return { total, distinct };
}

export function selectPlaylist(candidates: PlaylistCandidate[]): PlaylistSelection {
  const scored = candidates
    .filter((candidate) => candidate.playable && candidate.items.length > 0)
    .map((candidate) => ({ candidate, ...durations(candidate) }))
    .filter(({ total, distinct }) => total > 0 && distinct >= total / 2);

  if (scored.length === 0) return { kind: 'none' };

  const longest = Math.max(...scored.map((entry) => entry.total));
  const tied = scored.filter((entry) => longest - entry.total <= TIE_WINDOW_TICKS);
  if (tied.length === 1) return { kind: 'match', playlist: tied[0].candidate };

  const withMarks = tied.filter((entry) => entry.candidate.entryMarkCount > 0);
  const pool = withMarks.length > 0 ? withMarks : tied;
  const mostMarks = Math.max(...pool.map((entry) => entry.candidate.entryMarkCount));
  const finalists = pool.filter((entry) => entry.candidate.entryMarkCount === mostMarks);
  if (finalists.length === 1) return { kind: 'match', playlist: finalists[0].candidate };

  return { kind: 'ambiguous', playlists: finalists.map((entry) => entry.candidate.name).sort() };
}
