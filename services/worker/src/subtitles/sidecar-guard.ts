import { basename, dirname, resolve } from 'node:path';

// Spec 101, REQ-12
export function mayDeleteSidecar(sourcePath: string, filePath: string): boolean {
  if (!sourcePath || !filePath) return false;

  const name = basename(sourcePath);
  if (sourcePath.split(/[\\/]/).includes('..')) return false;
  if (resolve(dirname(sourcePath)) !== resolve(dirname(filePath))) return false;
  if (!name.toLowerCase().endsWith('.srt')) return false;
  if (resolve(sourcePath) === resolve(filePath)) return false;

  return true;
}
