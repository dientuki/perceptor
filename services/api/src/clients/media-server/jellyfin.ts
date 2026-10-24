import { basename, dirname } from 'node:path';
import {
  ExternalSubtitleStream,
  ItemSubtitles,
  MediaServerClient,
  MediaServerConfig,
  MediaServerEpisodeRef,
  MediaServerIndexPort,
  MediaServerLibraryEntry,
} from './types';
import { MediaType, MEDIA_TYPE } from '@/types/media';
import { HTTP_METHOD } from '@/types/http';

// Reads other than listLibrary: short timeout, this is a request/response
// call inline in a user-facing flow (register/reconcile).
const READ_TIMEOUT_MS = 5_000;
// Spec 034, NFR-2
const LIST_LIBRARY_TIMEOUT_MS = 5 * 60 * 1000;

const LIBRARY_PAGE_SIZE = 500;

export type JellyfinProviderIds = { Tmdb?: string };

export type JellyfinItem = {
  Id: string;
  ProviderIds?: JellyfinProviderIds;
};

type JellyfinItemsResponse = {
  Items: JellyfinItem[];
  TotalRecordCount: number;
};

export type JellyfinEpisode = {
  LocationType?: string;
  Path?: string;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
};

type JellyfinEpisodesResponse = {
  Items: JellyfinEpisode[];
};

// Spec 101, REQ-1
export type JellyfinMediaStream = {
  Type?: string;
  IsExternal?: boolean;
  Codec?: string;
  Path?: string | null;
  Language?: string | null;
  IsForced?: boolean;
  DisplayTitle?: string | null;
};

// Spec 101, REQ-1
export type JellyfinSubtitleItem = {
  Id: string;
  Path?: string | null;
  LocationType?: string;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
  MediaStreams?: JellyfinMediaStream[];
};

type JellyfinSubtitleEpisodesResponse = {
  Items: JellyfinSubtitleItem[];
};

// Spec 101, REQ-1
export function toExternalSubtitles(
  mediaPath: string | null | undefined,
  streams: JellyfinMediaStream[] | undefined,
): ExternalSubtitleStream[] {
  if (!mediaPath || !streams) return [];

  const mediaDir = dirname(mediaPath);
  const result: ExternalSubtitleStream[] = [];

  for (const stream of streams) {
    if (stream.Type !== 'Subtitle') continue;
    if (!stream.IsExternal) continue;
    if (stream.Codec !== 'subrip') continue;
    if (!stream.Path) continue;
    if (!stream.Path.toLowerCase().endsWith('.srt')) continue;
    if (dirname(stream.Path) !== mediaDir) continue;

    result.push({
      hostPath: stream.Path,
      languageIso3: stream.Language ? stream.Language : null,
      isForced: stream.IsForced === true,
      displayTitle: stream.DisplayTitle ?? basename(stream.Path),
    });
  }

  return result;
}

// Spec 101, NFR-2
export const episodeKey = (season: number, episode: number): string =>
  `${season}:${episode}`;

// Spec 101, REQ-12
export function updatedMediaBody(
  path: string,
  updateType: 'created' | 'Modified',
): string {
  return JSON.stringify({ Updates: [{ Path: path, UpdateType: updateType }] });
}

// Keeps only entries with a positive-integer Tmdb provider id. A missing,
// non-numeric or zero value means Jellyfin never linked this item to TMDB —
// dropped rather than coerced, because a coerced 0/NaN would collide with
// nothing and silently ends up unmatched anyway.
export function toLibraryEntries(
  items: JellyfinItem[],
  mediaType: MediaType,
): MediaServerLibraryEntry[] {
  const entries: MediaServerLibraryEntry[] = [];

  for (const item of items) {
    const raw = item.ProviderIds?.Tmdb;
    const tmdbId = raw ? Number(raw) : NaN;
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;

    entries.push({ mediaType, tmdbId, externalId: item.Id });
  }

  return entries;
}

// `isMissing=false` alone is not enough: Jellyfin includes virtual (metadata-
// only, no file on disk) episodes for any request authenticated with an API
// key, regardless of the isMissing filter — see
// https://github.com/jellyfin/jellyfin/issues/16192 and
// TvShowsController.cs's `shouldIncludeMissingEpisodes` gate. Dropping
// LocationType === 'Virtual', an empty Path, or a null season/episode number
// here is what keeps a series with no files at all from reading as fully
// COMPLETED.
export function toPresentEpisodes(
  items: JellyfinEpisode[],
): MediaServerEpisodeRef[] {
  const episodes: MediaServerEpisodeRef[] = [];

  for (const item of items) {
    if (item.LocationType === 'Virtual') continue;
    if (!item.Path) continue;
    if (item.ParentIndexNumber == null || item.IndexNumber == null) continue;

    episodes.push({
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
    });
  }

  return episodes;
}

// Spec 101, REQ-1
export function toItemSubtitles(item: JellyfinSubtitleItem): ItemSubtitles {
  return {
    itemId: item.Id,
    mediaHostPath: item.Path ? item.Path : null,
    subtitles: toExternalSubtitles(item.Path, item.MediaStreams),
  };
}

// Spec 101, NFR-2
export function toEpisodeSubtitleMap(
  items: JellyfinSubtitleItem[],
): Map<string, ItemSubtitles> {
  const map = new Map<string, ItemSubtitles>();

  for (const item of items) {
    if (item.LocationType === 'Virtual') continue;
    if (!item.Path) continue;
    if (item.ParentIndexNumber == null || item.IndexNumber == null) continue;

    map.set(
      episodeKey(item.ParentIndexNumber, item.IndexNumber),
      toItemSubtitles(item),
    );
  }

  return map;
}

export const createJellyfinClient = (
  config: MediaServerConfig,
  index: MediaServerIndexPort,
): MediaServerClient => {
  const { host, port, apiKey } = config;

  const baseUrl = `http://${host}:${port}/`;
  // Jellyfin 12 dropped the legacy `X-MediaBrowser-Token`/`X-Emby-Token`
  // headers (deprecated since 10.10): every request authenticated that way
  // answers 401 with an empty body, key valid or not. The scheme below is
  // the only one 12 accepts, and 10.x has accepted it all along.
  const authHeader = `MediaBrowser Token="${apiKey}"`;

  // Spec 101, REQ-12
  async function postUpdatedMedia(
    path: string,
    updateType: 'created' | 'Modified',
  ): Promise<void> {
    const endpoint = new URL(`Library/Media/Updated`, baseUrl);

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: updatedMediaBody(path, updateType),
    });

    if (!response.ok) {
      throw new Error(
        `Jellyfin responded ${response.status} while notifying about ${path}: ${await response.text()}`,
      );
    }
  }

  async function fetchItemsPage(
    includeItemTypes: 'Movie' | 'Series',
    startIndex: number,
  ): Promise<JellyfinItemsResponse> {
    const endpoint = new URL('Items', baseUrl);
    endpoint.searchParams.set('includeItemTypes', includeItemTypes);
    endpoint.searchParams.set('recursive', 'true');
    endpoint.searchParams.set('hasTmdbId', 'true');
    endpoint.searchParams.set('fields', 'ProviderIds');
    endpoint.searchParams.set('excludeLocationTypes', 'Virtual');
    endpoint.searchParams.set('enableImages', 'false');
    endpoint.searchParams.set('enableUserData', 'false');
    endpoint.searchParams.set('startIndex', String(startIndex));
    endpoint.searchParams.set('limit', String(LIBRARY_PAGE_SIZE));

    const response = await fetch(endpoint, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(LIST_LIBRARY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Jellyfin responded ${response.status} while listing ${includeItemTypes}: ${await response.text()}`,
      );
    }

    return (await response.json()) as JellyfinItemsResponse;
  }

  async function listAllOfType(
    includeItemTypes: 'Movie' | 'Series',
    mediaType: MediaType,
  ): Promise<MediaServerLibraryEntry[]> {
    const entries: MediaServerLibraryEntry[] = [];
    let startIndex = 0;

    for (;;) {
      const page = await fetchItemsPage(includeItemTypes, startIndex);
      entries.push(...toLibraryEntries(page.Items, mediaType));

      startIndex += page.Items.length;
      if (
        page.Items.length < LIBRARY_PAGE_SIZE ||
        startIndex >= page.TotalRecordCount
      )
        break;
    }

    return entries;
  }

  return {
    /**
     * Refresh the Jellyfin library
     * This function sends a POST request to the Jellyfin API to refresh the library
     * https://api.jellyfin.org/#tag/Library/operation/RefreshLibrary
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async refreshLibrary() {
      const endpoint = new URL('Library/Refresh', baseUrl);

      const response = await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        headers: {
          Authorization: authHeader,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin responded ${response.status} while refreshing the library: ${await response.text()}`,
        );
      }
    },

    /**
     * Notify Jellyfin that a media has been created
     * https://api.jellyfin.org/#tag/Library/operation/PostUpdatedMedia
     * @param {string} media The path of the created media
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async createdMedia(media: string) {
      await postUpdatedMedia(media, 'created');
    },

    // Spec 101, REQ-12
    async modifiedMedia(hostPath: string) {
      await postUpdatedMedia(hostPath, 'Modified');
    },

    // Spec 101, REQ-1
    async listItemSubtitles(itemId: string): Promise<ItemSubtitles> {
      const endpoint = new URL('Items', baseUrl);
      endpoint.searchParams.set('ids', itemId);
      endpoint.searchParams.set('fields', 'MediaStreams,Path');

      const response = await fetch(endpoint, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin responded ${response.status} while reading item ${itemId}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as JellyfinSubtitleEpisodesResponse;
      const item = body.Items.find((candidate) => candidate.Id === itemId);
      if (!item) {
        throw new Error(`Jellyfin returned no item ${itemId}`);
      }
      return toItemSubtitles(item);
    },

    // Spec 101, NFR-2
    async listSeriesEpisodeSubtitles(seriesId: string) {
      const endpoint = new URL(
        `Shows/${encodeURIComponent(seriesId)}/Episodes`,
        baseUrl,
      );
      endpoint.searchParams.set('isMissing', 'false');
      endpoint.searchParams.set('fields', 'MediaStreams,Path');

      const response = await fetch(endpoint, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin responded ${response.status} while listing episode subtitles of ${seriesId}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as JellyfinSubtitleEpisodesResponse;
      return toEpisodeSubtitleMap(body.Items);
    },

    // Jellyfin has no provider-id filter on /Items (anyProviderIdEquals is
    // Emby-only — see https://github.com/jellyfin/jellyfin/issues/16192), so
    // this delegates entirely to the shared index built by listLibrary.
    async findByTmdbId(mediaType: MediaType, tmdbId: number) {
      return index.lookup(mediaType, tmdbId);
    },

    async listPresentEpisodes(externalSeriesId: string) {
      const endpoint = new URL(`Shows/${externalSeriesId}/Episodes`, baseUrl);
      endpoint.searchParams.set('isMissing', 'false');
      // Without this, Jellyfin's default field set omits Path entirely, and
      // toPresentEpisodes's `!item.Path` guard (the Virtual-episode defense
      // below) then drops every real episode too — reconcileShow always saw
      // zero present episodes for every series until this was added.
      endpoint.searchParams.set('fields', 'Path');

      const response = await fetch(endpoint, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin responded ${response.status} while listing episodes of ${externalSeriesId}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as JellyfinEpisodesResponse;
      return toPresentEpisodes(body.Items);
    },

    async listLibrary() {
      const [movies, shows] = await Promise.all([
        listAllOfType('Movie', MEDIA_TYPE.MOVIE),
        listAllOfType('Series', MEDIA_TYPE.SHOW),
      ]);

      return [...movies, ...shows];
    },
  };
};
