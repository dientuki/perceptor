import { decodeSidecar } from '../subtitle-embed/sidecar-text';

export function toUtf8(bytes: Buffer): Buffer {
  const hasBom =
    (bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf) ||
    (bytes.length >= 2 &&
      ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
        (bytes[0] === 0xfe && bytes[1] === 0xff)));
  if (hasBom) return Buffer.from(decodeSidecar(bytes), 'utf8');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes;
  } catch {
    return Buffer.from(new TextDecoder('windows-1252').decode(bytes), 'utf8');
  }
}
