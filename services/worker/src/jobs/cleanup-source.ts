import { dirname } from 'node:path';
import { rm, rmdir } from 'node:fs/promises';
import { fetchGraphQL } from '../api/graphql-client';
import { isInsideRoot } from '../paths/is-inside-root';

// Subconjunto de EncodeJobDetails (services/worker/src/jobs/encode.job.ts) —
// mismo patrón que paths/build-output-path.ts's OutputPathInput: un tipo
// local, angosto, en vez de importar la forma completa de la query.
export type CleanupInput = {
  mediaSourceId: number;
  sourceKind: string; // 'TORRENT_SEARCH' | 'TORRENT_FILE' | 'LOCAL_FILE' | 'LOCAL_FOLDER'
  infoHash: string | null;
  downloadPath: string | null;
  downloadsRoot: string;
};

// Post-encode cleanup for the source that produced a completed file (REQ-10).
// Called from encode.job.ts AFTER its try/catch has already reported
// encodeCompleted, wrapped in its own try there too — this function itself
// must never throw, no matter what fails inside it.
//
// Why swallowing here is correct (REQ-11), against the rule in
// services/worker/CLAUDE.md § Errors must not be swallowed: that rule exists
// because a swallowed error must never let a job report success it didn't
// earn. Here it's the inverse danger — the encode already succeeded and
// encodeCompleted has already been reported; a cleanup failure (the torrent
// client unreachable, a permission error, a busy file) must not be allowed to
// travel back up and flip a finished job to ERROR. So every failure in this
// function is caught and logged with the `[cleanup]` prefix and the
// mediaSource id, never rethrown.
export async function cleanupSource(input: CleanupInput): Promise<void> {
  const { mediaSourceId, sourceKind, infoHash, downloadPath, downloadsRoot } = input;

  // A torrent must be removed from the client whatever else happens, and
  // before anything on disk moves so the client releases its file handles
  // first. Guarded on infoHash (not sourceKind): downloadRemove itself
  // already answers "omitido: ... no es un torrent" for a source with none,
  // but calling it unconditionally would be a wasted round-trip for every
  // local file — the mutation call and the filesystem branch below are
  // deliberately guarded on two different things (see worker/plan.md).
  if (infoHash) {
    try {
      await fetchGraphQL(
        `mutation ($id: Int!) { downloadRemove(mediaSourceId: $id) }`,
        { id: mediaSourceId },
      );
    } catch (err) {
      console.error(`[cleanup] mediaSource ${mediaSourceId}: downloadRemove falló:`, err);
    }
  }

  if (!downloadPath) {
    console.log(`[cleanup] mediaSource ${mediaSourceId}: sin downloadPath, nada que borrar`);
    return;
  }

  // REQ-12: never delete anything outside the downloads root. downloadsRoot
  // arriving empty/undefined (the NFR-3 drift) must refuse, never pass —
  // isInsideRoot already returns false for that case.
  if (!isInsideRoot(downloadsRoot, downloadPath)) {
    console.error(
      `[cleanup] mediaSource ${mediaSourceId}: downloadPath ${downloadPath} no está dentro de downloadsRoot ${downloadsRoot} — no se borra nada`,
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
          `[cleanup] mediaSource ${mediaSourceId}: no se pudo rmdir ${dirname(downloadPath)} (probablemente no está vacío):`,
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
    console.error(`[cleanup] mediaSource ${mediaSourceId}: no se pudo borrar ${downloadPath}:`, err);
  }
}
