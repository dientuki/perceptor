export type CompressionResolution = '4k' | '1080p' | '720p' | '480p' | '360p';

export const COMPRESSION_RESOLUTION_VALUES: readonly CompressionResolution[] = [
  '4k',
  '1080p',
  '720p',
  '480p',
  '360p',
];

function isCompressionResolution(value: string): value is CompressionResolution {
  return (COMPRESSION_RESOLUTION_VALUES as readonly string[]).includes(value);
}

export function normalizeCompressionResolution(raw: string | null | undefined): CompressionResolution {
  if (raw != null && isCompressionResolution(raw)) {
    return raw;
  }

  console.warn(`[compression-resolution] unrecognised compressionResolution ${JSON.stringify(raw)}, defaulting to 1080p`);
  return '1080p';
}
