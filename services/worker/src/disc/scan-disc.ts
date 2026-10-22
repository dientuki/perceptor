import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { InventoriedFile } from '../scan/mark-downloaded';
import type { Match } from '../scan/select-matches';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS } from '../i18n/error-keys';
import type { DiscRoot } from './find-disc';
import { parseMpls } from './mpls';
import { selectPlaylist, type PlaylistCandidate } from './select-playlist';

export interface DiscScan {
  files: InventoriedFile[];
  matches: Match[];
  outcome: 'match' | 'none';
  playlistCount: number;
}

// Spec 100, REQ-2 REQ-3 REQ-4 REQ-12
export async function scanDisc(disc: DiscRoot, files: InventoriedFile[]): Promise<DiscScan> {
  const byPath = new Map(files.map((file) => [file.filePath, file]));
  const clipsByName = new Map<string, InventoriedFile>();
  for (const clipPath of disc.clips) {
    const clip = byPath.get(clipPath);
    if (clip) clipsByName.set(basename(clipPath, extname(clipPath)).toLowerCase(), clip);
  }

  const candidates: PlaylistCandidate[] = [];
  for (const playlistPath of disc.playlists) {
    const name = basename(playlistPath);
    const unplayable: PlaylistCandidate = { name, items: [], entryMarkCount: 0, playable: false };
    if (!byPath.get(playlistPath)?.isDownloaded) {
      candidates.push(unplayable);
      continue;
    }
    try {
      const parsed = parseMpls(await readFile(playlistPath));
      const playable = parsed.items.every((item) => {
        const clip = clipsByName.get(item.clipName.toLowerCase());
        return clip !== undefined && clip.isDownloaded;
      });
      candidates.push({ name, items: parsed.items, entryMarkCount: parsed.entryMarkCount, playable });
    } catch {
      candidates.push(unplayable);
    }
  }

  const selection = selectPlaylist(candidates);

  if (selection.kind === 'ambiguous') {
    const params = { playlists: selection.playlists.join(', ') };
    throw new KeyedError(
      ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS,
      renderMessage(ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS, params),
      params,
    );
  }

  if (selection.kind === 'match') {
    const winnerPath = disc.playlists.find((path) => basename(path) === selection.playlist.name)!;
    return {
      files: files.map((file) => ({ ...file, isVideo: file.filePath === winnerPath })),
      matches: [{ filePath: winnerPath, seasonNumber: null, episodeNumber: null }],
      outcome: 'match',
      playlistCount: disc.playlists.length,
    };
  }

  const clipPaths = new Set(disc.clips);
  return {
    files: files.map((file) => ({ ...file, isVideo: clipPaths.has(file.filePath) })),
    matches: [],
    outcome: 'none',
    playlistCount: disc.playlists.length,
  };
}
