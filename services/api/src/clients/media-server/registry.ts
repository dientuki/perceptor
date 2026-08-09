import { createJellyfinClient } from './jellyfin';
import { MediaServerClient, MediaServerConfig, MediaServerFactory, MEDIA_SERVER_NONE } from './types';

// ─────────────────────────────────────────────────────────────────────────
// Para agregar un media server: escribí clients/media-server/<nombre>.ts que
// exporte una MediaServerFactory, y sumá UNA línea acá. Nada más.
// Las opciones válidas del setting media_server_client (settings.catalog.ts),
// su validación server-side y el combo de la UI (vía la query
// mediaServerClients) salen todos de este mapa.
// ─────────────────────────────────────────────────────────────────────────
export const MEDIA_SERVERS = {
  jellyfin: { label: 'Jellyfin', create: createJellyfinClient },
  // plex: { label: 'Plex', create: createPlexClient },
} satisfies Record<string, { label: string; create: MediaServerFactory }>;

// Derivados: nadie los mantiene a mano.
export const MEDIA_SERVER_OPTIONS: { id: string; label: string }[] = [
  { id: MEDIA_SERVER_NONE, label: 'Ninguno' },
  ...Object.entries(MEDIA_SERVERS).map(([id, { label }]) => ({ id, label })),
];

export const MEDIA_SERVER_IDS: string[] = MEDIA_SERVER_OPTIONS.map((option) => option.id);

// Lookup, no cadena de ifs. `none` devuelve null en vez de tirar: es una
// opción válida del combo, no un error de configuración.
export function createMediaServerClient(
  id: string,
  config: MediaServerConfig,
): MediaServerClient | null {
  if (id === MEDIA_SERVER_NONE) return null;
  const entry = MEDIA_SERVERS[id as keyof typeof MEDIA_SERVERS];
  if (!entry) throw new Error(`Media server desconocido: "${id}"`);
  return entry.create(config);
}
