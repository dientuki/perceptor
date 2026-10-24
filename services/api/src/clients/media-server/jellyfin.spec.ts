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
  JellyfinMediaStream,
  JellyfinSubtitleItem,
  toExternalSubtitles,
  toEpisodeSubtitleMap,
  toPresentLanguages,
  toRemoteCandidates,
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

// Spec 101, REQ-1: the listing decides which sidecars an administrator may
// fold into the .mkv. Jellyfin also reports embedded streams and subtitles
// cached in its own metadata folder; keeping one of those offers an embed
// that cannot be done, and nothing throws until the confirm step. Each
// dropped case below fails if its filter is removed.
describe('toExternalSubtitles', () => {
  const media = '/lib/Movies/Green Book (2018)/Green Book (2018).mkv';
  const srt = (over: Partial<JellyfinMediaStream> = {}): JellyfinMediaStream => ({
    Type: 'Subtitle',
    IsExternal: true,
    Codec: 'subrip',
    Path: '/lib/Movies/Green Book (2018)/Green Book (2018).spa.srt',
    Language: 'spa',
    IsForced: false,
    DisplayTitle: 'Spanish - SUBRIP - External',
    ...over,
  });

  it('keeps a well-formed sidecar beside the media file', () => {
    expect(toExternalSubtitles(media, [srt()])).toEqual([
      {
        hostPath: '/lib/Movies/Green Book (2018)/Green Book (2018).spa.srt',
        languageIso3: 'spa',
        isForced: false,
        displayTitle: 'Spanish - SUBRIP - External',
      },
    ]);
  });

  it('drops an embedded stream', () => {
    expect(toExternalSubtitles(media, [srt({ IsExternal: false })])).toEqual([]);
  });

  it('drops a non-subrip codec', () => {
    expect(toExternalSubtitles(media, [srt({ Codec: 'ass' })])).toEqual([]);
  });

  it('drops a stream with no path', () => {
    expect(toExternalSubtitles(media, [srt({ Path: undefined })])).toEqual([]);
  });

  it('drops a non-subtitle stream', () => {
    expect(toExternalSubtitles(media, [srt({ Type: 'Audio' })])).toEqual([]);
  });

  it('drops an .srt in another directory (Jellyfin metadata folder)', () => {
    expect(
      toExternalSubtitles(media, [srt({ Path: '/config/metadata/x.spa.srt' })]),
    ).toEqual([]);
  });

  it('drops a file that is not .srt', () => {
    expect(
      toExternalSubtitles(media, [
        srt({ Path: '/lib/Movies/Green Book (2018)/Green Book (2018).spa.sub' }),
      ]),
    ).toEqual([]);
  });

  it('accepts an upper-case .SRT extension', () => {
    expect(
      toExternalSubtitles(media, [
        srt({ Path: '/lib/Movies/Green Book (2018)/Green Book (2018).spa.SRT' }),
      ]),
    ).toHaveLength(1);
  });

  it('keeps a missing language as null', () => {
    const [only] = toExternalSubtitles(media, [srt({ Language: undefined })]);
    expect(only.languageIso3).toBeNull();
  });

  it('returns nothing for an item with no media path', () => {
    expect(toExternalSubtitles(undefined, [srt()])).toEqual([]);
  });
});

describe('toEpisodeSubtitleMap', () => {
  const item = (over: Partial<JellyfinSubtitleItem>): JellyfinSubtitleItem => ({
    Id: 'ep',
    Path: '/lib/Shows/S/Season 1/S - S01E02.mkv',
    ParentIndexNumber: 1,
    IndexNumber: 2,
    MediaStreams: [
      {
        Type: 'Subtitle',
        IsExternal: true,
        Codec: 'subrip',
        Path: '/lib/Shows/S/Season 1/S - S01E02.spa.srt',
        Language: 'spa',
      },
    ],
    ...over,
  });

  it('keys each episode by season and episode number', () => {
    const map = toEpisodeSubtitleMap([item({}), item({ Id: 'ep2', IndexNumber: 3 })]);
    expect(map.get('1:2')?.itemId).toBe('ep');
    expect(map.get('1:3')?.itemId).toBe('ep2');
    expect(map.get('1:2')?.subtitles).toHaveLength(1);
  });

  it('excludes a Virtual episode', () => {
    expect(toEpisodeSubtitleMap([item({ LocationType: 'Virtual' })]).size).toBe(0);
  });

  it('excludes an episode with no number', () => {
    expect(toEpisodeSubtitleMap([item({ IndexNumber: null })]).size).toBe(0);
  });
});

describe('Jellyfin subtitle requests', () => {
  const client = () =>
    createJellyfinClient(
      { host: 'h', port: '8096', apiKey: 'k' },
      { lookup: async () => null },
    );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A Modified notification sent as 'created' makes Jellyfin ignore a file it
  // already knows, so the new tracks never show up and nothing errors.
  it('modifiedMedia sends UpdateType Modified and createdMedia keeps created', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client().modifiedMedia!('/lib/x.mkv');
    await client().createdMedia('/lib/x.mkv');

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(bodies[0]).toEqual({ Updates: [{ Path: '/lib/x.mkv', UpdateType: 'Modified' }] });
    expect(bodies[1]).toEqual({ Updates: [{ Path: '/lib/x.mkv', UpdateType: 'created' }] });
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe('/Library/Media/Updated');
  });

  // Without fields=MediaStreams,Path the default field set carries neither,
  // so every listing is empty with no error.
  it('asks for MediaStreams and Path on both listings', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [{ Id: 'm', Path: '/a/b.mkv' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const one = await client().listItemSubtitles!('m');
    await client().listSeriesEpisodeSubtitles!('s');

    expect(one).toEqual({
      itemId: 'm',
      mediaHostPath: '/a/b.mkv',
      subtitles: [],
      presentLanguagesIso3: [],
    });
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('fields')).toBe('MediaStreams,Path');
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe('/Items');
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('ids')).toBe('m');
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get('fields')).toBe('MediaStreams,Path');
  });
});

// Spec 103, REQ-7: a language is "missing" when this list lacks it. A forced
// stream wrongly counted would make a forced-only language read as present, and
// the full subtitles would never be searched, with no error anywhere.
describe('toPresentLanguages', () => {
  it('excludes forced streams', () => {
    expect(
      toPresentLanguages([
        { Type: 'Subtitle', Language: 'spa', IsForced: true },
        { Type: 'Subtitle', Language: 'eng' },
      ]),
    ).toEqual(['eng']);
  });

  it('counts embedded and external streams of any codec, once per language', () => {
    expect(
      toPresentLanguages([
        { Type: 'Subtitle', Language: 'eng', IsExternal: false, Codec: 'hdmv_pgs_subtitle' },
        { Type: 'Subtitle', Language: 'ENG', IsExternal: true, Codec: 'subrip' },
        { Type: 'Subtitle', Language: 'spa', IsExternal: true, Codec: 'ass' },
      ]),
    ).toEqual(['eng', 'spa']);
  });

  it('ignores audio streams and streams with no language', () => {
    expect(
      toPresentLanguages([
        { Type: 'Audio', Language: 'eng' },
        { Type: 'Subtitle', Language: null },
        { Type: 'Subtitle' },
      ]),
    ).toEqual([]);
  });
});

// Spec 103, REQ-8: an absent Forced/MachineTranslated/AiTranslated flag
// reading as true would drop every candidate, and as undefined would let a
// machine translation through the filter.
describe('toRemoteCandidates', () => {
  it('reads absent remote booleans as false', () => {
    const [candidate] = toRemoteCandidates(
      [{ Id: 'a', ThreeLetterISOLanguageName: 'spa', Name: 'Movie.2020', Format: 'srt' }],
      'spa',
    );

    expect(candidate).toEqual({
      id: 'a',
      languageIso3: 'spa',
      name: 'Movie.2020',
      format: 'srt',
      isForced: false,
      isHearingImpaired: false,
      isMachineTranslated: false,
      isAiTranslated: false,
      isHashMatch: false,
      downloadCount: 0,
    });
  });

  it('maps the true flags and drops an entry with no id', () => {
    const result = toRemoteCandidates(
      [
        { Id: 'b', Forced: true, HearingImpaired: true, MachineTranslated: true, AiTranslated: true, IsHashMatch: true, DownloadCount: 9 },
        { Name: 'no id' },
      ],
      'eng',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      languageIso3: 'eng',
      isForced: true,
      isHearingImpaired: true,
      isMachineTranslated: true,
      isAiTranslated: true,
      isHashMatch: true,
      downloadCount: 9,
    });
  });
});

describe('Jellyfin remote subtitle requests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const client = () =>
    createJellyfinClient(
      { host: 'h', port: '8096', apiKey: 'k' },
      { lookup: async () => null },
    );

  it('searches by item and language, and fetches the body as bytes', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ Id: 'x/y', Format: 'srt' }] })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([104, 105]).buffer });
    global.fetch = fetchMock as unknown as typeof fetch;

    const found = await client().searchRemoteSubtitles!('item1', 'spa');
    const bytes = await client().fetchRemoteSubtitle!('x/y');

    expect(found.map((c) => c.id)).toEqual(['x/y']);
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe('/Items/item1/RemoteSearch/Subtitles/spa');
    expect((fetchMock.mock.calls[1][0] as URL).pathname).toBe('/Providers/Subtitles/Subtitles/x%2Fy');
    expect(bytes.toString()).toBe('hi');
  });

  it('throws on a non-ok response so the driver can record the failure', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as unknown as typeof fetch;

    await expect(client().searchRemoteSubtitles!('i', 'spa')).rejects.toThrow('500');
    await expect(client().fetchRemoteSubtitle!('i')).rejects.toThrow('500');
  });
});
