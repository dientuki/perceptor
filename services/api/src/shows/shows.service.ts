import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult, ShowDetail } from '@/clients/types';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { TmdbShow } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';
import { MediaTypeService } from '@/media/media-type.interface';
import { MediaRef } from '@/media/entities/media-ref.entity';

// TTL de la cache de resultados de TMDB en Redis (24hs) — same value as
// MoviesService, kept as its own constant here on purpose (see class doc
// comment in movies.service.ts: no shared base/mixin between the two).
const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

// TTL of the hydration claim key — long enough to cover a slow N-season
// fetch, short enough that a crashed process doesn't wedge retries for long
// (the `finally` below deletes it on every exit path anyway; this TTL is
// only the backstop for the one exit path that skips `finally`: the process
// dying mid-hydrate).
const HYDRATE_CLAIM_TTL_SECONDS = 60 * 10;

// Structural twin of MoviesService, scoped to Show for this task: catalog
// search + registration, plus the background season/episode hydration
// (T007) that registration kicks off but never waits for.
@Injectable()
export class ShowsService implements MediaTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tmdb: TmdbClient,
  ) {}

  // The library belongs to the user: only returns series this userId has
  // registered, filtered through the user_shows join — the shows row itself is
  // shared between every user who registered the same series. One query, no
  // per-row ownership lookup. No include: seasons and episodes belong to the
  // detail page, not the listing.
  async findAll(userId: string) {
    return this.prisma.show.findMany({
      where: { users: { some: { userId } } },
      orderBy: { createdAt: 'desc' }, // Most recently added first
    });
  }

  // Same ownership clause as findAll, narrowed to a single row and deepened
  // two levels (seasons, then each season's episodes), both ordered
  // server-side (NFR-2). Returns null both when the id does not exist and
  // when it exists but belongs to someone else — the two are deliberately
  // indistinguishable from here on, same rule as MoviesService.findOneFromDb
  // (008-movie-detail, see spec.md § Errors there and in 009-show-detail).
  async findOneFromDb(id: number, userId: string) {
    return this.prisma.show.findFirst({
      where: { id, users: { some: { userId } } },
      include: {
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
        },
      },
    });
  }

  // Única definición de la clave de cache, compartida por el write de la búsqueda
  // y el read del add: evita que ambos lados se desincronicen.
  private cacheKey(tmdbId: number): string {
    return `tmdb:show:${tmdbId}`;
  }

  // Registra en MariaDB una serie ya vista en una búsqueda de TMDB. Idempotente:
  // si ya está en la biblioteca (por cualquier usuario), devuelve el registro
  // existente sin reescribir nada. En ambas ramas nos aseguramos de que exista
  // el vínculo con el usuario que llama: la fila de la serie es compartida,
  // pero cada usuario necesita su propio user_shows.
  async register(tmdbId: number, userId: string): Promise<MediaRef> {
    const existing = await this.prisma.show.findUnique({ where: { tmdbId } });
    if (existing) {
      await this.linkUserToShow(userId, existing.id);

      // Retry path (REQ-14): the happy path never reaches this, because a
      // fully-hydrated show has seasonsSyncedAt set. A prior hydration that
      // failed — or never ran — leaves it null, and every subsequent
      // register() for the same show is what gives it another chance.
      if (existing.seasonsSyncedAt === null) {
        void this.hydrate(existing.id, tmdbId);
      }

      return { id: existing.id, type: MEDIA_TYPE.SHOW };
    }

    const cached = await this.getCachedShow(tmdbId);

    // isLiveAction queda en su default de Prisma (true): es lo correcto para
    // una serie recién registrada y sin archivos todavía.
    const show = await this.prisma.show.create({
      data: {
        tmdbId: cached.id,
        title: cached.title,
        overview: cached.overview,
        posterUrl: cached.posterUrl ?? undefined,
        releaseDate: cached.releaseDate ? new Date(cached.releaseDate) : undefined,
        originalLanguage: cached.originalLanguage,
      },
    });

    await this.linkUserToShow(userId, show.id);

    // Detached on purpose (REQ-13): register() must respond before seasons
    // and episodes are fetched. Never awaited, and hydrate() itself is a
    // try/catch/finally so this can never surface as an unhandled rejection.
    void this.hydrate(show.id, tmdbId);

    return { id: show.id, type: MEDIA_TYPE.SHOW };
  }

  private hydrateClaimKey(tmdbId: number): string {
    return `show:hydrate:${tmdbId}`;
  }

  // Fetches every season and episode a series' catalog entry lists and
  // writes them in. Detached from register() (REQ-13), so nothing here can
  // reach a caller: the whole body is try/catch/finally, and the only traces
  // a failure leaves are the console.error below and shows.seasonsSyncedAt
  // staying null (NFR-4) — that null is also what makes the next register()
  // for this show retry (REQ-14).
  private async hydrate(showId: number, tmdbId: number): Promise<void> {
    const claimKey = this.hydrateClaimKey(tmdbId);

    // Atomic SET ... NX: only the first concurrent hydration for a given
    // tmdbId wins the claim (NFR-5). A GET-then-SET here would pass a
    // single-request test and still let two concurrent registrations both
    // fetch — see uploads/upload-tickets.service.ts:verifyAndSpend for the
    // same pattern and the same reasoning.
    const claimed = await this.redis.set(claimKey, '1', 'EX', HYDRATE_CLAIM_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') return;

    try {
      const detail = (await this.tmdb.details(MEDIA_TYPE.SHOW, tmdbId)) as ShowDetail;

      // Sequential on purpose (NFR-6): a Promise.all over N seasons bursts
      // requests at TMDB's rate limit and can leave the series
      // half-populated with no error anywhere. Season 0 (specials) is not
      // filtered — REQ-12.
      for (const season of detail.seasons) {
        const seasonRow = await this.prisma.season.upsert({
          where: { showId_seasonNumber: { showId, seasonNumber: season.seasonNumber } },
          update: {
            releaseDate: season.releaseDate ? new Date(season.releaseDate) : undefined,
          },
          create: {
            showId,
            seasonNumber: season.seasonNumber,
            releaseDate: season.releaseDate ? new Date(season.releaseDate) : undefined,
          },
        });

        const episodes = await this.tmdb.seasonDetails(tmdbId, season.seasonNumber);

        for (const episode of episodes) {
          await this.prisma.episode.upsert({
            where: {
              seasonId_episodeNumber: { seasonId: seasonRow.id, episodeNumber: episode.episodeNumber },
            },
            update: {
              title: episode.title,
              overview: episode.overview,
              releaseDate: episode.releaseDate ? new Date(episode.releaseDate) : undefined,
            },
            create: {
              seasonId: seasonRow.id,
              episodeNumber: episode.episodeNumber,
              title: episode.title,
              overview: episode.overview,
              releaseDate: episode.releaseDate ? new Date(episode.releaseDate) : undefined,
            },
          });
        }
      }

      // Only reached once every season and every episode above has been
      // written — any earlier and a partial fetch would look complete
      // (REQ-14).
      await this.prisma.show.update({
        where: { id: showId },
        data: { seasonsSyncedAt: new Date() },
      });
    } catch (err) {
      console.error(`Error hydrating seasons/episodes for show tmdbId=${tmdbId}:`, err);
    } finally {
      // Deletes the claim regardless of outcome, so a failure does not wedge
      // every future retry until HYDRATE_CLAIM_TTL_SECONDS expires.
      await this.redis.del(claimKey);
    }
  }

  // upsert en vez de create: un segundo addMedia del mismo usuario para la misma
  // serie no debe explotar con un P2002 sobre la primary key compuesta — el
  // botón que dispara esto en el UI puede volver a llamarse antes de que
  // desaparezca.
  private async linkUserToShow(userId: string, showId: number): Promise<void> {
    await this.prisma.userShow.upsert({
      where: { userId_showId: { userId, showId } },
      update: {},
      create: { userId, showId },
    });
  }

  // A diferencia de cacheShows, acá Redis es la fuente de datos (no un cache
  // oportunista): un error no se silencia, se propaga como error de GraphQL.
  private async getCachedShow(tmdbId: number): Promise<MediaSearchResult> {
    const raw = await this.redis.get(this.cacheKey(tmdbId));
    if (raw) return JSON.parse(raw) as MediaSearchResult;

    return this.fetchShowFromTMDB(tmdbId);
  }

  // Falls back to the catalog itself when the Redis cache has expired, been
  // evicted, or never got written (the best-effort save in cacheShows() can
  // silently fail). This is not a second search path: it re-fetches the one
  // series addMedia asked for, via the same TmdbClient.details() the rest of
  // the client uses, and reuses posterUrl() so this path and search() can
  // never disagree on image size for the same series. Only a tmdbId the
  // catalog itself does not know about reaches the caller as an error.
  private async fetchShowFromTMDB(tmdbId: number): Promise<MediaSearchResult> {
    let detail: ShowDetail;
    try {
      detail = (await this.tmdb.details(MEDIA_TYPE.SHOW, tmdbId)) as ShowDetail;
    } catch {
      throw new NotFoundException('No encontramos la serie en el catálogo');
    }

    return {
      id: detail.id,
      title: detail.title,
      releaseDate: detail.firstAirDate || null,
      posterUrl: posterUrl(detail.posterPath),
      originalLanguage: detail.originalLanguage,
      overview: detail.overview,
      type: MEDIA_TYPE.SHOW,
    };
  }

  async search(query: string, userId: string): Promise<MediaSearchResultEntity[]> {
    if (!query.trim()) return [];

    // 1. Consultar TMDB.
    const items = await this.tmdb.search<TmdbShow>('tv', query);

    // 2. Traducir la respuesta cruda de TMDB a nuestro formato
    const results: MediaSearchResult[] = items.map(item => ({
      id: item.id,
      title: item.name,
      releaseDate: item.first_air_date || null,
      posterUrl: posterUrl(item.poster_path),
      originalLanguage: item.original_language,
      overview: item.overview,
      type: MEDIA_TYPE.SHOW,
    }));

    // 3. Disparar el upsert en Redis en BACKGROUND (sin 'await'). This MUST
    // run on the catalog-only `results` before ownership is attached below:
    // cacheShows() serialises whatever it is handed into a shared, global
    // Redis key (tmdb:show:<id>, 24h TTL) read by every user who searches
    // this series. Enriching first would leak this caller's inLibrary/mediaId
    // into that cache and serve it to everyone else for the next 24 hours,
    // with no error anywhere.
    void this.cacheShows(results);

    // 4. Enriquecer con la ownership del usuario que llama, en una sola
    // query por página (no una por resultado). mediaId/inLibrary son
    // per-request y nunca tocan el objeto cacheado en el paso anterior.
    const enriched = await this.enrichWithOwnership(results, userId);

    // 5. Responder INMEDIATAMENTE al cliente GraphQL
    return enriched;
  }

  // Attaches mediaId (registered by anyone, or null) and inLibrary (owned by
  // this caller) to a page of catalog results, from a single query — not one
  // per result. Deliberately not merged into the objects passed to
  // cacheShows(): see the ordering note in search().
  private async enrichWithOwnership(
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!results.length) return [];

    const shows = await this.prisma.show.findMany({
      where: { tmdbId: { in: results.map(r => r.id) } },
      select: {
        id: true,
        tmdbId: true,
        users: { where: { userId }, select: { userId: true } },
      },
    });

    const byTmdbId = new Map(shows.map(s => [s.tmdbId, s]));

    return results.map(result => {
      const registered = byTmdbId.get(result.id);
      return {
        ...result,
        mediaId: registered?.id ?? null,
        inLibrary: (registered?.users.length ?? 0) > 0,
      };
    });
  }

  // Guarda/actualiza (upsert) cada serie en Redis con TTL. No bloquea la
  // respuesta al cliente y no debe poder tirar abajo el proceso: cualquier
  // error se loguea y se descarta acá mismo.
  private async cacheShows(results: MediaSearchResult[]): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const show of results) {
        pipeline.set(this.cacheKey(show.id), JSON.stringify(show), 'EX', TMDB_CACHE_TTL_SECONDS);
      }

      const execResults = await pipeline.exec();

      const failed = (execResults ?? []).filter(([err]) => err);
      if (failed.length) {
        console.error(`Error guardando ${failed.length} serie(s) de TMDB en Redis:`, failed.map(([err]) => err?.message));
      }
    } catch (err) {
      console.error('Error guardando resultados de TMDB en Redis:', err);
    }
  }
}
