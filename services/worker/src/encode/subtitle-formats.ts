export type SubtitleFormat = 'srt' | 'ass' | 'webvtt' | 'mov_text' | 'pgs' | 'vobsub' | 'dvb';

export const SUBTITLE_FORMAT_VALUES: readonly SubtitleFormat[] = [
  'srt',
  'ass',
  'webvtt',
  'mov_text',
  'pgs',
  'vobsub',
  'dvb',
];

export const DEFAULT_SUBTITLE_FORMATS: readonly SubtitleFormat[] = ['srt', 'ass', 'webvtt', 'mov_text'];

function isSubtitleFormat(value: unknown): value is SubtitleFormat {
  return typeof value === 'string' && (SUBTITLE_FORMAT_VALUES as readonly string[]).includes(value);
}

export function normalizeSubtitleFormats(raw: unknown): SubtitleFormat[] {
  if (!Array.isArray(raw)) {
    console.warn(
      `[subtitle-formats] unrecognised allowedSubtitleFormats ${JSON.stringify(raw)}, defaulting to ${JSON.stringify(DEFAULT_SUBTITLE_FORMATS)}`,
    );
    return [...DEFAULT_SUBTITLE_FORMATS];
  }

  const known: SubtitleFormat[] = [];
  const dropped: unknown[] = [];
  for (const id of raw) {
    if (isSubtitleFormat(id)) {
      if (!known.includes(id)) known.push(id);
    } else {
      dropped.push(id);
    }
  }

  if (dropped.length > 0) {
    console.warn(`[subtitle-formats] ignoring unknown subtitle formats ${JSON.stringify(dropped)}`);
  }
  return known;
}
