import {
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
// listLibrary enumerates the whole library in a background rebuild — NFR-2
// gives it room for a large one rather than racing an arbitrary library size
// against a short timeout.
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

export const createJellyfinClient = (
  config: MediaServerConfig,
  index: MediaServerIndexPort,
): MediaServerClient => {
  // Sin fallback a 'localhost': acá adentro "localhost" sería el container
  // api, casi nunca donde corre Jellyfin de verdad — un default silencioso
  // ahí sólo cambia un error visible (host vacío) por uno confuso
  // (ECONNREFUSED contra el propio api). MediaServerService ya garantiza que
  // no llega acá con el host vacío (ver notifyCreated).
  const { host, port, apiKey } = config;

  const baseUrl = `http://${host}:${port}/`;

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
      headers: { 'X-MediaBrowser-Token': apiKey },
      signal: AbortSignal.timeout(LIST_LIBRARY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Jellyfin respondió ${response.status} al listar ${includeItemTypes}: ${await response.text()}`,
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
          'X-MediaBrowser-Token': apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin respondió ${response.status} al refrescar la biblioteca: ${await response.text()}`,
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
      const endpoint = new URL(`Library/Media/Updated`, baseUrl);

      const response = await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        headers: {
          'Content-Type': 'application/json',
          'X-MediaBrowser-Token': apiKey,
        },
        body: JSON.stringify({
          Updates: [
            {
              Path: media,
              UpdateType: 'created', // lo abstractamos aquí
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin respondió ${response.status} al avisar de ${media}: ${await response.text()}`,
        );
      }
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
        headers: { 'X-MediaBrowser-Token': apiKey },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Jellyfin respondió ${response.status} al listar episodios de ${externalSeriesId}: ${await response.text()}`,
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
