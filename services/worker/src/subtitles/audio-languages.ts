import { normalizeIso3 } from '../ffmpeg/iso639';

// Spec 108, T007
export function audioLanguages(streams: any[]): string[] {
  const out = new Set<string>();
  for (const s of streams) {
    if (s?.codec_type !== 'audio') continue;
    const lang = normalizeIso3(s.tags?.language || '');
    if (!lang || lang === 'und') continue;
    out.add(lang);
  }
  return [...out];
}
