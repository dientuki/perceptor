import { posix } from 'path';
import {
  MediaServerClient,
  MediaServerConfig,
  MediaServerEpisodeRef,
  MediaServerIndexPort,
  MediaServerLibraryEntry,
} from './types';
import { MediaType, MEDIA_TYPE } from '@/types/media';
import { HTTP_METHOD } from '@/types/http';

const READ_TIMEOUT_MS = 5_000;
const LIST_LIBRARY_TIMEOUT_MS = 5 * 60 * 1000;
const LIBRARY_PAGE_SIZE = 500;

const MODERN_TMDB_GUID = /^tmdb:\/\/(\d+)$/;
const LEGACY_TMDB_GUID = /^com\.plexapp\.agents\.themoviedb:\/\/(\d+)/;

export type PlexGuid = { id: string };

export type PlexItem = {
  ratingKey: string;
  guid?: string;
  Guid?: PlexGuid[];
};

export type PlexEpisode = {
  parentIndex?: number | null;
  index?: number | null;
  Media?: { Part?: { file?: string }[] }[];
};

export type PlexSection = {
  key: string;
  type: string;
  Location?: { path: string }[];
};

type PlexContainer<T> = {
  MediaContainer: {
    size?: number;
    totalSize?: number;
    Directory?: PlexSection[];
    Metadata?: T[];
  };
};

function extractTmdbId(item: PlexItem): number {
  const candidates = [
    ...(item.Guid ?? []).map((guid) => guid.id),
    ...(item.guid ? [item.guid] : []),
  ];

  for (const candidate of candidates) {
    const match =
      MODERN_TMDB_GUID.exec(candidate) ?? LEGACY_TMDB_GUID.exec(candidate);
    if (!match) continue;
    const tmdbId = Number(match[1]);
    if (Number.isInteger(tmdbId) && tmdbId > 0) return tmdbId;
  }

  return NaN;
}

export function toLibraryEntries(
  items: PlexItem[],
  mediaType: MediaType,
): MediaServerLibraryEntry[] {
  const entries: MediaServerLibraryEntry[] = [];

  for (const item of items) {
    const tmdbId = extractTmdbId(item);
    if (!Number.isInteger(tmdbId)) continue;

    entries.push({ mediaType, tmdbId, externalId: String(item.ratingKey) });
  }

  return entries;
}

export function toPresentEpisodes(
  items: PlexEpisode[],
): MediaServerEpisodeRef[] {
  const episodes: MediaServerEpisodeRef[] = [];

  for (const item of items) {
    const hasFile = (item.Media ?? []).some((media) =>
      (media.Part ?? []).some((part) => !!part.file),
    );
    if (!hasFile) continue;
    if (item.parentIndex == null || item.index == null) continue;

    episodes.push({
      seasonNumber: item.parentIndex,
      episodeNumber: item.index,
    });
  }

  return episodes;
}

function isInside(root: string, filePath: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, '');
  return (
    filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`)
  );
}

export function chooseSectionForPath(
  sections: PlexSection[],
  filePath: string,
): PlexSection | null {
  let best: PlexSection | null = null;
  let bestLength = -1;

  for (const section of sections) {
    for (const location of section.Location ?? []) {
      const length = location.path.replace(/\/+$/, '').length;
      if (isInside(location.path, filePath) && length > bestLength) {
        best = section;
        bestLength = length;
      }
    }
  }

  return best;
}

export const createPlexClient = (
  config: MediaServerConfig,
  index: MediaServerIndexPort,
): MediaServerClient => {
  const { host, port, apiKey } = config;
  const baseUrl = `http://${host}:${port}/`;

  const headers = (extra: Record<string, string> = {}) => ({
    'X-Plex-Token': apiKey,
    Accept: 'application/json',
    ...extra,
  });

  async function request(
    url: URL,
    what: string,
    timeoutMs: number,
    method: string = HTTP_METHOD.GET,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: headers(extraHeaders),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Plex respondió ${response.status} al ${what}: ${await response.text()}`,
      );
    }

    return response;
  }

  async function listSections(): Promise<PlexSection[]> {
    const response = await request(
      new URL('library/sections', baseUrl),
      'listar las secciones',
      READ_TIMEOUT_MS,
    );
    const body = (await response.json()) as PlexContainer<never>;
    return body.MediaContainer.Directory ?? [];
  }

  async function refreshAll(): Promise<void> {
    await request(
      new URL('library/sections/all/refresh', baseUrl),
      'refrescar la biblioteca',
      READ_TIMEOUT_MS,
    );
  }

  async function listSection(
    section: PlexSection,
    mediaType: MediaType,
  ): Promise<MediaServerLibraryEntry[]> {
    const entries: MediaServerLibraryEntry[] = [];
    let start = 0;

    for (;;) {
      const endpoint = new URL(`library/sections/${section.key}/all`, baseUrl);
      endpoint.searchParams.set('includeGuids', '1');

      const response = await request(
        endpoint,
        `listar la sección ${section.key}`,
        LIST_LIBRARY_TIMEOUT_MS,
        HTTP_METHOD.GET,
        {
          'X-Plex-Container-Start': String(start),
          'X-Plex-Container-Size': String(LIBRARY_PAGE_SIZE),
        },
      );
      const body = (await response.json()) as PlexContainer<PlexItem>;
      const items = body.MediaContainer.Metadata ?? [];
      entries.push(...toLibraryEntries(items, mediaType));

      start += items.length;
      const total = body.MediaContainer.totalSize;
      if (
        items.length === 0 ||
        items.length < LIBRARY_PAGE_SIZE ||
        (total !== undefined && start >= total)
      )
        break;
    }

    return entries;
  }

  return {
    async refreshLibrary() {
      await refreshAll();
    },

    async createdMedia(media: string) {
      const sections = await listSections();
      const section = chooseSectionForPath(sections, media);

      if (!section) {
        console.warn(
          `[media-server] ninguna sección de Plex contiene "${media}" — se refrescan todas`,
        );
        await refreshAll();
        return;
      }

      const endpoint = new URL(
        `library/sections/${section.key}/refresh`,
        baseUrl,
      );
      endpoint.searchParams.set('path', posix.dirname(media));
      await request(
        endpoint,
        `avisar de ${media}`,
        READ_TIMEOUT_MS,
      );
      console.log(
        `[media-server] sección de Plex escaneada: ${section.key} (${posix.dirname(media)})`,
      );
    },

    async findByTmdbId(mediaType: MediaType, tmdbId: number) {
      return index.lookup(mediaType, tmdbId);
    },

    async listPresentEpisodes(externalSeriesId: string) {
      const response = await request(
        new URL(`library/metadata/${externalSeriesId}/allLeaves`, baseUrl),
        `listar episodios de ${externalSeriesId}`,
        READ_TIMEOUT_MS,
      );
      const body = (await response.json()) as PlexContainer<PlexEpisode>;
      return toPresentEpisodes(body.MediaContainer.Metadata ?? []);
    },

    async listLibrary() {
      const sections = await listSections();
      const seen = new Set<string>();
      const entries: MediaServerLibraryEntry[] = [];

      for (const section of sections) {
        const mediaType =
          section.type === 'movie'
            ? MEDIA_TYPE.MOVIE
            : section.type === 'show'
              ? MEDIA_TYPE.SHOW
              : null;
        if (!mediaType) continue;

        for (const entry of await listSection(section, mediaType)) {
          const key = `${entry.mediaType}:${entry.tmdbId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push(entry);
        }
      }

      return entries;
    },
  };
};
