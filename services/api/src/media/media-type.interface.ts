import { MediaSearchResult } from '@/media/entities/media-search-result.entity';
import { MediaRef } from '@/media/entities/media-ref.entity';

// The contract every per-type service (movies, shows, ...) implements. This
// is deliberately the entire boundary between the dispatch and a per-type
// service — no cache key, no catalog endpoint, no `type` getter. Every other
// detail stays private to the implementation (see spec.md § Decided During
// Specification and § Context & Goal).
export interface MediaTypeService {
  search(query: string, userId: string): Promise<MediaSearchResult[]>;
  register(tmdbId: number, userId: string): Promise<MediaRef>;
}
