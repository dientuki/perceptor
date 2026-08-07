import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service'; // Ajustá la ruta según tu estructura
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult } from '@/clients/types';
import { TmdbClient } from '@/clients/tmdb/client';
import { TmdbMovie } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';
import { QbittorrentClient } from '@/clients/torrent/client';

// TTL de la cache de resultados de TMDB en Redis (24hs)
const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class MoviesService {
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

  async findAll() {
    return this.prisma.movie.findMany({
      orderBy: { createdAt: 'desc' }, // Las más recientes primero
      include: {
        mediaSource: true,
        processJobs: true,
      },
    });
  }

  async findOneFromDb(id: number) {
    return this.prisma.movie.findUnique({
      where: { id },
      include: {
        mediaSource: true,
        processJobs: true,
      },
    });
  }

  async update(id: number, updateMovieDto: UpdateMovieDto) {
    await this.findOneFromDb(id); // Valida que exista antes de actualizar

    return this.prisma.movie.update({
      where: { id },
      data: updateMovieDto,
    });
  }

  async remove(id: number) {
    await this.findOneFromDb(id); // Valida que exista

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
  // si ya está en la biblioteca, devuelve el registro existente sin reescribir nada.
  async addMovie(tmdbId: number) {
    const existing = await this.prisma.movie.findUnique({ where: { tmdbId } });
    if (existing) return existing;

    const cached = await this.getCachedMovie(tmdbId);

    // isLiveAction y status quedan en sus defaults de Prisma (true / MISSING):
    // es lo correcto para una película recién registrada y sin archivo todavía.
    return this.create({
      tmdbId: cached.id,
      title: cached.title,
      overview: cached.overview,
      posterUrl: cached.posterUrl ?? undefined,
      releaseDate: cached.releaseDate ? new Date(cached.releaseDate) : undefined,
      originalLanguage: cached.originalLanguage,
    });
  }

  // A diferencia de cacheMovies, acá Redis es la fuente de datos (no un cache
  // oportunista): un error no se silencia, se propaga como error de GraphQL.
  private async getCachedMovie(tmdbId: number): Promise<MediaSearchResult> {
    const raw = await this.redis.get(this.cacheKey(tmdbId));
    if (raw) return JSON.parse(raw) as MediaSearchResult;

    return this.fetchMovieFromTMDB(tmdbId);
  }

  // TODO: implementar. `client.details(MEDIA_TYPE.MOVIE, tmdbId)` ya existe pero
  // devuelve un MovieDetail (posterPath relativo, no posterUrl absoluto), así que
  // falta definir el mapeo a MediaSearchResult. Por ahora el cache vencido (TTL
  // 24hs) es un error explícito en vez de un fallback silencioso.
  private async fetchMovieFromTMDB(tmdbId: number): Promise<MediaSearchResult> {
    throw new NotFoundException(
      `La película ${tmdbId} no está en cache. Volvé a buscarla.`,
    );
  }

  async searchMovies(query: string): Promise<MediaSearchResult[]> {
    if (!query.trim()) return [];

    // 1. Consultar TMDB.
    const items = await this.tmdb.search<TmdbMovie>('movie', query);

    // 2. Traducir la respuesta cruda de TMDB a nuestro formato
    const results: MediaSearchResult[] = items.map(item => ({
      id: item.id,
      title: item.title,
      releaseDate: item.release_date || null,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
      originalLanguage: item.original_language,
      overview: item.overview,
      type: MEDIA_TYPE.MOVIE,
    }));

    // 3. Disparar el upsert en Redis en BACKGROUND (sin 'await')
    void this.cacheMovies(results);

    // 4. Responder INMEDIATAMENTE al cliente GraphQL
    return results;
  }

  async addTorrentToMovie(
    movieId: number,
    input: { infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
  ) {
    const movie = await this.findOneFromDb(movieId);
    if (!movie) throw new NotFoundException(`La película ${movieId} no existe`);

    if (movie.mediaSourceId && !input.force) {
      throw new ConflictException(
        'Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.',
      );
    }

    await this.qbittorrent.add(input.urls);

    // downloadPath queda null: lo llena el poller con el root_path que reporte
    // qBittorrent cuando la descarga termine.
    const mediaSource = await this.prisma.mediaSource.create({
      data: {
        kind: 'TORRENT_SEARCH',
        status: 'QUEUED',
        infoHash: input.infoHash,
        downloadUrl: input.urls.join('\n'),
        releaseTitle: input.releaseTitle,
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
