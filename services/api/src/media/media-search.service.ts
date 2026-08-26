import { Injectable } from '@nestjs/common';
import { TmdbClient } from '@/clients/tmdb/client';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { MediaSearchResult } from '@/clients/types';

// Fans one TMDB search/multi response out across every per-type service, so
// the cache-before-enrich ordering and the caller-scoped ownership lookup
// (both already correct and tested inside MoviesService/ShowsService) are
// never reimplemented a third time here (026-multi-search § Decided During
// Specification).
@Injectable()
export class MediaSearchService {
  constructor(
    private readonly tmdb: TmdbClient,
    private readonly dispatch: MediaDispatchService,
  ) {}

  async searchAll(query: string, userId: string): Promise<MediaSearchResultEntity[]> {
    if (!query.trim()) return [];

    const rows = await this.tmdb.searchMulti(query);

    // Group the catalog-ordered rows by type so each group can be handed to
    // the one service that owns that type's cache key and Prisma model.
    const groups = new Map<string, MediaSearchResult[]>();
    for (const row of rows) {
      const group = groups.get(row.type);
      if (group) {
        group.push(row);
      } else {
        groups.set(row.type, [row]);
      }
    }

    // One cacheAndEnrich call per type present, never per row (NFR-3).
    const enrichedByKey = new Map<string, MediaSearchResultEntity>();
    for (const [type, group] of groups) {
      const enriched = await this.dispatch.resolve(type).cacheAndEnrich(group, userId);
      for (const item of enriched) {
        enrichedByKey.set(`${type}:${item.id}`, item);
      }
    }

    // Rebuild the response by walking the original, catalog-ordered rows and
    // looking each one up by the composite `type:id` key — a bare id
    // collides across types (a film and a series can share the same tmdbId).
    const result: MediaSearchResultEntity[] = [];
    for (const row of rows) {
      const enriched = enrichedByKey.get(`${row.type}:${row.id}`);
      if (enriched) result.push(enriched);
    }

    return result;
  }
}
