import { AcquireEpisodesTask, buildEpisodeQuery, MAX_EPISODES_PER_RUN } from './acquire-episodes.task';
import { AUTO_ACQUIRE_EPISODES_SINCE_KEY } from '../scheduler.registry';

// This suite defends against the ways the daily episode sweep can go wrong with no error anywhere:
// a grace boundary off by one downloads an episode on its air day (or never), a missing or ignored
// cutoff sweeps a series' whole history into qBittorrent, an episode already in flight (its own
// source, or a season pack) gets a second source, one failing episode aborts the rest of the run,
// and a run where every attempt failed is recorded as SUCCESS and hides an outage. Each case is
// written to fail when the rule it covers is removed.
describe('AcquireEpisodesTask', () => {
  const NOW = new Date('2026-09-26T15:30:00.000Z');

  let prisma: {
    episode: { findMany: jest.Mock };
    setting: { findUnique: jest.Mock; upsert: jest.Mock };
    userShow: { findFirst: jest.Mock };
  };
  let indexer: { searchRanked: jest.Mock };
  let rankingContext: { forShowOwners: jest.Mock };
  let episodes: { addTorrentToEpisode: jest.Mock };
  let task: AcquireEpisodesTask;

  const candidateRow = (infoHash = 'abc') => ({
    id: 'r',
    infoHash,
    title: 'Show S01E01 1080p',
    items: [{ downloadUrl: 'http://x/1' }, { downloadUrl: null }],
    candidate: true,
    candidateRank: 1,
  });

  const episode = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    episodeNumber: id,
    releaseDate: new Date('2026-09-20T00:00:00.000Z'),
    status: 'MISSING',
    mediaSources: [],
    processJobs: [],
    season: {
      seasonNumber: 1,
      mediaSources: [],
      show: { id: 7, title: "Show: The Sequel!" },
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      episode: { findMany: jest.fn().mockResolvedValue([]) },
      setting: {
        findUnique: jest.fn().mockResolvedValue({ value: '2026-09-01T00:00:00.000Z' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      userShow: { findFirst: jest.fn().mockResolvedValue({ userId: 'oldest' }) },
    };
    indexer = { searchRanked: jest.fn().mockResolvedValue([candidateRow()]) };
    rankingContext = {
      forShowOwners: jest.fn().mockResolvedValue({
        languageRequirement: null,
        preferredGroups: [],
        allowCinemaReleases: true,
      }),
    };
    episodes = { addTorrentToEpisode: jest.fn().mockResolvedValue({}) };
    task = new AcquireEpisodesTask(
      prisma as never,
      indexer as never,
      rankingContext as never,
      episodes as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('builds the query the UI prefills', () => {
    expect(buildEpisodeQuery("Show: The  Sequel!", 1, 2)).toBe('Show The Sequel S01E02');
    expect(buildEpisodeQuery('X', 12, 103)).toBe('X S12E103');
  });

  it('selects only episodes at least one full UTC day old, on or after the cutoff day', async () => {
    await task.run();
    const where = prisma.episode.findMany.mock.calls[0][0].where;
    expect(where.releaseDate.lte).toEqual(new Date('2026-09-25T00:00:00.000Z'));
    expect(where.releaseDate.gte).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    expect(where.season.seasonNumber).toEqual({ not: 0 });
    expect(where.season.show).toEqual({ users: { some: {} } });
  });

  it('orders the selection by air date ascending', async () => {
    await task.run();
    expect(prisma.episode.findMany.mock.calls[0][0].orderBy).toEqual({ releaseDate: 'asc' });
  });

  it('stamps an empty cutoff to now and uses it as the lower bound', async () => {
    prisma.setting.findUnique.mockResolvedValue({ value: '' });
    await task.run();
    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY } }),
    );
    const where = prisma.episode.findMany.mock.calls[0][0].where;
    expect(where.releaseDate.gte).toEqual(new Date('2026-09-26T00:00:00.000Z'));
  });

  it('stamps an unparseable cutoff instead of sweeping without a lower bound', async () => {
    prisma.setting.findUnique.mockResolvedValue({ value: 'garbage' });
    await task.run();
    expect(prisma.setting.upsert).toHaveBeenCalled();
    const where = prisma.episode.findMany.mock.calls[0][0].where;
    expect(where.releaseDate.gte).toEqual(new Date('2026-09-26T00:00:00.000Z'));
  });

  it('does not touch a valid cutoff', async () => {
    await task.run();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('skips an episode that has its own live source', async () => {
    prisma.episode.findMany.mockResolvedValue([
      episode(1, { mediaSources: [{ status: 'DOWNLOADING' }] }),
    ]);
    const result = await task.run();
    expect(result.itemsProcessed).toBe(0);
    expect(indexer.searchRanked).not.toHaveBeenCalled();
  });

  it('skips an aired episode whose season has a pack in flight', async () => {
    prisma.episode.findMany.mockResolvedValue([
      episode(1, {
        season: {
          seasonNumber: 1,
          mediaSources: [{ status: 'DOWNLOADING' }],
          show: { id: 7, title: 'Show' },
        },
      }),
    ]);
    await task.run();
    expect(indexer.searchRanked).not.toHaveBeenCalled();
    expect(episodes.addTorrentToEpisode).not.toHaveBeenCalled();
  });

  it('attaches the rank-1 candidate as the oldest owner with force false', async () => {
    prisma.episode.findMany.mockResolvedValue([episode(1)]);
    indexer.searchRanked.mockResolvedValue([
      { ...candidateRow('second'), candidateRank: 2 },
      candidateRow('first'),
    ]);
    const result = await task.run();
    expect(result.itemsProcessed).toBe(1);
    expect(indexer.searchRanked).toHaveBeenCalledWith('Show The Sequel S01E01', expect.anything());
    expect(episodes.addTorrentToEpisode).toHaveBeenCalledWith(
      1,
      {
        infoHash: 'first',
        urls: ['http://x/1'],
        releaseTitle: 'Show S01E01 1080p',
        force: false,
      },
      'oldest',
    );
  });

  it('leaves an episode alone when no candidate exists and does not fail the run', async () => {
    prisma.episode.findMany.mockResolvedValue([episode(1)]);
    indexer.searchRanked.mockResolvedValue([{ ...candidateRow(), candidate: false, candidateRank: null }]);
    const result = await task.run();
    expect(result.itemsProcessed).toBe(0);
    expect(episodes.addTorrentToEpisode).not.toHaveBeenCalled();
  });

  it('caps the run at 20 episodes, keeping the oldest first', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => episode(i + 1));
    prisma.episode.findMany.mockResolvedValue(rows);
    const result = await task.run();
    expect(result.itemsProcessed).toBe(MAX_EPISODES_PER_RUN);
    expect(episodes.addTorrentToEpisode.mock.calls.map((c) => c[0])).toEqual(
      rows.slice(0, MAX_EPISODES_PER_RUN).map((r) => r.id),
    );
  });

  it('resolves the ranking context once per series', async () => {
    prisma.episode.findMany.mockResolvedValue([episode(1), episode(2), episode(3)]);
    await task.run();
    expect(rankingContext.forShowOwners).toHaveBeenCalledTimes(1);
  });

  it('keeps going after one episode fails and counts only what attached', async () => {
    prisma.episode.findMany.mockResolvedValue([episode(1), episode(2)]);
    episodes.addTorrentToEpisode.mockRejectedValueOnce(new Error('qbittorrent refused'));
    const result = await task.run();
    expect(result.itemsProcessed).toBe(1);
    expect(episodes.addTorrentToEpisode).toHaveBeenCalledTimes(2);
  });

  it('throws when every attempted episode failed', async () => {
    prisma.episode.findMany.mockResolvedValue([episode(1), episode(2)]);
    indexer.searchRanked.mockRejectedValue(new Error('indexer down'));
    await expect(task.run()).rejects.toThrow(/all 2 attempted/);
  });

  it('succeeds with zero when nothing was eligible', async () => {
    await expect(task.run()).resolves.toEqual({ itemsProcessed: 0 });
  });
});
