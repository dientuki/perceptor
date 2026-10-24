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

// Spec 101, REQ-1
export type ExternalSubtitleStream = {
  hostPath: string;
  languageIso3: string | null;
  isForced: boolean;
  displayTitle: string;
};

// Spec 101, REQ-1
export type ItemSubtitles = {
  itemId: string;
  mediaHostPath: string | null;
  subtitles: ExternalSubtitleStream[];
  // Spec 103, REQ-7
  presentLanguagesIso3: string[];
};

// Spec 103, REQ-8
export type RemoteSubtitleCandidate = {
  id: string;
  languageIso3: string;
  name: string;
  format: string;
  isForced: boolean;
  isHearingImpaired: boolean;
  isMachineTranslated: boolean;
  isAiTranslated: boolean;
  isHashMatch: boolean;
  downloadCount: number;
};

// Spec 034, REQ-8
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
  // Spec 034, REQ-8
  listLibrary?: () => Promise<MediaServerLibraryEntry[]>;
  // Spec 101, REQ-1
  listItemSubtitles?: (itemId: string) => Promise<ItemSubtitles>;
  // Spec 101, NFR-2
  listSeriesEpisodeSubtitles?: (
    seriesId: string,
  ) => Promise<Map<string, ItemSubtitles>>;
  // Spec 101, REQ-12
  modifiedMedia?: (hostPath: string) => Promise<void>;
  // Spec 103, REQ-8
  searchRemoteSubtitles?: (
    itemId: string,
    iso3: string,
  ) => Promise<RemoteSubtitleCandidate[]>;
  // Spec 103, REQ-9
  fetchRemoteSubtitle?: (subtitleId: string) => Promise<Buffer>;
};

export type MediaServerConfig = {
  host: string;
  port: string;
  apiKey: string;
};

export type MediaServerFactory = (
  config: MediaServerConfig,
  index: MediaServerIndexPort,
) => MediaServerClient;

export const MEDIA_SERVER_NONE = 'none';

export type LibraryLayout = 'jellyfin' | 'plex';

export const DEFAULT_LIBRARY_LAYOUT: LibraryLayout = 'jellyfin';

export type MediaServerRegistryEntry = {
  label: string;
  create: MediaServerFactory;
  layout: LibraryLayout;
  defaultPort: number;
  credentialLabel: string;
  credentialHelpUrl?: string;
};
