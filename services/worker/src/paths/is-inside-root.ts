import { isAbsolute, resolve, sep } from 'node:path';

// Spec 012, REQ-12; Spec 013, NFR-2
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
