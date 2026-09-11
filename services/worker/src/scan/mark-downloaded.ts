import { join, normalize } from 'node:path';
import type { ScannedFile } from './scan-folder';

// Narrows an inventory to files a torrent client actually wrote content for
// (REQ-3/REQ-4). `downloadedFiles` is `null` when the answer is unknowable —
// no torrent client to ask, an unrecognised hash, an unreachable client —
// and `null` must read as "no narrowing", never as "nothing was downloaded".
// An empty array is a real answer ("the client answered, nothing is
// downloadable") and must flag every file `false`, not be treated as `null`.
//
// Pure: no `fs`, no logging, no GraphQL call. `downloadedFiles` entries are
// relative to `downloadPath`; the worker owns the join against the absolute
// path `scanFolder` produced. Both sides are normalised so a `./`-prefixed
// or double-slashed entry from the client still matches.
export type InventoriedFile = ScannedFile & { isDownloaded: boolean };

export function markDownloaded(
  files: ScannedFile[],
  downloadedFiles: string[] | null,
  downloadPath: string,
): InventoriedFile[] {
  if (downloadedFiles === null) {
    return files.map((file) => ({ ...file, isDownloaded: true }));
  }

  const downloadedPaths = new Set(downloadedFiles.map((entry) => normalize(join(downloadPath, entry))));

  return files.map((file) => ({
    ...file,
    isDownloaded: downloadedPaths.has(normalize(file.filePath)),
  }));
}
