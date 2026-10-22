// Spec 100, REQ-1
import { dirname, sep } from 'node:path';

export interface DiscRoot {
  root: string;
  playlists: string[];
  clips: string[];
}

function splitPath(filePath: string): string[] {
  return filePath.split(sep === '\\' ? /[\\/]/ : '/');
}

export function findDiscRoots(filePaths: string[]): DiscRoot[] {
  const roots = new Map<string, DiscRoot>();

  for (const filePath of filePaths) {
    const parts = splitPath(filePath);
    if (parts.length < 4) continue;
    const name = parts[parts.length - 1].toLowerCase();
    const folder = parts[parts.length - 2];
    const bdmv = parts[parts.length - 3];
    if (bdmv.toUpperCase() !== 'BDMV') continue;

    const isPlaylist = folder.toUpperCase() === 'PLAYLIST' && name.endsWith('.mpls');
    const isClip = folder.toUpperCase() === 'STREAM' && name.endsWith('.m2ts');
    if (!isPlaylist && !isClip) continue;

    const root = dirname(dirname(dirname(filePath)));
    const entry = roots.get(root) ?? { root, playlists: [], clips: [] };
    (isPlaylist ? entry.playlists : entry.clips).push(filePath);
    roots.set(root, entry);
  }

  return [...roots.values()]
    .filter((entry) => entry.playlists.length > 0 && entry.clips.length > 0)
    .sort((a, b) => a.root.localeCompare(b.root));
}
