import type { ScannedFile } from './scan-folder';
import { parseEpisode } from './parse-episode';

export type SelectMatchesMode = { kind: 'single' } | { kind: 'season' };

export type Match = {
  filePath: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

// Two selection rules, kept pure and separate from I/O (see scan-folder.ts's
// header comment). `single` is today's film/episode rule moved verbatim: the
// largest video file wins, filenames are never parsed, so a bystander
// "SxxEyy" in the name of a single-episode download cannot redirect it.
// `season` parses every video file's base name and keeps the largest file
// per resolved episode; anything unparseable, or a duplicate loser, is
// simply absent from the result — the caller logs the gap and `api` derives
// `hasUnmatchedFiles` from the difference against `files`.
export function selectMatches(files: ScannedFile[], mode: SelectMatchesMode): Match[] {
  const videos = files.filter((file) => file.isVideo);

  if (mode.kind === 'single') {
    if (videos.length === 0) return [];

    const largest = videos.reduce((biggest, file) => (file.size > biggest.size ? file : biggest));

    return [{ filePath: largest.filePath, seasonNumber: null, episodeNumber: null }];
  }

  const bestByEpisode = new Map<string, ScannedFile & { seasonNumber: number; episodeNumber: number }>();

  for (const file of videos) {
    const parsed = parseEpisode(file.fileName);
    if (!parsed) continue;

    const key = `${parsed.seasonNumber}x${parsed.episodeNumber}`;
    const current = bestByEpisode.get(key);
    if (!current || file.size > current.size) {
      bestByEpisode.set(key, { ...file, seasonNumber: parsed.seasonNumber, episodeNumber: parsed.episodeNumber });
    }
  }

  return [...bestByEpisode.values()].map((file) => ({
    filePath: file.filePath,
    seasonNumber: file.seasonNumber,
    episodeNumber: file.episodeNumber,
  }));
}
