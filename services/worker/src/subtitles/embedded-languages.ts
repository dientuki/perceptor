import { normalizeIso3 } from '../ffmpeg/iso639';

// Spec 107, T011
export function embeddedLanguages(streams: any[]): string[] {
  const out = new Set<string>();
  for (const s of streams) {
    if (s?.codec_type !== 'subtitle') continue;
    if (s.disposition?.forced === 1) continue;
    const lang = normalizeIso3(s.tags?.language || '');
    if (!lang || lang === 'und') continue;
    out.add(lang);
  }
  return [...out];
}
