jest.mock('@tus/server', () => ({ Server: class {} }));
jest.mock('@tus/file-store', () => ({ FileStore: class {} }));

import { AcquireMoviesTask, buildMovieQuery, MAX_MOVIES_PER_RUN } from './acquire-movies.task';

// This suite defends against the ways the daily film sweep can go wrong with no error anywhere:
// a film already downloading or completed gets a second source, the per-run cap lets a backlog
// flood qBittorrent (or starves the oldest window), one failing film aborts the rest, an all-failed
// run is recorded as SUCCESS and hides an outage while an all-skipped run is wrongly failed, a
// closed window's source-quality floor never reaches the ranking so a cam release is attached, and
// an idle install still hits the indexer. Each case is written to fail when its rule is removed.
describe('AcquireMoviesTask', () => {
  const NOW = new Date('2026-09-26T15:30:00.000Z');
  const context = { languageRequirement: null, preferredGroups: [], allowCinemaReleases: true };

  let prisma: { movie: { findMany: jest.Mock } };
  let indexer: { searchRanked: jest.Mock };
  let rankingContext: { forMovieOwners: jest.Mock };
  let movies: { addTorrentToMovie: jest.Mock };
  let task: AcquireMoviesTask;

  const candidateRow = (infoHash = 'abc') => ({
    id: 'r',
    infoHash,
    title: 'Film 2026 1080p',
    items: [{ downloadUrl: 'http://x/1' }, { downloadUrl: null }],
    candidate: true,
    candidateRank: 1,
  });

  const film = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    title: 'Film: The Sequel!',
    releaseDate: new Date('2026-08-01T00:00:00.000Z'),
    status: 'MISSING',
    filePath: null,
    mediaServerPresentAt: null,
    mediaSources: [],
    processJobs: [],
    theatricalReleaseDate: null,
    digitalReleaseDate: new Date('2026-09-01T00:00:00.000Z'),
    physicalReleaseDate: null,
    // Spec 089, REQ-4
    ...(overrides.status === 'COMPLETED' && overrides.filePath === undefined
      ? { filePath: '/library/film.mkv' }
      : {}),
    ...overrides,
  });

  const owners = (userId = 'oldest') => ({
    context,
    owners: [
      {
        userId,
        acquireTheatrical: false,
        acquireDigital: true,
        acquirePhysical: false,
        allowCinemaReleases: true,
      },
    ],
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = { movie: { findMany: jest.fn().mockResolvedValue([]) } };
    indexer = { searchRanked: jest.fn().mockResolvedValue([candidateRow()]) };
    rankingContext = { forMovieOwners: jest.fn().mockResolvedValue(owners()) };
    movies = { addTorrentToMovie: jest.fn().mockResolvedValue({}) };
    task = new AcquireMoviesTask(
      prisma as never,
      indexer as never,
      rankingContext as never,
      movies as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('builds the query with the cleaned title and release year, none when the date is null', () => {
    expect(buildMovieQuery('Film: The  Sequel!', new Date('2026-08-01T00:00:00.000Z'))).toBe(
      'Film The Sequel 2026',
    );
    expect(buildMovieQuery('Film: The  Sequel!', null)).toBe('Film The Sequel');
  });

  it('never selects a film in flight or completed', async () => {
    prisma.movie.findMany.mockResolvedValue([
      film(1, { mediaSources: [{ status: 'DOWNLOADING' }] }),
      film(2, { status: 'COMPLETED' }),
      film(3, { processJobs: [{ status: 'ENCODING' }] }),
      film(4),
    ]);
    const result = await task.run();
    expect(movies.addTorrentToMovie).toHaveBeenCalledTimes(1);
    expect(movies.addTorrentToMovie.mock.calls[0][0]).toBe(4);
    expect(result).toEqual({ itemsProcessed: 1 });
  });

  it('makes zero indexer calls when nothing is eligible', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1, { status: 'COMPLETED' })]);
    await task.run();
    expect(indexer.searchRanked).not.toHaveBeenCalled();
    expect(rankingContext.forMovieOwners).not.toHaveBeenCalled();
  });

  it('skips a film whose window has not opened yet', async () => {
    prisma.movie.findMany.mockResolvedValue([
      film(1, { digitalReleaseDate: new Date('2026-09-26T00:00:00.000Z') }),
    ]);
    await task.run();
    expect(indexer.searchRanked).not.toHaveBeenCalled();
  });

  it('caps a run at the limit and takes the oldest windows first', async () => {
    const rows = Array.from({ length: MAX_MOVIES_PER_RUN + 5 }, (_, i) =>
      film(i + 1, {
        digitalReleaseDate: new Date(Date.UTC(2026, 7, 30 - i)),
      }),
    );
    prisma.movie.findMany.mockResolvedValue(rows);
    const result = await task.run();
    expect(MAX_MOVIES_PER_RUN).toBe(20);
    expect(indexer.searchRanked).toHaveBeenCalledTimes(20);
    const attachedIds = movies.addTorrentToMovie.mock.calls.map((c) => c[0]);
    expect(attachedIds).toEqual(
      Array.from({ length: 20 }, (_, i) => 25 - i),
    );
    expect(result.itemsProcessed).toBe(20);
  });

  it('passes the window source-rank floor into the search context', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1)]);
    await task.run();
    expect(indexer.searchRanked).toHaveBeenCalledWith('Film The Sequel 2026', {
      ...context,
      minSourceRank: 4,
    });
  });

  it('attaches as the oldest owner without force', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1)]);
    await task.run();
    expect(movies.addTorrentToMovie).toHaveBeenCalledWith(
      1,
      {
        infoHash: 'abc',
        urls: ['http://x/1'],
        releaseTitle: 'Film 2026 1080p',
        force: false,
      },
      'oldest',
    );
  });

  it('leaves the rest attached when one film fails', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1), film(2), film(3)]);
    movies.addTorrentToMovie
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({});
    const result = await task.run();
    expect(movies.addTorrentToMovie).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ itemsProcessed: 2 });
  });

  it('rethrows when every attempt failed', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1), film(2)]);
    movies.addTorrentToMovie.mockRejectedValue(new Error('boom'));
    await expect(task.run()).rejects.toThrow(/all 2 attempted movie/);
  });

  it('does not rethrow when every film was skipped for lack of a candidate', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1), film(2)]);
    indexer.searchRanked.mockResolvedValue([{ ...candidateRow(), candidateRank: 2 }]);
    await expect(task.run()).resolves.toEqual({ itemsProcessed: 0 });
    expect(movies.addTorrentToMovie).not.toHaveBeenCalled();
  });

  it('does not rethrow when a failure is mixed with a skip', async () => {
    prisma.movie.findMany.mockResolvedValue([film(1), film(2)]);
    indexer.searchRanked
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([]);
    await expect(task.run()).resolves.toEqual({ itemsProcessed: 0 });
  });
});
