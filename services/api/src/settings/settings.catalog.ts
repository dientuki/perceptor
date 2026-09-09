import { MEDIA_SERVER_IDS } from '@/clients/media-server/registry';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

// Gemelo server-side de EDITABLE_KEYS en services/web/src/actions/settings.ts
// (client-only hasta ahora). `updateSettings` aceptaba cualquier key/value —
// esto es lo que lo cierra: toda key que llega tiene que estar acá, y las de
// tipo 'path' se validan contra media-roots antes de guardarse.
export type SettingKind =
  | 'path'
  | 'string'
  | 'boolean'
  | 'int'
  | 'secret'
  | 'enum'
  | 'languages'
  | 'cron';

export type SettingCatalogEntry = {
  kind: SettingKind;
  // Sólo presente cuando kind === 'path': contra qué raíz de media-roots se
  // valida este valor.
  rootId?: string;
  // Sólo presente cuando kind === 'enum': los valores permitidos.
  options?: string[];
};

// Resolution cap the worker's downscale logic implements today (042/044) —
// declared once here so this catalog entry's `options` isn't a bare literal.
// prisma/seeds/settings.ts's seeded default ('1080p') can't import this
// constant (see that file's own comment) but must stay one of these four
// values.
export const COMPRESSION_RESOLUTIONS = ['4k', '1080p', '720p', '360p'] as const;

// torrent_port no es editable: es el puerto interno de qBittorrent dentro de
// la red de Docker (QBITTORRENT_WEBUI_PORT en .env), no algo que el usuario
// final deba tocar desde Settings. Sigue existiendo como fila en la DB
// (sembrada, leída por QbittorrentClient.baseUrl()) — sólo se sacó de acá.
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
  // options sale del registro de clientes (clients/media-server/registry.ts),
  // no de una lista a mano: sumar un media server ahí lo vuelve válido acá
  // automáticamente.
  media_server_client: { kind: 'enum', options: MEDIA_SERVER_IDS },
  media_server_host: { kind: 'string' },
  media_server_port: { kind: 'int' },
  media_server_api_key: { kind: 'secret' },
  // options viene de la lista soportada de locales (i18n/locales.ts), no de
  // un literal acá — sumar un locale ahí lo vuelve válido acá automáticamente.
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
  schedule_acquire_pending_enabled: { kind: 'boolean' },
  schedule_acquire_pending_cron: { kind: 'cron' },
};

export function getSettingCatalogEntry(key: string): SettingCatalogEntry | undefined {
  return SETTINGS_CATALOG[key];
}
