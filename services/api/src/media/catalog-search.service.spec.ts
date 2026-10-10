import { Test, TestingModule } from '@nestjs/testing';
import { CatalogSearchService } from './catalog-search.service';
import { CatalogDescriptor, RegisteredCatalogRow } from './catalog-descriptor';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { MediaSearchResult } from '@/clients/types';
import { MediaType } from '@/types/media';

// This suite exists because the trap 026-multi-search extracted
// cacheAndEnrich to avoid is silent in every way that matters: swapping
// the cache write and the ownership enrichment produces the exact same
// return value to the caller (enrichWithOwnership still runs, the search
// response still carries the right inLibrary/mediaId), so no assertion on
// what cacheAndEnrich() *returns* would ever catch the regression. What
// breaks is the shared Redis entry every other user reads for the next
// 24h: if enrichment ran first and the write read from that enriched
// object, this caller's inLibrary/mediaId would leak into a cache key no
// other caller's request is scoped to. The only way to catch this is to
// assert directly on what reaches the Redis pipeline, and to assert that
// the pipeline write happens before the enrichment call is even made —
// not merely that the final cached value happens to look clean.
describe('CatalogSearchService', () => {
  let service: CatalogSearchService;
  let redis: { pipeline: jest.Mock };
  let prisma: Record<string, never>;
  let tmdb: { search: jest.Mock };

  interface FakeItem {
    id: number;
    title: string;
  }

  const makeDescriptor = (
    findRegistered: jest.Mock,
  ): CatalogDescriptor<FakeItem> => ({
    mediaType: 'movie' as MediaType,
    tmdbSearchPath: 'movie',
    toSearchResult: (item: FakeItem): MediaSearchResult => ({
      id: item.id,
      title: item.title,
      releaseDate: '2021-10-21',
      posterUrl: '/poster.jpg',
      originalLanguage: 'en',
      overview: 'Sand.',
      type: 'movie',
    }),
    findRegistered,
  });

  beforeEach(async () => {
    redis = { pipeline: jest.fn() };
    prisma = {};
    tmdb = { search: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogSearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TmdbClient, useValue: tmdb },
      ],
    }).compile();

    service = module.get<CatalogSearchService>(CatalogSearchService);
  });

  describe('cacheAndEnrich', () => {
    it('writes the Redis cache entry before calling findRegistered, in that order', async () => {
      const callOrder: string[] = [];
      const pipelineSet = jest.fn().mockImplementation(() => {
        callOrder.push('cache-write');
        return pipelineInstance;
      });
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      const pipelineInstance = { set: pipelineSet, exec: pipelineExec };
      redis.pipeline.mockImplementation(() => {
        callOrder.push('pipeline-created');
        return pipelineInstance;
      });

      // Someone else already registered this film, so enrichWithOwnership
      // has real, non-default values to smuggle into the cache if the
      // ordering were ever broken.
      const findRegistered = jest
        .fn()
        .mockImplementation(async (): Promise<RegisteredCatalogRow[]> => {
          callOrder.push('enrichment');
          return [{ id: 7, tmdbId: 42, inLibrary: true, isShort: true }];
        });
      const descriptor = makeDescriptor(findRegistered);

      const results: MediaSearchResult[] = [
        {
          id: 42,
          title: 'Dune',
          releaseDate: '2021-10-21',
          posterUrl: '/poster.jpg',
          originalLanguage: 'en',
          overview: 'Sand.',
          type: 'movie',
        },
      ];

      const enriched = await service.cacheAndEnrich(
        descriptor,
        results,
        'user-1',
      );

      // Sanity check: the returned value is correctly enriched either
      // way — this is exactly why the two assertions below look at the
      // Redis call and the call order directly, not at this.
      expect(enriched).toEqual([
        expect.objectContaining({ id: 42, mediaId: 7, inLibrary: true }),
      ]);

      // Assert the write happens before enrichment rather than inferring
      // it from the final cached value.
      expect(callOrder).toEqual([
        'pipeline-created',
        'cache-write',
        'enrichment',
      ]);
      expect(findRegistered).toHaveBeenCalledTimes(1);

      // Assert the cached payload carries neither inLibrary nor mediaId.
      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [cacheKey, cachedJson] = pipelineSet.mock.calls[0];
      expect(cacheKey).toBe('tmdb:movie:42');
      const cached = JSON.parse(cachedJson);
      expect(cached).not.toHaveProperty('inLibrary');
      expect(cached).not.toHaveProperty('mediaId');
      expect(cached).toEqual({
        id: 42,
        title: 'Dune',
        releaseDate: '2021-10-21',
        posterUrl: '/poster.jpg',
        originalLanguage: 'en',
        overview: 'Sand.',
        type: 'movie',
      });
    });
  });
});
