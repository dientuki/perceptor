import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { MediaRef } from '@/media/entities/media-ref.entity';
import { MediaSearchResult } from '@/clients/types';

// The contract every per-type service (movies, shows, ...) implements. This
// is deliberately the entire boundary between the dispatch and a per-type
// service — no cache key, no catalog endpoint, no `type` getter crosses it.
// Since 088-acquisition-path-unification, the one search + cache +
// ownership implementation lives in CatalogSearchService, reached through
// each service's own descriptor: the cache key *shape* is shared, the keys
// themselves stay per-type, and neither the descriptor nor the collaborator
// crosses this interface.
export interface MediaTypeService {
  search(query: string, userId: string): Promise<MediaSearchResultEntity[]>;
  register(tmdbId: number, userId: string): Promise<MediaRef>;
  // Takes already-fetched, catalog-only rows (e.g. one type's slice of a
  // mixed `search/multi` response) and runs the same cache-then-enrich this
  // service's own search() runs internally — added by 026-multi-search so a
  // fan-out search never becomes a third copy of the cache-before-enrich
  // ordering (see movies.service.ts / shows.service.ts for the invariant).
  cacheAndEnrich(results: MediaSearchResult[], userId: string): Promise<MediaSearchResultEntity[]>;
}
