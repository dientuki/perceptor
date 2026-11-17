import { normalizeIso3 } from '../ffmpeg/iso639';
import { subtitleGroupOf } from '../ffmpeg/params';
import type { VerifyStream } from './verify-embed';

export type ProbedSubtitleStream = VerifyStream & { index: number };

const EXTRA_TEXT_CODECS = ['text'];

function isTextSubtitle(stream: ProbedSubtitleStream): boolean {
  if (subtitleGroupOf(stream) === 'text') return true;
  return EXTRA_TEXT_CODECS.includes((stream.codec_name ?? '').toLowerCase());
}

// Spec 119, REQ-5 REQ-7
export function tracksToDrop(
  streams: ProbedSubtitleStream[],
  languagesIso3: string[],
): number[] {
  const wanted = new Set(languagesIso3.map((code) => normalizeIso3(code)).filter((c) => c !== ''));
  if (wanted.size === 0) return [];

  return streams
    .filter(
      (stream) =>
        stream.codec_type === 'subtitle' &&
        isTextSubtitle(stream) &&
        stream.disposition?.forced !== 1 &&
        wanted.has(normalizeIso3(stream.tags?.language ?? '')),
    )
    .map((stream) => stream.index);
}
