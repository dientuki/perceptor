import { Test, TestingModule } from '@nestjs/testing';
import { MediaSearchService } from './media-search.service';
import { MediaDispatchService } from './media-dispatch.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { MEDIA_TYPE } from '@/types/media';

// This suite exists because 026-multi-search's fan-out sits directly on top
// of three invariants that already fail with a perfectly successful response
// and nothing to notice:
//
//  - handing a service the enriched (post-ownership) object instead of the
//    catalog-only one to cache leaks this caller's inLibrary/mediaId into a
//    Redis key shared by every other user for 24h (006-media-search NFR-3,
//    restated here because this is a third code path that writes the same
//    keys) — the returned list looks identical either way, so only asserting
//    on what each per-type service is actually handed to cache can catch it;
//  - rebuilding the response by grouping instead of walking the original
//    catalog order silently reshuffles a mixed page (films first, then
//    series) instead of preserving the ranking TMDB returned (REQ-1);
//  - looking a result up by its bare TMDB id after regrouping collides a
//    film and a series that happen to share an id — the wrong one's
//    ownership (or the wrong one entirely) lands on a card with no error
//    anywhere, since both are valid MediaSearchResult shapes;
//  - a caller-scoping bug in ownership enrichment reports someone else's
//    library as the caller's own, a successful response with wrong contents
//    (NFR-2).
describe('MediaSearchService', () => {
  let service: MediaSearchService;
  let tmdb: { searchMulti: jest.Mock };
  let movies: { cacheAndEnrich: jest.Mock };
  let shows: { cacheAndEnrich: jest.Mock };
  let dispatch: { resolve: jest.Mock };

  const filmRow = (overrides = {}) => ({
    id: 42,
    title: 'Dune',
    releaseDate: '2021-10-21',
    posterUrl: 'https://image.tmdb.org/t/p/w300/dune.jpg',
    originalLanguage: 'en',
    overview: 'Sand.',
    type: MEDIA_TYPE.MOVIE,
    ...overrides,
  });

  const seriesRow = (overrides = {}) => ({
    id: 7,
    title: 'Dune: Prophecy',
    releaseDate: '2024-11-17',
    posterUrl: 'https://image.tmdb.org/t/p/w300/prophecy.jpg',
    originalLanguage: 'en',
    overview: 'Sand, earlier.',
    type: MEDIA_TYPE.SHOW,
    ...overrides,
  });

  beforeEach(async () => {
    tmdb = { searchMulti: jest.fn() };
    movies = { cacheAndEnrich: jest.fn() };
    shows = { cacheAndEnrich: jest.fn() };
    dispatch = {
      resolve: jest.fn((type: string) => (type === MEDIA_TYPE.MOVIE ? movies : shows)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaSearchService,
        { provide: TmdbClient, useValue: tmdb },
        { provide: MediaDispatchService, useValue: dispatch },
      ],
    }).compile();

    service = module.get<MediaSearchService>(MediaSearchService);
  });

  it('hands each per-type service the catalog-only rows to cache, never this caller\'s ownership', async () => {
    const film = filmRow();
    const series = seriesRow();
    tmdb.searchMulti.mockResolvedValue([film, series]);
    movies.cacheAndEnrich.mockResolvedValue([{ ...film, mediaId: 5, inLibrary: true }]);
    shows.cacheAndEnrich.mockResolvedValue([{ ...series, mediaId: null, inLibrary: false }]);

    await service.searchAll('dune', 'user-1');

    // The failure mode here is invisible in the return value — cacheAndEnrich
    // itself decides what gets written to Redis. Asserting on what it was
    // *handed* is the only way to catch a caller that pre-enriches before
    // delegating.
    expect(movies.cacheAndEnrich).toHaveBeenCalledWith([film], 'user-1');
    expect(shows.cacheAndEnrich).toHaveBeenCalledWith([series], 'user-1');

    const [moviesArg] = movies.cacheAndEnrich.mock.calls[0];
    const [showsArg] = shows.cacheAndEnrich.mock.calls[0];
    for (const row of [...moviesArg, ...showsArg]) {
      expect(row).not.toHaveProperty('inLibrary');
      expect(row).not.toHaveProperty('mediaId');
    }
  });

  it('preserves catalog order across a film/series/film sequence', async () => {
    const first = filmRow({ id: 1, title: 'First' });
    const second = seriesRow({ id: 2, title: 'Second' });
    const third = filmRow({ id: 3, title: 'Third' });
    tmdb.searchMulti.mockResolvedValue([first, second, third]);

    // Grouped call receives [first, third] together; regrouping happens
    // internally, but the final order must still be first, second, third.
    movies.cacheAndEnrich.mockImplementation(async (rows) =>
      rows.map((r: typeof first) => ({ ...r, mediaId: null, inLibrary: false })),
    );
    shows.cacheAndEnrich.mockImplementation(async (rows) =>
      rows.map((r: typeof second) => ({ ...r, mediaId: null, inLibrary: false })),
    );

    const result = await service.searchAll('spider-man', 'user-1');

    expect(result.map(r => r.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('does not confuse a film and a series that share the same TMDB id', async () => {
    const film = filmRow({ id: 42 });
    const series = seriesRow({ id: 42 });
    tmdb.searchMulti.mockResolvedValue([film, series]);

    // Only the film is registered by the caller; a lookup keyed on the bare
    // id (rather than `${type}:${id}`) would land this ownership on whichever
    // group happens to be processed/inserted last, or on both.
    movies.cacheAndEnrich.mockResolvedValue([{ ...film, mediaId: 9, inLibrary: true }]);
    shows.cacheAndEnrich.mockResolvedValue([{ ...series, mediaId: null, inLibrary: false }]);

    const result = await service.searchAll('42', 'user-1');

    const filmResult = result.find(r => r.type === MEDIA_TYPE.MOVIE);
    const seriesResult = result.find(r => r.type === MEDIA_TYPE.SHOW);
    expect(filmResult).toEqual(expect.objectContaining({ mediaId: 9, inLibrary: true }));
    expect(seriesResult).toEqual(expect.objectContaining({ mediaId: null, inLibrary: false }));
  });

  it('reports another user\'s film and series as not owned by the caller', async () => {
    const film = filmRow();
    const series = seriesRow();
    tmdb.searchMulti.mockResolvedValue([film, series]);

    // Both registered, but by someone other than the caller — cacheAndEnrich
    // itself owns the scoping; this asserts the fan-out surfaces whatever it
    // returns rather than overriding it.
    movies.cacheAndEnrich.mockResolvedValue([{ ...film, mediaId: 5, inLibrary: false }]);
    shows.cacheAndEnrich.mockResolvedValue([{ ...series, mediaId: 3, inLibrary: false }]);

    const result = await service.searchAll('dune', 'user-2');

    expect(result).toEqual([
      expect.objectContaining({ mediaId: 5, inLibrary: false }),
      expect.objectContaining({ mediaId: 3, inLibrary: false }),
    ]);
  });

  it('returns an empty list for a blank query without contacting the catalog', async () => {
    const result = await service.searchAll('   ', 'user-1');

    expect(result).toEqual([]);
    expect(tmdb.searchMulti).not.toHaveBeenCalled();
  });
});
