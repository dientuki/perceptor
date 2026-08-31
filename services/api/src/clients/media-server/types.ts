import { MediaType } from '@/types/media';

// One entry of a media-server's whole library, as returned by a bulk
// enumeration (Jellyfin/Plex). Only what the index needs to key on.
export type MediaServerLibraryEntry = {
  mediaType: MediaType;
  tmdbId: number;
  externalId: string;
};

// A present (non-virtual, has-a-file) episode of a matched series, identified
// the same way `seasons`/`episodes` are: season + episode number, never a
// media-server-native id.
export type MediaServerEpisodeRef = {
  seasonNumber: number;
  episodeNumber: number;
};

// The one-method port a client reaches for its own TMDB-id lookups when it
// cannot resolve one natively against the server itself (034). A client that
// *can* resolve natively (e.g. Emby's AnyProviderIdEquals) ignores this and
// never populates the shared index — see registry.ts / REQ-8.
export type MediaServerIndexPort = {
  lookup: (mediaType: MediaType, tmdbId: number) => Promise<string | null>;
};

export type MediaServerClient = {
  refreshLibrary: () => Promise<void>;
  createdMedia: (media: string) => Promise<void>;
  // Resolve a TMDB id to this media server's own item id. Index-backed for a
  // client with no native provider-id filter (Jellyfin); native for one that
  // has it.
  findByTmdbId: (
    mediaType: MediaType,
    tmdbId: number,
  ) => Promise<string | null>;
  // Every non-virtual (has-a-file) episode of a matched series, identified by
  // season/episode number.
  listPresentEpisodes: (
    externalSeriesId: string,
  ) => Promise<MediaServerEpisodeRef[]>;
  // Enumerate the whole library for the shared index to consume. Optional on
  // purpose (REQ-8): a client that resolves findByTmdbId natively never
  // implements this, and a rebuild is a no-op for it.
  listLibrary?: () => Promise<MediaServerLibraryEntry[]>;
};

// Lo que necesita cualquier implementación. Sale de SettingsService.getMap(),
// pero el cliente no lo sabe: recibe un objeto plano y es testeable sin Nest.
// Jellyfin y Plex se configuran igual (host + puerto + token); el día que un
// media server necesite otra cosa, este tipo es lo único que cambia.
export type MediaServerConfig = {
  host: string;
  port: string;
  apiKey: string;
};

export type MediaServerFactory = (
  config: MediaServerConfig,
  index: MediaServerIndexPort,
) => MediaServerClient;

// 'none' no es un cliente: es la ausencia de uno. Vive fuera del registro.
export const MEDIA_SERVER_NONE = 'none';
