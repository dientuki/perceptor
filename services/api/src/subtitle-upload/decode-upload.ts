import { ERROR_KEYS } from '@/i18n/error-keys';
import { lastCueEndMs } from '@/subtitle-search/last-cue';
import { toUtf8 } from '@/subtitle-search/to-utf8';

// Spec 124, REQ-4
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type DecodedUpload =
  { ok: true; bytes: Buffer } | { ok: false; errorKey: string };

// Spec 124, REQ-4 REQ-8
export function decodeUpload(contentBase64: string): DecodedUpload {
  if (contentBase64.length % 4 !== 0 || !BASE64.test(contentBase64)) {
    return { ok: false, errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT };
  }

  const raw = Buffer.from(contentBase64, 'base64');
  if (raw.length > MAX_UPLOAD_BYTES) {
    return { ok: false, errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_TOO_LARGE };
  }

  const bytes = toUtf8(raw);
  const text = bytes.toString('utf8');
  if (text.includes('\u0000') || text.includes('�')) {
    return {
      ok: false,
      errorKey: ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED,
    };
  }

  if (lastCueEndMs(text) === null) {
    return { ok: false, errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT };
  }

  return { ok: true, bytes };
}
