// The composite (mediaType, tmdbId) key is the only thing keeping a film and
// a series that happen to share a TMDB id from clobbering each other's
// lookup — a collapsed key silently marks the wrong title COMPLETED, with
// nothing in any log to notice it by. Likewise, a rebuild that dies partway
// through must leave the previous, still-valid index in place rather than a
// half-populated one indistinguishable from a complete rebuild. Each case
// below is written to fail if the rule it defends against is removed.

import { Test, TestingModule } from '@nestjs/testing';
import { MediaServerIndexService } from './media-server-index.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import * as registry from '@/clients/media-server/registry';
import { MEDIA_TYPE } from '@/types/media';

describe('MediaServerIndexService', () => {
  let service: MediaServerIndexService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let update: jest.Mock;
  let deleteMany: jest.Mock;
  let createMany: jest.Mock;
  let $transaction: jest.Mock;
  let redisSet: jest.Mock;
  let redisDel: jest.Mock;
  let redisExists: jest.Mock;

  beforeEach(async () => {
    // Stateful stand-in for the three Setting rows, so readState() after a
    // rebuild reflects what writeState() actually wrote instead of a static
    // fixture — the same way the real `setting` table would.
    const settingRows = new Map<string, string>();

    findUnique = jest.fn();
    findMany = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Array.from(settingRows, ([key, value]) => ({ key, value })),
        ),
      );
    update = jest.fn().mockImplementation(({ where, data }) => {
      settingRows.set(where.key, data.value);
      return Promise.resolve({});
    });
    deleteMany = jest.fn().mockReturnValue('deleteMany-op');
    createMany = jest.fn().mockReturnValue('createMany-op');
    $transaction = jest.fn().mockResolvedValue(undefined);
    redisSet = jest.fn().mockResolvedValue('OK');
    redisDel = jest.fn().mockResolvedValue(1);
    redisExists = jest.fn().mockResolvedValue(0);

    const prisma = {
      mediaServerItem: { findUnique, deleteMany, createMany },
      setting: { findMany, update },
      $transaction,
    };

    const redis = { set: redisSet, del: redisDel, exists: redisExists };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaServerIndexService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<MediaServerIndexService>(MediaServerIndexService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('lookup', () => {
    it("resolves a film and a series with the same tmdbId to each one's own externalId", async () => {
      findUnique.mockImplementation(({ where }) => {
        const key = where.mediaType_tmdbId;
        if (key?.mediaType === MEDIA_TYPE.MOVIE && key?.tmdbId === 100) {
          return Promise.resolve({ externalId: 'movie-ext' });
        }
        if (key?.mediaType === MEDIA_TYPE.SHOW && key?.tmdbId === 100) {
          return Promise.resolve({ externalId: 'show-ext' });
        }
        return Promise.resolve(null);
      });

      // If mediaType were dropped from the composite key, both calls would
      // pass the same shape (just { tmdbId: 100 }) and neither branch above
      // would match — this must fail as soon as that guard is removed.
      await expect(service.lookup(MEDIA_TYPE.MOVIE, 100)).resolves.toBe(
        'movie-ext',
      );
      await expect(service.lookup(MEDIA_TYPE.SHOW, 100)).resolves.toBe(
        'show-ext',
      );
    });

    it('returns null when nothing matches', async () => {
      findUnique.mockResolvedValue(null);
      await expect(service.lookup(MEDIA_TYPE.MOVIE, 999)).resolves.toBeNull();
    });
  });

  describe('rebuild', () => {
    function mockClient(
      overrides: Partial<{ listLibrary: () => Promise<unknown> }> = {},
    ) {
      jest.spyOn(registry, 'createMediaServerClient').mockReturnValue({
        refreshLibrary: jest.fn(),
        createdMedia: jest.fn(),
        findByTmdbId: jest.fn(),
        listPresentEpisodes: jest.fn(),
        listLibrary: jest.fn().mockResolvedValue([]),
        ...overrides,
      } as never);
    }

    it('leaves the table and synced_at untouched when the enumeration throws, and records failed', async () => {
      mockClient({
        listLibrary: jest.fn().mockRejectedValue(new Error('jellyfin down')),
      });

      const result = await service.rebuild('jellyfin', {
        host: 'h',
        port: '1',
        apiKey: 'k',
      });

      expect($transaction).not.toHaveBeenCalled();
      // Only the state row moves — no count/syncedAt update call.
      expect(update).toHaveBeenCalledWith({
        where: { key: 'media_server_index_state' },
        data: { value: 'failed' },
      });
      expect(update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'media_server_index_synced_at' },
        }),
      );
      expect(update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'media_server_index_count' } }),
      );
      expect(redisDel).toHaveBeenCalled();
      expect(result.state).toBe('failed');
    });

    it('does not start a second rebuild while the claim is held', async () => {
      redisSet.mockResolvedValue(null); // NX claim already held elsewhere
      mockClient();

      await service.rebuild('jellyfin', { host: 'h', port: '1', apiKey: 'k' });

      expect(registry.createMediaServerClient).not.toHaveBeenCalled();
      expect(redisDel).not.toHaveBeenCalled();
    });

    it('writes ready with the entry count on a successful rebuild', async () => {
      mockClient({
        listLibrary: jest
          .fn()
          .mockResolvedValue([
            { mediaType: MEDIA_TYPE.MOVIE, tmdbId: 1, externalId: 'a' },
          ]),
      });

      await service.rebuild('jellyfin', { host: 'h', port: '1', apiKey: 'k' });

      expect($transaction).toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { key: 'media_server_index_state' },
        data: { value: 'ready' },
      });
      expect(update).toHaveBeenCalledWith({
        where: { key: 'media_server_index_count' },
        data: { value: '1' },
      });
    });

    it('dedupes two library entries sharing the same (mediaType, tmdbId) instead of tripping the unique constraint', async () => {
      // A real library is not guaranteed unique here — two Jellyfin items
      // (e.g. two versions of the same film) can share a TMDB id. Caught by
      // a real rebuild against a real library during manual testing: the
      // unmodified createMany threw P2002 and the whole rebuild reported
      // "failed" over data this table was never meant to reject.
      mockClient({
        listLibrary: jest.fn().mockResolvedValue([
          { mediaType: MEDIA_TYPE.MOVIE, tmdbId: 1, externalId: 'a' },
          { mediaType: MEDIA_TYPE.MOVIE, tmdbId: 1, externalId: 'b' },
        ]),
      });

      const result = await service.rebuild('jellyfin', { host: 'h', port: '1', apiKey: 'k' });

      expect(createMany).toHaveBeenCalledWith({
        data: [{ mediaType: MEDIA_TYPE.MOVIE, tmdbId: 1, externalId: 'b' }],
      });
      expect(update).toHaveBeenCalledWith({
        where: { key: 'media_server_index_count' },
        data: { value: '1' },
      });
      expect(result.state).toBe('ready');
    });
  });

  describe('readState', () => {
    it('reports a stored "syncing" with no live claim as "failed"', async () => {
      redisExists.mockResolvedValue(0);
      findMany.mockResolvedValue([
        { key: 'media_server_index_state', value: 'syncing' },
      ]);

      const result = await service.readState();
      expect(result.state).toBe('failed');
    });

    it('reports "syncing" only while the claim is actually held', async () => {
      redisExists.mockResolvedValue(1);
      findMany.mockResolvedValue([
        { key: 'media_server_index_state', value: 'syncing' },
      ]);

      const result = await service.readState();
      expect(result.state).toBe('syncing');
    });
  });
});
