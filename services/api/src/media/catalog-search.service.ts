import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { MediaSearchResult } from '@/clients/types';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { CatalogDescriptor } from './catalog-descriptor';

const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

// The single implementation of the catalog search, its Redis caching and
// its ownership enrichment, parameterised by a CatalogDescriptor instead of
// existing once per media type. MoviesService and ShowsService keep
// implementing MediaTypeService by delegating search()/cacheAndEnrich() to
// this collaborator with their own descriptor — this service never
// implements MediaTypeService itself.

// Spec 088, REQ-6
@Injectable()
export class CatalogSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tmdb: TmdbClient,
  ) {}

  async search<TItem>(
    descriptor: CatalogDescriptor<TItem>,
    query: string,
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!query.trim()) return [];

    const items = await this.tmdb.search<TItem>(
      descriptor.tmdbSearchPath,
      query,
    );
    const results = items.map((item) => descriptor.toSearchResult(item));

    return this.cacheAndEnrich(descriptor, results, userId);
  }

  // Steps 3-4 of the former per-type search(): the cache write and the
  // ownership enrichment, in this order and only this order — 026-multi-search
  // extracted this ordering out of each service's search() so a fan-out
  // search never becomes a third copy of the cache-before-enrich rule; this
  // finishes that job one level down into a single shared implementation.
  // The cache write MUST stay before enrichment: computing ownership first
  // would leak one caller's inLibrary/mediaId into the shared Redis entry
  // every other caller reads for the next 24h.

  // Spec 006, AC-3; Spec 088, REQ-6
  async cacheAndEnrich<TItem>(
    descriptor: CatalogDescriptor<TItem>,
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    void this.cacheResults(descriptor, results);

    return this.enrichWithOwnership(descriptor, results, userId);
  }

  private async enrichWithOwnership<TItem>(
    descriptor: CatalogDescriptor<TItem>,
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!results.length) return [];

    const registered = await descriptor.findRegistered(
      this.prisma,
      results.map((r) => r.id),
      userId,
    );
    const byTmdbId = new Map(registered.map((row) => [row.tmdbId, row]));

    return results.map((result) => {
      const row = byTmdbId.get(result.id);
      return {
        ...result,
        mediaId: row?.id ?? null,
        inLibrary: row?.inLibrary ?? false,
        isShort: row?.isShort ?? false,
      };
    });
  }

  // Spec 088, REQ-11
  cacheKey(mediaType: string, tmdbId: number): string {
    return `tmdb:${mediaType}:${tmdbId}`;
  }

  private async cacheResults<TItem>(
    descriptor: CatalogDescriptor<TItem>,
    results: MediaSearchResult[],
  ): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const result of results) {
        pipeline.set(
          this.cacheKey(descriptor.mediaType, result.id),
          JSON.stringify(result),
          'EX',
          TMDB_CACHE_TTL_SECONDS,
        );
      }

      const execResults = await pipeline.exec();

      const failed = (execResults ?? []).filter(([err]) => err);
      if (failed.length) {
        console.error(
          `Error saving ${failed.length} ${descriptor.mediaType} result(s) from TMDB to Redis:`,
          failed.map(([err]) => err?.message),
        );
      }
    } catch (err) {
      console.error('Error saving TMDB results to Redis:', err);
    }
  }
}
