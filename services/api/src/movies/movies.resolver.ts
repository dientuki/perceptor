import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MoviesService } from './movies.service';
import { Movie } from './entities/movies.entity';
import { MediaSearchResult } from './entities/media-search-result.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver(() => Movie)
export class MoviesResolver {
  constructor(private readonly moviesService: MoviesService) {}

  // Direct query against the DB (MariaDB / Prisma), scoped to the caller's
  // own library. The global JwtAuthGuard already requires a credential; none
  // of these operations carry @AllowService(), so principal should always be
  // 'user' — narrowed anyway, for structural safety (see auth.types.ts).
  @Query(() => [Movie], { name: 'movies' })
  async getMovies(@CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.findAll(userId);
  }

  // Si querés obtener una sola película por su ID interno de DB
  @Query(() => Movie, { name: 'movie', nullable: true })
  async getMovieById(@Args('id', { type: () => Int }) id: number) {
    return this.moviesService.findOneFromDb(id);
  }

  @Query(() => [MediaSearchResult], { name: 'searchMovies', description: 'Busca películas en TMDB' })
  async searchMovies(
    @Args('query', { type: () => String }) query: string,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<MediaSearchResult[]> {
    // The global JwtAuthGuard already requires a credential and this operation
    // carries no @AllowService(), so principal should always be 'user' — narrowed
    // anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.searchMovies(query, userId);
  }

  // Sin anotar el tipo de retorno: igual que getMovies/getMovieById, el shape que
  // devuelve Prisma (overview/posterUrl null en vez de undefined, status como enum)
  // no calza estructuralmente con el @ObjectType() Movie, y es GraphQL —vía los
  // decoradores— quien define la forma real de la respuesta, no el tipo de TS.
  @Mutation(() => Movie, { name: 'addMovie', description: 'Registra una película de TMDB en la biblioteca' })
  async addMovie(@Args('tmdbId', { type: () => Int }) tmdbId: number, @CurrentUser() principal: AuthPrincipal) {
    // The global JwtAuthGuard already requires a credential and this operation
    // carries no @AllowService(), so principal should always be 'user' — narrowed
    // anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.addMovie(tmdbId, userId);
  }

  @Mutation(() => Movie, {
    name: 'addTorrentToMovie',
    description: 'Envía un release elegido a qBittorrent y lo asocia a la película',
  })
  async addTorrentToMovie(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('infoHash') infoHash: string,
    @Args('urls', { type: () => [String] }) urls: string[],
    @Args('releaseTitle', { type: () => String, nullable: true }) releaseTitle: string | null,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    // The global JwtAuthGuard already requires a credential and this operation
    // carries no @AllowService(), so principal should always be 'user' — narrowed
    // anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.addTorrentToMovie(movieId, { infoHash, urls, releaseTitle, force }, userId);
  }

  @Mutation(() => Movie, {
    name: 'addMagnetToMovie',
    description: 'Manda un magnet pegado por el usuario a qBittorrent y lo asocia a la película',
  })
  async addMagnetToMovie(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('magnet') magnet: string,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    // The global JwtAuthGuard already requires a credential and this operation
    // carries no @AllowService(), so principal should always be 'user' — narrowed
    // anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.addMagnetToMovie(movieId, { magnet, force }, userId);
  }
}
