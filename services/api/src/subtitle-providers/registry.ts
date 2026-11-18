import { SubtitleProviderKind } from '@prisma/client';
import { openSubtitlesApiKey } from '@/clients/opensubtitles/key';

// Spec 121, REQ-1
export const SUBTITLE_PROVIDER_KINDS: readonly SubtitleProviderKind[] = [
  SubtitleProviderKind.OPENSUBTITLES,
  SubtitleProviderKind.SUBDIVX,
];

export const SUBDIVX_SERVED_ISO3 = 'spa';

// Spec 121, REQ-1
export const PROVIDER_SETTING_KEYS = {
  OPENSUBTITLES: { username: 'opensubtitles_username', secret: 'opensubtitles_password' },
  SUBDIVX: { username: null, secret: 'subdivx_api_key' },
} as const;

export const PROVIDER_DEFAULT_KEY = 'subtitle_provider_default';
export const PROVIDER_LANGUAGES_KEY = 'subtitle_provider_languages';

// Spec 121, REQ-2
export function isConfigured(
  kind: SubtitleProviderKind,
  map: Record<string, string>,
  appKeyPresent: boolean = openSubtitlesApiKey() !== null,
): boolean {
  if (kind === SubtitleProviderKind.OPENSUBTITLES) {
    return (
      appKeyPresent &&
      (map[PROVIDER_SETTING_KEYS.OPENSUBTITLES.username] ?? '').trim() !== '' &&
      (map[PROVIDER_SETTING_KEYS.OPENSUBTITLES.secret] ?? '').trim() !== ''
    );
  }
  return (map[PROVIDER_SETTING_KEYS.SUBDIVX.secret] ?? '').trim() !== '';
}

export function configuredKinds(
  map: Record<string, string>,
  appKeyPresent: boolean = openSubtitlesApiKey() !== null,
): SubtitleProviderKind[] {
  return SUBTITLE_PROVIDER_KINDS.filter((kind) =>
    isConfigured(kind, map, appKeyPresent),
  );
}

// Spec 121, REQ-16
export function anyProviderConfigured(
  map: Record<string, string>,
  appKeyPresent: boolean = openSubtitlesApiKey() !== null,
): boolean {
  return configuredKinds(map, appKeyPresent).length > 0;
}

// Spec 121, REQ-1
export function servesLanguage(kind: SubtitleProviderKind, iso3: string): boolean {
  if (kind === SubtitleProviderKind.SUBDIVX) {
    return iso3.toLowerCase() === SUBDIVX_SERVED_ISO3;
  }
  return true;
}
