import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { TmdbHttpError } from '@/clients/tmdb/errors';
import { MediaDispatchService } from '@/media/media-dispatch.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';
import { MediaType } from '@/types/media';
import { parseListReference } from './list-reference';

const TMDB_INVALID_KEY_STATUS_CODE = 7;

type ListFailure = 'unauthorized' | 'unreadable' | 'unavailable';

export interface ImportAllResult {
  registered: number;
  listsFailed: number;
}

@Injectable()
export class TmdbListsService {
  private readonly logger = new Logger(TmdbListsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tmdb: TmdbClient,
    private readonly mediaDispatch: MediaDispatchService,
    private readonly capabilities: MediaCapabilitiesService,
  ) {}

  // Spec 109, REQ-1 REQ-2
  async attach(userId: string, reference: string) {
    const tmdbListId = parseListReference(reference);
    if (tmdbListId === null) {
      throw i18nError.badRequest(ERROR_KEYS.TMDB_LIST_INVALID_REFERENCE);
    }
    if (!(await this.hasCatalogKey())) {
      throw i18nError.badRequest(ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED);
    }

    const existing = await this.prisma.userTmdbList.findUnique({
      where: { userId_tmdbListId: { userId, tmdbListId } },
      select: { id: true },
    });
    if (existing) {
      throw i18nError.conflict(ERROR_KEYS.TMDB_LIST_ALREADY_ATTACHED);
    }

    let name: string;
    let itemCount: number | null;
    try {
      const page = await this.tmdb.list(tmdbListId, 1);
      name = page.name;
      itemCount = page.itemCount;
    } catch (err) {
      throw this.attachError(err);
    }

    try {
      return await this.prisma.userTmdbList.create({
        data: { userId, tmdbListId, name, itemCount },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw i18nError.conflict(ERROR_KEYS.TMDB_LIST_ALREADY_ATTACHED);
      }
      throw err;
    }
  }

  // Spec 109, REQ-14
  findOneFor(userId: string, id: number) {
    return this.prisma.userTmdbList.findFirst({ where: { id, userId } });
  }

  // Spec 109, REQ-14
  async ownedTitles(userId: string, listId: number, mediaType: MediaType) {
    const seen = await this.prisma.userTmdbListItem.findMany({
      where: { listId, mediaType },
      select: { tmdbId: true },
    });
    const tmdbIds = seen.map((row) => row.tmdbId);
    if (tmdbIds.length === 0) return [];
    const where = {
      tmdbId: { in: tmdbIds },
      users: { some: { userId } },
    };
    if (mediaType === 'movie') {
      return this.prisma.movie.findMany({
        where,
        orderBy: { title: 'asc' },
        include: { mediaSources: true, processJobs: true },
      });
    }
    return this.prisma.show.findMany({ where, orderBy: { title: 'asc' } });
  }

  // Spec 109, REQ-4
  async detach(userId: string, id: number): Promise<boolean> {
    const { count } = await this.prisma.userTmdbList.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw i18nError.notFound(ERROR_KEYS.TMDB_LIST_NOT_FOUND);
    }
    return true;
  }

  // Spec 109, REQ-3
  listFor(userId: string) {
    return this.prisma.userTmdbList.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  // Spec 109, REQ-6 REQ-7 REQ-8 REQ-9 REQ-10 NFR-1 NFR-3
  async importAll(): Promise<ImportAllResult> {
    const result: ImportAllResult = { registered: 0, listsFailed: 0 };
    if (!(await this.hasCatalogKey())) return result;

    const lists = await this.prisma.userTmdbList.findMany({
      where: { user: { isEnabled: true } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const list of lists) {
      let pages: {
        name: string;
        itemCount: number | null;
        items: { tmdbId: number; mediaType: MediaType }[];
      };
      try {
        pages = await this.readAllPages(list.tmdbListId);
      } catch (err) {
        result.listsFailed += 1;
        await this.prisma.userTmdbList.update({
          where: { id: list.id },
          data: { lastError: this.storedErrorKey(err) },
        });
        this.logger.warn(
          `List ${list.tmdbListId} could not be read: ${(err as Error).message}`,
        );
        continue;
      }

      await this.prisma.userTmdbList.update({
        where: { id: list.id },
        data: {
          name: pages.name || list.name,
          itemCount: pages.itemCount,
          lastImportedAt: new Date(),
          lastError: null,
        },
      });

      result.registered += await this.importItems(
        list.id,
        list.userId,
        pages.items,
      );
    }

    return result;
  }

  private async importItems(
    listId: number,
    userId: string,
    items: { tmdbId: number; mediaType: MediaType }[],
  ): Promise<number> {
    const seen = new Set(
      (
        await this.prisma.userTmdbListItem.findMany({
          where: { listId },
          select: { tmdbId: true, mediaType: true },
        })
      ).map((row) => `${row.mediaType}:${row.tmdbId}`),
    );
    const owned = await this.loadOwned(userId);
    const enabled = new Map<MediaType, boolean>();
    let registered = 0;

    for (const item of items) {
      const key = `${item.mediaType}:${item.tmdbId}`;
      if (seen.has(key)) continue;

      try {
        if (!enabled.has(item.mediaType)) {
          enabled.set(
            item.mediaType,
            await this.capabilities.isEnabled(item.mediaType),
          );
        }
        if (!enabled.get(item.mediaType)) continue;

        if (!owned[item.mediaType].has(item.tmdbId)) {
          await this.mediaDispatch
            .resolve(item.mediaType)
            .register(item.tmdbId, userId);
          owned[item.mediaType].add(item.tmdbId);
          registered += 1;
        }
        await this.prisma.userTmdbListItem.upsert({
          where: {
            listId_tmdbId_mediaType: {
              listId,
              tmdbId: item.tmdbId,
              mediaType: item.mediaType,
            },
          },
          create: { listId, tmdbId: item.tmdbId, mediaType: item.mediaType },
          update: {},
        });
        seen.add(key);
      } catch (err) {
        this.logger.warn(
          `List item ${key} not imported: ${(err as Error).message}`,
        );
      }
    }

    return registered;
  }

  private async loadOwned(
    userId: string,
  ): Promise<Record<MediaType, Set<number>>> {
    const [movies, shows] = await Promise.all([
      this.prisma.userMovie.findMany({
        where: { userId },
        select: { movie: { select: { tmdbId: true } } },
      }),
      this.prisma.userShow.findMany({
        where: { userId },
        select: { show: { select: { tmdbId: true } } },
      }),
    ]);
    return {
      movie: new Set(movies.map((row) => row.movie.tmdbId)),
      show: new Set(shows.map((row) => row.show.tmdbId)),
    };
  }

  private async readAllPages(tmdbListId: number) {
    const first = await this.tmdb.list(tmdbListId, 1);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      items.push(...(await this.tmdb.list(tmdbListId, page)).items);
    }
    return { name: first.name, itemCount: first.itemCount, items };
  }

  private async hasCatalogKey(): Promise<boolean> {
    const map = await this.settings.getMap();
    return (map['movie_db_api_key'] ?? '').trim() !== '';
  }

  private classify(err: unknown): ListFailure {
    if (err instanceof TmdbHttpError) {
      if (err.status === 401 && err.statusCode === TMDB_INVALID_KEY_STATUS_CODE)
        return 'unauthorized';
      if (err.status === 401 || err.status === 404) return 'unreadable';
    }
    return 'unavailable';
  }

  private storedErrorKey(err: unknown): ErrorKey {
    const kind = this.classify(err);
    if (kind === 'unauthorized') return ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED;
    if (kind === 'unreadable') return ERROR_KEYS.TMDB_LIST_UNREADABLE;
    return ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE;
  }

  private attachError(err: unknown) {
    const key = this.storedErrorKey(err);
    return key === ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE
      ? i18nError.serviceUnavailable(key)
      : i18nError.badRequest(key);
  }
}
