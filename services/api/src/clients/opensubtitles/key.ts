import { readFileSync } from 'node:fs';

// Spec 107, REQ-13
export const OPENSUBTITLES_KEY_FILE = '/app/secrets/opensubtitles_api_key';

const fileKeys = new Map<string, string | null>();

function readKeyFile(path: string): string | null {
  if (fileKeys.has(path)) return fileKeys.get(path) ?? null;
  let key: string | null = null;
  try {
    const trimmed = readFileSync(path, 'utf8').trim();
    key = trimmed === '' ? null : trimmed;
  } catch {
    key = null;
  }
  fileKeys.set(path, key);
  return key;
}

// Spec 107, REQ-13
export function openSubtitlesApiKey(
  filePath: string = OPENSUBTITLES_KEY_FILE,
): string | null {
  const fromEnv = (process.env.OPENSUBTITLES_API_KEY ?? '').trim();
  if (fromEnv !== '') return fromEnv;
  return readKeyFile(filePath);
}
