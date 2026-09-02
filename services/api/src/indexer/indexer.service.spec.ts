import { Test, TestingModule } from '@nestjs/testing';
import { IndexerService } from './indexer.service';
import { ProwlarrClient } from '@/clients/indexer/client';
import { RedisService } from '@/redis/redis.service';
import { TorrentResult } from '@/clients/indexer/types';

// This suite exists because 040-indexer-search-cache's read-through sits on
// top of four invariants that a perfectly successful response cannot reveal
// on its own — every failure mode below leaves the caller's list looking
// correct while breaking something no one is watching:
//
//  - caching a Prowlarr failure (by letting the throw reach the write, or by
//    substituting an empty list for it) makes a title look like it has zero
//    releases for ten minutes, with no error anywhere. Only asserting
//    `redis.set` was never called after a rejection can catch it.
//  - the write is dispatched, not awaited (REQ-2b), so it lands one
//    microtask after `search()` resolves. A naive assertion right after
//    `await search()` sees nothing and "fixing" it by deleting the
//    assertion is exactly how the cache silently stops populating while
//    every response still looks perfect — this is why one test explicitly
//    flushes the microtask queue (`await Promise.resolve()`) before
//    checking `redis.set`, and that flush must not be removed just because
//    the test reads as redundant without it.
//  - treating an empty cached array as falsy (instead of checking
//    `raw === null`) would re-hit Prowlarr on every search for a title with
//    no seeded release, defeating REQ-6 with no visible symptom.
//  - a rejected `redis.get`/`redis.set` must never surface as an error to
//    the caller (NFR-1) and must never crash the process via an unobserved
//    rejected promise (the deferred write risk in `../plan.md` § Risks).
describe('IndexerService', () => {
  let service: IndexerService;
  let prowlarr: { search: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };

  const release = (overrides: Partial<TorrentResult> = {}): TorrentResult => ({
    id: 'abc',
    infoHash: 'ABCDEF',
    title: 'The Matrix',
    size: 123456,
    seeders: 10,
    leechers: 2,
    items: [{ downloadUrl: null }],
    infoUrl: [{ downloadUrl: null }],
    ...overrides,
  });

  const flushMicrotasksSoTheDeferredCacheWriteBecomesObservable = () => Promise.resolve();

  beforeEach(async () => {
    prowlarr = { search: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: ProwlarrClient, useValue: prowlarr },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
  });

  it('rethrows a Prowlarr failure and never caches it, even after flushing any deferred write', async () => {
    prowlarr.search.mockRejectedValue(new Error('error.indexer.unavailable'));

    await expect(service.search('matrix')).rejects.toThrow('error.indexer.unavailable');
    await flushMicrotasksSoTheDeferredCacheWriteBecomesObservable();

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('writes the cache only after the microtask queue is flushed, since the write is dispatched with void rather than awaited', async () => {
    const results = [release()];
    prowlarr.search.mockResolvedValue(results);

    const returned = await service.search('matrix');
    expect(returned).toEqual(results);

    await flushMicrotasksSoTheDeferredCacheWriteBecomesObservable();

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, written, mode, ttl] = redis.set.mock.calls[0];
    expect(key).toBe('indexer:search:matrix');
    expect(JSON.parse(written)).toEqual(results);
    expect(mode).toBe('EX');
    expect(ttl).toBe(60 * 10);
  });

  it('serves a cache hit without calling Prowlarr', async () => {
    const results = [release()];
    redis.get.mockResolvedValue(JSON.stringify(results));

    const returned = await service.search('matrix');

    expect(returned).toEqual(results);
    expect(prowlarr.search).not.toHaveBeenCalled();
  });

  it('serves a cached empty list as a hit, not a miss', async () => {
    redis.get.mockResolvedValue(JSON.stringify([]));

    const returned = await service.search('matrix');

    expect(returned).toEqual([]);
    expect(prowlarr.search).not.toHaveBeenCalled();
  });

  it('normalizes whitespace and case to the same cache key', async () => {
    prowlarr.search.mockResolvedValue([]);

    await service.search('  MaTrix  ');

    expect(redis.get).toHaveBeenCalledWith('indexer:search:matrix');

    await flushMicrotasksSoTheDeferredCacheWriteBecomesObservable();

    expect(redis.set).toHaveBeenCalledWith(
      'indexer:search:matrix',
      expect.any(String),
      'EX',
      60 * 10,
    );
  });

  it('falls through to a live call when redis.get rejects', async () => {
    redis.get.mockRejectedValue(new Error('connection refused'));
    const results = [release()];
    prowlarr.search.mockResolvedValue(results);

    const returned = await service.search('matrix');

    expect(returned).toEqual(results);
    expect(prowlarr.search).toHaveBeenCalledWith('matrix');
  });

  it('still resolves with live results when redis.set rejects, and the rejection never escapes as an unhandled rejection', async () => {
    redis.set.mockRejectedValue(new Error('connection refused'));
    const results = [release()];
    prowlarr.search.mockResolvedValue(results);

    const returned = await service.search('matrix');
    expect(returned).toEqual(results);

    await flushMicrotasksSoTheDeferredCacheWriteBecomesObservable();
    await flushMicrotasksSoTheDeferredCacheWriteBecomesObservable();
  });

  it('returns an empty list for a blank query without touching Redis or Prowlarr', async () => {
    const returned = await service.search('   ');

    expect(returned).toEqual([]);
    expect(redis.get).not.toHaveBeenCalled();
    expect(prowlarr.search).not.toHaveBeenCalled();
  });
});
