import { Test, TestingModule } from '@nestjs/testing';
import { IndexerService } from './indexer.service';
import { IndexerHttpError, ProwlarrClient } from '@/clients/indexer/client';
import { RedisService } from '@/redis/redis.service';
import { TorrentResult } from '@/clients/indexer/types';

// This suite exists because `status()`'s mapping of a Prowlarr failure to
// `{ configuredIndexers: 0, reachable: false }` (078-first-step-tutorial) has two distinct wrong
// ways to fail with no error anywhere: a catch too wide would report a healthy Prowlarr as
// unreachable whenever `countIndexers()` throws for any reason, including a bug in this service
// itself; a catch too narrow — or one that swallows silently — would make the one page meant to
// explain a broken indexer fail to render, or fail to explain why. Each of the three outcomes is
// asserted on its own so a regression in any one of them shows up here rather than on `/first-step`.
describe('IndexerService.status', () => {
  let service: IndexerService;
  let prowlarr: { countIndexers: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    prowlarr = { countIndexers: jest.fn() };
    redis = { get: jest.fn(), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: ProwlarrClient, useValue: prowlarr },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
  });

  it('reports zero configured indexers as reachable, not as a failure', async () => {
    prowlarr.countIndexers.mockResolvedValue(0);

    await expect(service.status()).resolves.toEqual({
      configuredIndexers: 0,
      reachable: true,
    });
  });

  it('reports a positive count as reachable', async () => {
    prowlarr.countIndexers.mockResolvedValue(3);

    await expect(service.status()).resolves.toEqual({
      configuredIndexers: 3,
      reachable: true,
    });
  });

  it('maps a thrown INDEXER_UNAVAILABLE to an unreachable outcome instead of rethrowing', async () => {
    prowlarr.countIndexers.mockRejectedValue(new Error('error.indexer.unavailable'));

    await expect(service.status()).resolves.toEqual({
      configuredIndexers: 0,
      reachable: false,
    });
  });
});

// This suite exists because Spec 040's read-through sits on
// top of four invariants that a perfectly successful response cannot reveal
// on its own — every failure mode below leaves the caller's list looking
// correct while breaking something no one is watching:
//
//  - caching a Prowlarr failure (by letting the throw reach the write, or by
//    substituting an empty list for it) makes a title look like it has zero
//    releases for ten minutes, with no error anywhere. Only asserting
//    `redis.set` was never called after a rejection can catch it.
//  - the write is dispatched, not awaited (Spec 040, REQ-2b), so it lands one
//    microtask after `search()` resolves. A naive assertion right after
//    `await search()` sees nothing and "fixing" it by deleting the
//    assertion is exactly how the cache silently stops populating while
//    every response still looks perfect — this is why one test explicitly
//    flushes the microtask queue (`await Promise.resolve()`) before
//    checking `redis.set`, and that flush must not be removed just because
//    the test reads as redundant without it.
//  - treating an empty cached array as falsy (instead of checking
//    `raw === null`) would re-hit Prowlarr on every search for a title with
//    no seeded release, defeating Spec 040, REQ-6 with no visible symptom.
//  - a rejected `redis.get`/`redis.set` must never surface as an error to
//    the caller (Spec 040, NFR-1) and must never crash the process via an unobserved
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

// This suite exists because the in-app indexer setup (Spec 112) fails silently in four ways a
// successful-looking response hides: adding a definition Prowlarr already holds doubles every
// search result; resolving an add whose connection test failed shows a dead indexer as working;
// saving a Cloudflare-fronted indexer without its FlareSolverr tag makes every search through it
// return nothing; and Prowlarr answers DELETE of an unknown id with 200, so without the prior
// listing a stale id would report success. A Redis outage must never take the catalog down.
describe('IndexerService catalog management', () => {
  let service: IndexerService;
  let prowlarr: Record<string, jest.Mock>;
  let redis: { get: jest.Mock; set: jest.Mock };

  const def = (definitionName: string, over: Record<string, unknown> = {}) => ({
    definitionName,
    name: definitionName,
    privacy: 'public',
    protocol: 'torrent',
    indexerUrls: ['https://example.invalid/'],
    capabilities: { categories: [{ id: 2000, subCategories: [] }] },
    fields: [{ name: 'baseUrl', value: '' }],
    ...over,
  });
  const marked = def('example-cf', { fields: [{ name: 'info_flaresolverr' }] });

  beforeEach(async () => {
    prowlarr = {
      getIndexerSchema: jest.fn().mockResolvedValue([
        def('example-b'),
        def('example-a'),
        marked,
        def('example-private', { privacy: 'private' }),
      ]),
      listIndexers: jest.fn().mockResolvedValue([]),
      listTags: jest.fn().mockResolvedValue([{ id: 7, label: 'flaresolverr' }]),
      listAppProfiles: jest.fn().mockResolvedValue([{ id: 1 }]),
      createIndexer: jest.fn().mockResolvedValue({
        id: 42, name: 'example-a', definitionName: 'example-a', enable: true, tags: [], apiKey: 'secret',
      }),
      deleteIndexer: jest.fn().mockResolvedValue(undefined),
    };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: ProwlarrClient, useValue: prowlarr },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(IndexerService);
  });

  it('makes no create call for a definition that is already held', async () => {
    prowlarr.listIndexers.mockResolvedValue([
      { id: 5, name: 'example-a', definitionName: 'example-a', enable: true, tags: [] },
    ]);

    await expect(service.add('example-a')).resolves.toMatchObject({ id: 5 });
    expect(prowlarr.createIndexer).not.toHaveBeenCalled();
  });

  it('rejects test_failed on a create 400 and never resolves as added', async () => {
    prowlarr.createIndexer.mockRejectedValue(new IndexerHttpError(400, 'unable to connect'));

    await expect(service.add('example-a')).rejects.toMatchObject({
      response: { i18n: { key: 'error.indexer.test_failed' } },
    });
  });

  it('rejects flaresolverr_missing with no create call when the tag is absent', async () => {
    prowlarr.listTags.mockResolvedValue([]);

    await expect(service.add('example-cf')).rejects.toMatchObject({
      response: { i18n: { key: 'error.indexer.flaresolverr_missing' } },
    });
    expect(prowlarr.createIndexer).not.toHaveBeenCalled();
  });

  it('rejects definition_not_allowed for an unknown or private id with no create call', async () => {
    for (const name of ['example-private', 'example-unknown']) {
      await expect(service.add(name)).rejects.toMatchObject({
        response: { i18n: { key: 'error.indexer.definition_not_allowed' } },
      });
    }
    expect(prowlarr.createIndexer).not.toHaveBeenCalled();
  });

  it('returns only the projected fields of a created indexer', async () => {
    await expect(service.add('example-a')).resolves.toEqual({
      id: 42, name: 'example-a', definitionName: 'example-a', enabled: true, usesFlareSolverr: false,
    });
  });

  it('rejects not_found for an id absent from the list and makes no delete call', async () => {
    prowlarr.listIndexers.mockResolvedValue([{ id: 1 }]);

    await expect(service.remove(99)).rejects.toMatchObject({
      response: { i18n: { key: 'error.indexer.not_found' } },
    });
    expect(prowlarr.deleteIndexer).not.toHaveBeenCalled();
  });

  it('deletes a listed id', async () => {
    prowlarr.listIndexers.mockResolvedValue([{ id: 1 }]);

    await expect(service.remove(1)).resolves.toBe(true);
    expect(prowlarr.deleteIndexer).toHaveBeenCalledWith(1);
  });

  it('answers the catalog sorted, filtered and flagged live even when Redis throws', async () => {
    redis.get.mockRejectedValue(new Error('down'));
    redis.set.mockRejectedValue(new Error('down'));
    prowlarr.listIndexers.mockResolvedValue([{ id: 1, definitionName: 'example-b' }]);

    const all = await service.catalog();
    expect(all.map((e) => [e.name, e.configured])).toEqual([
      ['example-a', false],
      ['example-b', true],
      ['example-cf', false],
    ]);
    expect((await service.catalog('CF')).map((e) => e.name)).toEqual(['example-cf']);
  });

  it('computes configured live from a cached projection', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify([{ definitionName: 'example-a', name: 'example-a', language: null, categories: ['MOVIES'], needsFlareSolverr: false }]),
    );
    prowlarr.listIndexers.mockResolvedValue([{ id: 1, definitionName: 'example-a' }]);

    const result = await service.catalog();
    expect(result[0].configured).toBe(true);
    expect(prowlarr.getIndexerSchema).not.toHaveBeenCalled();
  });

  it('marks usesFlareSolverr from the tag id in configured()', async () => {
    prowlarr.listIndexers.mockResolvedValue([
      { id: 2, name: 'b', definitionName: 'b', enable: true, tags: [7] },
      { id: 1, name: 'a', definitionName: 'a', enable: false, tags: [] },
    ]);

    const result = await service.configured();
    expect(result.map((r) => [r.name, r.usesFlareSolverr, r.enabled])).toEqual([
      ['a', false, false],
      ['b', true, true],
    ]);
  });
});
