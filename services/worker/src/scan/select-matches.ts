import type { InventoriedFile } from './mark-downloaded';
import { parseEpisode } from './parse-episode';

export type SelectMatchesMode = { kind: 'single' } | { kind: 'season' };

export type Match = {
  filePath: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

// Spec 052, REQ-3
export function selectMatches(files: InventoriedFile[], mode: SelectMatchesMode): Match[] {
  const videos = files.filter((file) => file.isVideo && file.isDownloaded);

  if (mode.kind === 'single') {
    if (videos.length === 0) return [];

    const largest = videos.reduce((biggest, file) => (file.size > biggest.size ? file : biggest));

    return [{ filePath: largest.filePath, seasonNumber: null, episodeNumber: null }];
  }

  const bestByEpisode = new Map<string, InventoriedFile & { seasonNumber: number; episodeNumber: number }>();

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
