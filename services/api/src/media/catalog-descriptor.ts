import { MediaSearchResult } from '@/clients/types';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaType } from '@/types/media';

export interface RegisteredCatalogRow {
  id: number;
  tmdbId: number;
  inLibrary: boolean;
  isShort: boolean;
}

// Spec 088, REQ-6
export interface CatalogDescriptor<TItem = unknown> {
  readonly mediaType: MediaType;

  readonly tmdbSearchPath: string;

  toSearchResult(item: TItem): MediaSearchResult;

  findRegistered(
    prisma: PrismaService,
    tmdbIds: number[],
    userId: string,
  ): Promise<RegisteredCatalogRow[]>;
}
