import { MEDIA_SERVER_IDS } from '@/clients/media-server/registry';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

export type SettingKind =
  | 'path'
  | 'string'
  | 'boolean'
  | 'int'
  | 'secret'
  | 'enum'
  | 'languages'
  | 'enum_list'
  | 'cron';

export type SettingCatalogEntry = {
  kind: SettingKind;
  rootId?: string;
  options?: string[];
};

// Resolution cap the worker's downscale logic implements today (042/044/058) —
// declared once here so this catalog entry's `options` isn't a bare literal.
// prisma/seeds/settings.ts's seeded default ('1080p') can't import this
// constant (that file runs under plain ts-node with no `@/*` alias support —
// see prisma/seeds/index.ts) but must stay one of these five values.
export const COMPRESSION_RESOLUTIONS = ['4k', '1080p', '720p', '480p', '360p'] as const;

// Spec 058, REQ-4
export const DEFAULT_COMPRESSION_RESOLUTION: (typeof COMPRESSION_RESOLUTIONS)[number] = '1080p';

export const SUBTITLE_TEXT_FORMATS = ['srt', 'ass', 'webvtt', 'mov_text'] as const;
export const SUBTITLE_IMAGE_FORMATS = ['pgs', 'vobsub', 'dvb'] as const;

export const SETTINGS_CATALOG: Record<string, SettingCatalogEntry> = {
  path_downloads: { kind: 'path', rootId: 'downloads' },
  path_movies: { kind: 'path', rootId: 'library' },
  path_shows: { kind: 'path', rootId: 'library' },
  path_shorts: { kind: 'path', rootId: 'library' },
  tracker_api_key: { kind: 'secret' },
  movie_db_api_key: { kind: 'secret' },
  movies_enabled: { kind: 'boolean' },
  shows_enabled: { kind: 'boolean' },
  shorts_enabled: { kind: 'boolean' },
  compression_enabled: { kind: 'boolean' },
  compression_resolution: { kind: 'enum', options: [...COMPRESSION_RESOLUTIONS] },
  subtitles_enabled: { kind: 'boolean' },
  subtitles_text_enabled: { kind: 'boolean' },
  subtitles_text_formats: { kind: 'enum_list', options: [...SUBTITLE_TEXT_FORMATS] },
  subtitles_image_enabled: { kind: 'boolean' },
  subtitles_image_formats: { kind: 'enum_list', options: [...SUBTITLE_IMAGE_FORMATS] },
  media_server_client: { kind: 'enum', options: MEDIA_SERVER_IDS },
  media_server_host: { kind: 'string' },
  media_server_port: { kind: 'int' },
  media_server_api_key: { kind: 'secret' },
  ui_locale: { kind: 'enum', options: [...SUPPORTED_LOCALES] },
  default_languages: { kind: 'languages' },
  // Cadence and enablement for the scheduler (src/scheduler/) — keys are
  // derived from the registry's task ids, not written out twice.
  schedule_refresh_movies_enabled: { kind: 'boolean' },
  schedule_refresh_movies_cron: { kind: 'cron' },
  schedule_refresh_shows_enabled: { kind: 'boolean' },
  schedule_refresh_shows_cron: { kind: 'cron' },
  schedule_refresh_episodes_enabled: { kind: 'boolean' },
  schedule_refresh_episodes_cron: { kind: 'cron' },
  schedule_acquire_episodes_enabled: { kind: 'boolean' },
  schedule_acquire_episodes_cron: { kind: 'cron' },
  schedule_acquire_movies_enabled: { kind: 'boolean' },
  schedule_acquire_movies_cron: { kind: 'cron' },
};

export function getSettingCatalogEntry(key: string): SettingCatalogEntry | undefined {
  return SETTINGS_CATALOG[key];
}
