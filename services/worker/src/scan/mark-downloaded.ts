import { join, normalize } from 'node:path';
import type { ScannedFile } from './scan-folder';

// Spec 052, REQ-3 REQ-4
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
