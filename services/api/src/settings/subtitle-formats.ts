import { SUBTITLE_IMAGE_FORMATS, SUBTITLE_TEXT_FORMATS } from './settings.catalog';

function resolveList(raw: string | undefined, catalog: readonly string[]): string[] {
  if (raw === undefined) {
    return [...catalog];
  }

  const stored = new Set(raw.split(',').map((id) => id.trim()));

  return catalog.filter((id) => stored.has(id));
}

export function resolveAllowedSubtitleFormats(settingsMap: Record<string, string>): string[] {
  if (settingsMap['subtitles_enabled'] === 'false') {
    return [];
  }

  const textOn = settingsMap['subtitles_text_enabled'] !== 'false';
  const imageOn = settingsMap['subtitles_image_enabled'] === 'true';

  return [
    ...(textOn ? resolveList(settingsMap['subtitles_text_formats'], SUBTITLE_TEXT_FORMATS) : []),
    ...(imageOn ? resolveList(settingsMap['subtitles_image_formats'], SUBTITLE_IMAGE_FORMATS) : []),
  ];
}
