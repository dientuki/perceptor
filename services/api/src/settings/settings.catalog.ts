import { MEDIA_SERVER_IDS } from '@/clients/media-server/registry';

// Gemelo server-side de EDITABLE_KEYS en services/web/src/actions/settings.ts
// (client-only hasta ahora). `updateSettings` aceptaba cualquier key/value —
// esto es lo que lo cierra: toda key que llega tiene que estar acá, y las de
// tipo 'path' se validan contra media-roots antes de guardarse.
export type SettingKind = 'path' | 'string' | 'boolean' | 'int' | 'secret' | 'enum';

export type SettingCatalogEntry = {
  kind: SettingKind;
  // Sólo presente cuando kind === 'path': contra qué raíz de media-roots se
  // valida este valor.
  rootId?: string;
  // Sólo presente cuando kind === 'enum': los valores permitidos.
  options?: string[];
};

// torrent_port no es editable: es el puerto interno de qBittorrent dentro de
// la red de Docker (QBITTORRENT_WEBUI_PORT en .env), no algo que el usuario
// final deba tocar desde Settings. Sigue existiendo como fila en la DB
// (sembrada, leída por QbittorrentClient.baseUrl()) — sólo se sacó de acá.
export const SETTINGS_CATALOG: Record<string, SettingCatalogEntry> = {
  path_downloads: { kind: 'path', rootId: 'downloads' },
  path_movies: { kind: 'path', rootId: 'library' },
  path_shows: { kind: 'path', rootId: 'library' },
  tracker_api_key: { kind: 'secret' },
  movie_db_api_key: { kind: 'secret' },
  movies_enabled: { kind: 'boolean' },
  shows_enabled: { kind: 'boolean' },
  // options sale del registro de clientes (clients/media-server/registry.ts),
  // no de una lista a mano: sumar un media server ahí lo vuelve válido acá
  // automáticamente.
  media_server_client: { kind: 'enum', options: MEDIA_SERVER_IDS },
  media_server_host: { kind: 'string' },
  media_server_port: { kind: 'int' },
  media_server_api_key: { kind: 'secret' },
};

export function getSettingCatalogEntry(key: string): SettingCatalogEntry | undefined {
  return SETTINGS_CATALOG[key];
}
