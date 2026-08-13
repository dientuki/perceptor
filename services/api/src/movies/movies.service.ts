import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service'; // Ajustá la ruta según tu estructura
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult, MovieDetail } from '@/clients/types';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { TmdbMovie } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { SourceKind } from '@prisma/client';
import { MediaTypeService } from '@/media/media-type.interface';
import { MediaRef } from '@/media/entities/media-ref.entity';

// TTL de la cache de resultados de TMDB en Redis (24hs)
const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class MoviesService implements MediaTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tmdb: TmdbClient,
    private readonly qbittorrent: QbittorrentClient,
  ) {}

  async create(createMovieDto: CreateMovieDto) {
    return this.prisma.movie.create({
      data: createMovieDto,
    });
  }

  // The library belongs to the user: only returns films this userId has
  // registered, filtered through the user_movies join. findOneFromDb() is
  // scoped the same way — movie(id) only resolves against the caller's own
  // library.
  async findAll(userId: string) {
    return this.prisma.movie.findMany({
      where: { users: { some: { userId } } },
      orderBy: { createdAt: 'desc' }, // Las más recientes primero
      include: {
        mediaSource: true,
        processJobs: true,
      },
    });
  }

  // Same ownership clause as attachTorrentSource: returns the film only when
  // the caller is linked to it via user_movies. Returns null both when the
  // id does not exist and when it exists but belongs to someone else — the
  // two are deliberately indistinguishable from here on (see spec.md § Errors).
  async findOneFromDb(id: number, userId: string) {
    return this.prisma.movie.findFirst({
      where: { id, users: { some: { userId } } },
      include: {
        mediaSource: true,
        processJobs: true,
      },
    });
  }

  async update(id: number, updateMovieDto: UpdateMovieDto) {
    const existing = await this.prisma.movie.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`La película ${id} no existe`);

    return this.prisma.movie.update({
      where: { id },
      data: updateMovieDto,
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.movie.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`La película ${id} no existe`);

    return this.prisma.movie.delete({
      where: { id },
    });
  }

  // Única definición de la clave de cache, compartida por el write de la búsqueda
  // y el read del add: evita que ambos lados se desincronicen.
  private cacheKey(tmdbId: number): string {
    return `tmdb:movie:${tmdbId}`;
  }

  // Registra en MariaDB una película ya vista en una búsqueda de TMDB. Idempotente:
  // si ya está en la biblioteca (por cualquier usuario), devuelve el registro
  // existente sin reescribir nada. En ambas ramas nos aseguramos de que exista
  // el vínculo con el usuario que llama (REQ-3): la fila de la película es
  // compartida, pero cada usuario necesita su propio user_movies.
  async register(tmdbId: number, userId: string): Promise<MediaRef> {
    const existing = await this.prisma.movie.findUnique({ where: { tmdbId } });
    if (existing) {
      await this.linkUserToMovie(userId, existing.id);
      return { id: existing.id, type: MEDIA_TYPE.MOVIE };
    }

    const cached = await this.getCachedMovie(tmdbId);

    // isLiveAction y status quedan en sus defaults de Prisma (true / MISSING):
    // es lo correcto para una película recién registrada y sin archivo todavía.
    const movie = await this.create({
      tmdbId: cached.id,
      title: cached.title,
      overview: cached.overview,
      posterUrl: cached.posterUrl ?? undefined,
      releaseDate: cached.releaseDate ? new Date(cached.releaseDate) : undefined,
      originalLanguage: cached.originalLanguage,
    });

    await this.linkUserToMovie(userId, movie.id);
    return { id: movie.id, type: MEDIA_TYPE.MOVIE };
  }

  // upsert en vez de create: un segundo addMovie del mismo usuario para la misma
  // película no debe explotar con un P2002 sobre la primary key compuesta — el
  // botón que dispara esto en el UI puede volver a llamarse antes de que
  // desaparezca (REQ-8/T004).
  private async linkUserToMovie(userId: string, movieId: number): Promise<void> {
    await this.prisma.userMovie.upsert({
      where: { userId_movieId: { userId, movieId } },
      update: {},
      create: { userId, movieId },
    });
  }

  // A diferencia de cacheMovies, acá Redis es la fuente de datos (no un cache
  // oportunista): un error no se silencia, se propaga como error de GraphQL.
  private async getCachedMovie(tmdbId: number): Promise<MediaSearchResult> {
    const raw = await this.redis.get(this.cacheKey(tmdbId));
    if (raw) return JSON.parse(raw) as MediaSearchResult;

    return this.fetchMovieFromTMDB(tmdbId);
  }

  // Falls back to the catalog itself when the Redis cache has expired,
  // been evicted, or never got written (the best-effort save in
  // cacheMovies() can silently fail). This is not a second search path: it
  // re-fetches the one film addMovie asked for, via the same
  // TmdbClient.details() the rest of the client uses, and reuses posterUrl()
  // so this path and searchMovies() can never disagree on image size for the
  // same film (REQ-2). Only a tmdbId the catalog itself does not know about
  // reaches the caller as an error.
  private async fetchMovieFromTMDB(tmdbId: number): Promise<MediaSearchResult> {
    let detail: MovieDetail;
    try {
      detail = (await this.tmdb.details(MEDIA_TYPE.MOVIE, tmdbId)) as MovieDetail;
    } catch {
      throw new NotFoundException('No encontramos la película en el catálogo');
    }

    return {
      id: detail.id,
      title: detail.title,
      releaseDate: detail.releaseDate || null,
      posterUrl: posterUrl(detail.posterPath),
      originalLanguage: detail.originalLanguage,
      overview: detail.overview,
      type: MEDIA_TYPE.MOVIE,
    };
  }

  async search(query: string, userId: string): Promise<MediaSearchResultEntity[]> {
    if (!query.trim()) return [];

    // 1. Consultar TMDB.
    const items = await this.tmdb.search<TmdbMovie>('movie', query);

    // 2. Traducir la respuesta cruda de TMDB a nuestro formato
    const results: MediaSearchResult[] = items.map(item => ({
      id: item.id,
      title: item.title,
      releaseDate: item.release_date || null,
      posterUrl: posterUrl(item.poster_path),
      originalLanguage: item.original_language,
      overview: item.overview,
      type: MEDIA_TYPE.MOVIE,
    }));

    // 3. Disparar el upsert en Redis en BACKGROUND (sin 'await'). This MUST
    // run on the catalog-only `results` before ownership is attached below:
    // cacheMovies() serialises whatever it is handed into a shared, global
    // Redis key (tmdb:movie:<id>, 24h TTL) read by every user who searches
    // this film. Enriching first would leak this caller's inLibrary/movieId
    // into that cache and serve it to everyone else for the next 24 hours,
    // with no error anywhere.
    void this.cacheMovies(results);

    // 4. Enriquecer con la ownership del usuario que llama, en una sola
    // query por página (no una por resultado). movieId/inLibrary son
    // per-request y nunca tocan el objeto cacheado en el paso anterior.
    const enriched = await this.enrichWithOwnership(results, userId);

    // 5. Responder INMEDIATAMENTE al cliente GraphQL
    return enriched;
  }

  // Attaches movieId (registered by anyone, or null) and inLibrary (owned by
  // this caller) to a page of catalog results, from a single query — not one
  // per result. Deliberately not merged into the objects passed to
  // cacheMovies(): see the ordering note in searchMovies().
  private async enrichWithOwnership(
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!results.length) return [];

    const movies = await this.prisma.movie.findMany({
      where: { tmdbId: { in: results.map(r => r.id) } },
      select: {
        id: true,
        tmdbId: true,
        users: { where: { userId }, select: { userId: true } },
      },
    });

    const byTmdbId = new Map(movies.map(m => [m.tmdbId, m]));

    return results.map(result => {
      const registered = byTmdbId.get(result.id);
      return {
        ...result,
        mediaId: registered?.id ?? null,
        inLibrary: (registered?.users.length ?? 0) > 0,
      };
    });
  }

  async addTorrentToMovie(
    movieId: number,
    input: { infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    return this.attachTorrentSource(movieId, { kind: 'TORRENT_SEARCH', ...input }, userId);
  }

  // Magnet pegado a mano por el usuario, en vez de un release elegido del
  // indexer. El infoHash sale del propio magnet (parseMagnet no pega a la
  // red) — a partir de acá el flujo es idéntico a addTorrentToMovie.
  async addMagnetToMovie(movieId: number, input: { magnet: string; force: boolean }, userId: string) {
    let parsed;
    try {
      parsed = parseMagnet(input.magnet);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    return this.attachTorrentSource(
      movieId,
      {
        kind: 'TORRENT_FILE',
        infoHash: parsed.infoHash,
        urls: [input.magnet],
        releaseTitle: parsed.displayName,
        force: input.force,
      },
      userId,
    );
  }

  // Same NotFoundException the resolver already threw for an unknown id, now
  // also covering a film the caller has not registered (REQ-6). One lookup
  // scoped by both id and the caller's user_movies link, one message: an
  // unowned film and a missing one are indistinguishable from here on, by
  // design — see spec.md § Errors for why no second "no es tuya" string
  // exists.
  private async attachTorrentSource(
    movieId: number,
    input: { kind: SourceKind; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, users: { some: { userId } } },
      include: { mediaSource: true, processJobs: true },
    });
    if (!movie) throw new NotFoundException(`La película ${movieId} no existe`);

    if (movie.mediaSourceId && !input.force) {
      throw new ConflictException(
        'Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.',
      );
    }

    // infoHash es @unique: si ya existe una fila con este hash, no podemos
    // crear otra (P2002). De otra película es una colisión real que sólo
    // decide el usuario; de esta misma película es un reintento — se reusa
    // la fila en vez de duplicarla.
    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: { movie: true },
    });

    if (existingSource && existingSource.movie && existingSource.movie.id !== movieId) {
      throw new ConflictException(
        `Ese magnet ya está asociado a «${existingSource.movie.title}»`,
      );
    }

    // El savepath lo decide el client al agregar el torrent, así cada descarga cae
    // en su propia carpeta y sabemos dónde están los archivos desde el arranque
    // (los torrents de un solo archivo, si no, quedan sueltos en la raíz).
    const downloadPath = await this.qbittorrent.add(input.urls);

    const mediaSource = existingSource
      ? await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            kind: input.kind,
            status: 'QUEUED',
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            errorMessage: null,
          },
        })
      : await this.prisma.mediaSource.create({
          data: {
            kind: input.kind,
            status: 'QUEUED',
            infoHash: input.infoHash,
            // La URL con la que se pidió el release. Guardamos la primera —la misma
            // que hashea add() para armar la carpeta— y no el join de todas, así el
            // downloadPath se puede reconstruir desde esta fila.
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
          },
        });

    return this.prisma.movie.update({
      where: { id: movieId },
      data: { mediaSourceId: mediaSource.id, status: 'DOWNLOADING' },
    });
  }

  // Guarda/actualiza (upsert) cada película en Redis con TTL. No bloquea la
  // respuesta al cliente y no debe poder tirar abajo el proceso: cualquier
  // error se loguea y se descarta acá mismo.
  private async cacheMovies(results: MediaSearchResult[]): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const movie of results) {
        pipeline.set(this.cacheKey(movie.id), JSON.stringify(movie), 'EX', TMDB_CACHE_TTL_SECONDS);
      }

      const execResults = await pipeline.exec();

      const failed = (execResults ?? []).filter(([err]) => err);
      if (failed.length) {
        console.error(`Error guardando ${failed.length} película(s) de TMDB en Redis:`, failed.map(([err]) => err?.message));
      }
    } catch (err) {
      console.error('Error guardando resultados de TMDB en Redis:', err);
    }
  }
}
