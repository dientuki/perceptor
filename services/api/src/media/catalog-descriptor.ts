import { MediaSearchResult } from '@/clients/types';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaType } from '@/types/media';

// A row this installation has already registered for a tmdbId the current
// search also returned — the per-type lookup CatalogSearchService.search()
// needs to answer "is this result in anyone's library, and in this caller's".
export interface RegisteredCatalogRow {
  id: number;
  tmdbId: number;
  inLibrary: boolean;
  isShort: boolean;
}

// Exactly the facts CatalogSearchService needs from a per-type service to
// run the one search + cache + ownership path: the TMDB endpoint, the
// row-shape mapping, the MEDIA_TYPE constant and the registered-row lookup
// (which also carries the isShort rule — a series is never a short, so
// ShowsService's descriptor always answers false).

// Spec 088, REQ-6
export interface CatalogDescriptor<TItem = unknown> {
  readonly mediaType: MediaType;

  // Passed straight through to TmdbClient.search<TItem>(tmdbSearchPath, query).
  readonly tmdbSearchPath: string;

  toSearchResult(item: TItem): MediaSearchResult;

  findRegistered(
    prisma: PrismaService,
    tmdbIds: number[],
    userId: string,
  ): Promise<RegisteredCatalogRow[]>;
}
