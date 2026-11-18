import { unzipSync } from 'fflate';
import { createExtractorFromData } from 'node-unrar-js';

export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

export type ArchiveResult =
  { srt: Buffer; entryName: string } | { rejected: true };

export interface EpisodeTarget {
  season: number;
  episode: number;
}

interface Entry {
  name: string;
  size: number;
}

const REJECTED: ArchiveResult = { rejected: true };

export async function extractSrt(
  bytes: Buffer,
  episode?: EpisodeTarget,
): Promise<ArchiveResult> {
  try {
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      return extractZip(bytes, episode);
    }
    if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
      return await extractRar(bytes, episode);
    }
    if (bytes.length > MAX_ARCHIVE_BYTES) return REJECTED;
    return { srt: bytes, entryName: '' };
  } catch {
    return REJECTED;
  }
}

function startsWith(bytes: Buffer, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

function extractZip(bytes: Buffer, episode?: EpisodeTarget): ArchiveResult {
  const entries: Entry[] = [];
  unzipSync(new Uint8Array(bytes), {
    filter: (file) => {
      entries.push({ name: file.name, size: file.originalSize });
      return false;
    },
  });
  const chosen = pick(entries, episode);
  if (!chosen) return REJECTED;
  const files = unzipSync(new Uint8Array(bytes), {
    filter: (file) => file.name === chosen.name,
  });
  const data = files[chosen.name];
  if (!data || data.length > MAX_ARCHIVE_BYTES) return REJECTED;
  return { srt: Buffer.from(data), entryName: chosen.name };
}

async function extractRar(
  bytes: Buffer,
  episode?: EpisodeTarget,
): Promise<ArchiveResult> {
  const data = new Uint8Array(bytes).buffer;
  const extractor = await createExtractorFromData({ data });
  const entries: Entry[] = [];
  for (const header of extractor.getFileList().fileHeaders) {
    if (entries.length > MAX_ARCHIVE_ENTRIES) return REJECTED;
    if (header.flags.encrypted) return REJECTED;
    entries.push({
      name: header.flags.directory ? `${header.name}/` : header.name,
      size: header.unpSize,
    });
  }
  const chosen = pick(entries, episode);
  if (!chosen) return REJECTED;
  const { files } = extractor.extract({ files: [chosen.name] });
  for (const file of files) {
    const content = file.extraction;
    if (!content || content.length > MAX_ARCHIVE_BYTES) return REJECTED;
    return { srt: Buffer.from(content), entryName: chosen.name };
  }
  return REJECTED;
}

function pick(entries: Entry[], episode?: EpisodeTarget): Entry | null {
  if (entries.length > MAX_ARCHIVE_ENTRIES) return null;
  if (entries.some((e) => !isSafe(e.name))) return null;
  const total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total > MAX_ARCHIVE_BYTES) return null;

  const srts = entries.filter((e) => isCandidate(e.name));
  if (srts.length === 1) return srts[0];
  if (srts.length === 0 || !episode) return null;
  const matching = srts.filter((e) => carriesEpisode(e.name, episode));
  return matching.length === 1 ? matching[0] : null;
}

function isSafe(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-z]:/i.test(name)) {
    return false;
  }
  return !name.split(/[\\/]/).includes('..');
}

function isCandidate(name: string): boolean {
  if (name.endsWith('/') || name.endsWith('\\')) return false;
  const parts = name.split(/[\\/]/);
  if (parts[0] === '__MACOSX') return false;
  const base = parts[parts.length - 1];
  return !base.startsWith('.') && base.toLowerCase().endsWith('.srt');
}

function carriesEpisode(name: string, target: EpisodeTarget): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  const pattern = /(?<![a-z0-9])s(\d{1,3})[ ._-]?e(\d{1,4})(?!\d)/gi;
  for (const m of base.matchAll(pattern)) {
    if (Number(m[1]) === target.season && Number(m[2]) === target.episode) {
      return true;
    }
  }
  return false;
}
