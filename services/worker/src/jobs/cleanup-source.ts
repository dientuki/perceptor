import { dirname } from 'node:path';
import { rm, rmdir } from 'node:fs/promises';
import { fetchGraphQL } from '../api/graphql-client';
import { isInsideRoot } from '../paths/is-inside-root';

export type CleanupInput = {
  mediaSourceId: number;
  sourceKind: string; // 'TORRENT_SEARCH' | 'TORRENT_FILE' | 'LOCAL_FILE' | 'LOCAL_FOLDER'
  infoHash: string | null;
  downloadPath: string | null;
  downloadsRoot: string;
  inputFilePath: string;
  removeTorrent: boolean;
  deleteInputFile: boolean;
  deleteDownloadPath: boolean;
};

// Spec 012, REQ-10 REQ-11
export async function cleanupSource(input: CleanupInput): Promise<void> {
  const {
    mediaSourceId,
    sourceKind,
    infoHash,
    downloadPath,
    downloadsRoot,
    inputFilePath,
    removeTorrent,
    deleteInputFile,
    deleteDownloadPath,
  } = input;

  // Spec 013, REQ-8
  if (removeTorrent && infoHash) {
    try {
      await fetchGraphQL(
        `mutation ($id: Int!) { downloadRemove(mediaSourceId: $id, deleteFiles: false) }`,
        { id: mediaSourceId },
      );
    } catch (err) {
      console.error(`[cleanup] mediaSource ${mediaSourceId}: downloadRemove failed:`, err);
    }
  }

  // Spec 013, REQ-8 REQ-9
  if (deleteInputFile) {
    if (!isInsideRoot(downloadsRoot, inputFilePath)) {
      console.error(
        `[cleanup] mediaSource ${mediaSourceId}: inputFilePath ${inputFilePath} is not inside downloadsRoot ${downloadsRoot} — not deleting`,
      );
    } else {
      try {
        await rm(inputFilePath, { force: true });
      } catch (err) {
        console.error(`[cleanup] mediaSource ${mediaSourceId}: could not delete ${inputFilePath}:`, err);
      }
    }
  }

  if (!deleteDownloadPath) {
    return;
  }

  if (!downloadPath) {
    console.log(`[cleanup] mediaSource ${mediaSourceId}: no downloadPath, nothing to delete`);
    return;
  }

  // Spec 012, REQ-12
  if (!isInsideRoot(downloadsRoot, downloadPath)) {
    console.error(
      `[cleanup] mediaSource ${mediaSourceId}: downloadPath ${downloadPath} is not inside downloadsRoot ${downloadsRoot} — deleting nothing`,
    );
    return;
  }

  try {
    if (sourceKind === 'LOCAL_FILE') {
      // A tus upload: one file staged in its own directory
      // (<downloads>/imports/<uploadId>/<file>). Delete the file, then try to
      // remove the now-empty staging directory — non-recursive on purpose:
      // if something else still lives in there, rmdir fails with ENOTEMPTY
      // and that failure is swallowed, leaving the directory (and whatever
      // else is in it) untouched rather than recursively wiping it.
      await rm(downloadPath, { force: true });
      await rmdir(dirname(downloadPath)).catch((err) => {
        console.log(
          `[cleanup] mediaSource ${mediaSourceId}: could not rmdir ${dirname(downloadPath)} (probably not empty):`,
          err instanceof Error ? err.message : err,
        );
      });
    } else {
      // TORRENT_SEARCH, TORRENT_FILE, LOCAL_FOLDER: the whole download
      // directory (or, for a single-file torrent, the file itself) is owned
      // by this source alone, so a recursive delete is safe.
      await rm(downloadPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[cleanup] mediaSource ${mediaSourceId}: could not delete ${downloadPath}:`, err);
  }
}
