import { Injectable } from '@nestjs/common';
import { TmdbClient } from '@/clients/tmdb/client';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { MediaSearchResult } from '@/clients/types';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { RedisService } from '@/redis/redis.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locales';
import { MediaType } from '@/types/media';

// TTL for the shared popular-list cache (24h), matching the per-title cache
// this feature sits beside (MoviesService/ShowsService's TMDB_CACHE_TTL_SECONDS).
// Declared again rather than imported: 033-billboard-and-navigation § api/plan.md
// deliberately keeps this constant local to each module.
const POPULAR_LIST_TTL_SECONDS = 60 * 60 * 24;

// Page 1 of TMDB's popular list for a type, cached in Redis for a day and
// enriched per caller. Structural twin of MediaSearchService: fetch once
// (here, from cache-or-TMDB rather than a live query), then hand the
// catalog-only rows to the per-type service's cacheAndEnrich (026-multi-search's
// cache-before-enrich ordering, reused rather than reimplemented).
@Injectable()
export class PopularMediaService {
  constructor(
    private readonly tmdb: TmdbClient,
    private readonly mediaDispatch: MediaDispatchService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
  ) {}

  async list(type: string, userId: string): Promise<MediaSearchResultEntity[]> {
    // 1. Throws for an unsupported type before any Redis read or TMDB call (REQ-15).
    const service = this.mediaDispatch.resolve(type);

    // 2. The caller's effective UI locale — never a hardcoded default beside DEFAULT_LOCALE.
    const locale = await this.resolveCatalogLocale(userId);

    const cacheKey = `tmdb:popular:${type}:${locale}`;

    // 3. A cache hit serves catalog-only rows with no further TMDB call.
    let rows: MediaSearchResult[] | undefined = await this.readCache(cacheKey);

    // 4. A miss calls TMDB — only this call is wrapped, so a Redis failure never
    // surfaces as a catalog error.
    if (!rows) {
      try {
        rows = await this.tmdb.popular(type as MediaType, locale);
      } catch {
        throw i18nError.serviceUnavailable(ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE);
      }

      // 5. Best-effort write of the catalog-only rows, never awaited into the
      // response path in the sense that its failure must never affect it —
      // awaited here only to keep the write itself sequenced before the
      // handler returns, per the ordering in api/plan.md step 3.5.
      await this.writeCache(cacheKey, rows);
    }

    // 6. Cache-then-enrich: ownership and mediaId are computed per caller,
    // after anything was written to the shared cache (REQ-11).
    return service.cacheAndEnrich(rows, userId);
  }

  private async readCache(cacheKey: string): Promise<MediaSearchResult[] | undefined> {
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) return undefined;
      return JSON.parse(raw) as MediaSearchResult[];
    } catch (err) {
      console.error(`Error leyendo cache de populares de TMDB (${cacheKey}):`, err);
      return undefined;
    }
  }

  private async writeCache(cacheKey: string, rows: MediaSearchResult[]): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(rows), 'EX', POPULAR_LIST_TTL_SECONDS);
    } catch (err) {
      console.error(`Error guardando cache de populares de TMDB (${cacheKey}):`, err);
    }
  }

  // The caller's uiLocale, else the installation's ui_locale setting, else
  // DEFAULT_LOCALE — every candidate clamped through isSupportedLocale so an
  // unsupported value is skipped rather than used (REQ-12).
  private async resolveCatalogLocale(userId: string): Promise<string> {
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { uiLocale: true } });
      if (user?.uiLocale && isSupportedLocale(user.uiLocale)) {
        return user.uiLocale;
      }
    }

    const settingsMap = await this.settings.getMap();
    const configuredLocale = settingsMap.ui_locale;
    if (configuredLocale && isSupportedLocale(configuredLocale)) {
      return configuredLocale;
    }

    return DEFAULT_LOCALE;
  }
}
