import { isAbsolute, resolve, sep } from 'node:path';

// Pure containment predicate — no filesystem access, so it works on paths
// that don't exist locally (this service reads container paths written by
// `api`, never its own). Used by `jobs/cleanup-source.ts` to enforce REQ-12:
// nothing outside `downloadsRoot` may ever be deleted.
//
// An empty or non-absolute `root` must return false, never true. A missing
// `downloadsRoot` (the drift NFR-3 warns about — a field added to the
// GraphQL query but not to `EncodeJobDetails`, or vice versa) arrives here
// as `undefined`/`''`; reading that as "everything is contained" would let
// the worker delete anything at all with no error in any log.
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root || !isAbsolute(root)) {
    return false;
  }

  if (!candidate) {
    return false;
  }

  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);

  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  return resolvedCandidate.startsWith(resolvedRoot + sep);
}
