import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service'; // Ajustá la ruta según tu estructura
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult } from '@/clients/types';
import { createTMDBClient } from '@/clients/tmdb/client';
import { TmdbMovie } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';

// TTL de la cache de resultados de TMDB en Redis (24hs)
const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class MoviesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
        downloadTask: true,
        processJobs: true,
      },
    });
  }

  async findOneFromDb(id: number) {
    return this.prisma.movie.findUnique({
      where: { id },
      include: {
        downloadTask: true,
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

  async searchMovies(query: string): Promise<MediaSearchResult[]> {
    if (!query.trim()) return [];

    // 1. Consultar TMDB. TODO: la config sale de la tabla Setting cuando exista
    const client = createTMDBClient();
    const items = await client.search<TmdbMovie>('movie', query);

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

  // Guarda/actualiza (upsert) cada película en Redis con TTL. No bloquea la
  // respuesta al cliente y no debe poder tirar abajo el proceso: cualquier
  // error se loguea y se descarta acá mismo.
  private async cacheMovies(results: MediaSearchResult[]): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const movie of results) {
        pipeline.set(`tmdb:movie:${movie.id}`, JSON.stringify(movie), 'EX', TMDB_CACHE_TTL_SECONDS);
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
