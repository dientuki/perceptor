// These mappers translate Jellyfin's hand-typed JSON shapes with no schema
// check on either side. A wrong field name (ProviderIds.Tmdb,
// ParentIndexNumber, IndexNumber, LocationType) does not throw — it yields
// an empty list, and the index then "successfully" builds with zero
// entries, so every title reads MISSING, which is also the correct output
// for an empty library. There is no error anywhere to notice this by; only
// a case like the ones below, verified to fail when its rule is removed,
// catches it.

import {
  toLibraryEntries,
  toPresentEpisodes,
  createJellyfinClient,
  JellyfinItem,
  JellyfinEpisode,
} from './jellyfin';
import { MEDIA_TYPE } from '@/types/media';

describe('toLibraryEntries', () => {
  it('drops an item with no Tmdb provider id', () => {
    const items: JellyfinItem[] = [{ Id: 'abc', ProviderIds: {} }];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([]);
  });

  it('drops an item whose Tmdb id is non-numeric', () => {
    const items: JellyfinItem[] = [
      { Id: 'abc', ProviderIds: { Tmdb: 'not-a-number' } },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([]);
  });

  it('drops an item whose Tmdb id is zero', () => {
    const items: JellyfinItem[] = [{ Id: 'abc', ProviderIds: { Tmdb: '0' } }];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([]);
  });

  it('maps a well-formed film to mediaType "movie"', () => {
    const items: JellyfinItem[] = [{ Id: 'abc', ProviderIds: { Tmdb: '539' } }];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([
      { mediaType: MEDIA_TYPE.MOVIE, tmdbId: 539, externalId: 'abc' },
    ]);
  });

  it('maps a well-formed series to mediaType "show"', () => {
    const items: JellyfinItem[] = [
      { Id: 'xyz', ProviderIds: { Tmdb: '1405' } },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.SHOW)).toEqual([
      { mediaType: MEDIA_TYPE.SHOW, tmdbId: 1405, externalId: 'xyz' },
    ]);
  });
});

describe('toPresentEpisodes', () => {
  const wellFormed: JellyfinEpisode = {
    LocationType: 'FileSystem',
    Path: '/media/Dexter/S01E01.mkv',
    ParentIndexNumber: 1,
    IndexNumber: 1,
  };

  it('drops a Virtual episode even though the request asked for isMissing=false', () => {
    const items: JellyfinEpisode[] = [
      { ...wellFormed, LocationType: 'Virtual' },
    ];
    expect(toPresentEpisodes(items)).toEqual([]);
  });

  it('drops an episode with an empty Path', () => {
    const items: JellyfinEpisode[] = [{ ...wellFormed, Path: '' }];
    expect(toPresentEpisodes(items)).toEqual([]);
  });

  it('drops an episode with a null IndexNumber', () => {
    const items: JellyfinEpisode[] = [{ ...wellFormed, IndexNumber: null }];
    expect(toPresentEpisodes(items)).toEqual([]);
  });

  it('drops an episode with a null ParentIndexNumber', () => {
    const items: JellyfinEpisode[] = [
      { ...wellFormed, ParentIndexNumber: null },
    ];
    expect(toPresentEpisodes(items)).toEqual([]);
  });

  it('keeps a well-formed, non-virtual episode', () => {
    expect(toPresentEpisodes([wellFormed])).toEqual([
      { seasonNumber: 1, episodeNumber: 1 },
    ]);
  });
});

describe('listPresentEpisodes request', () => {
  // Jellyfin's default field set for GET /Shows/{id}/Episodes omits Path
  // entirely — without asking for it explicitly, every item arrives with
  // Path undefined, and toPresentEpisodes's own `!item.Path` guard then
  // drops every real episode too, exactly like a Virtual one. This is what
  // silently kept every series's episodes MISSING regardless of what
  // Jellyfin actually had, until fields=Path was added below.
  it('asks Jellyfin for the Path field, without which every real episode reads as absent', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Items: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createJellyfinClient(
      { host: 'h', port: '8096', apiKey: 'k' },
      { lookup: async () => null },
    );
    await client.listPresentEpisodes('series-id');

    const requestedUrl = fetchMock.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get('fields')).toBe('Path');
  });
});
