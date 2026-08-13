import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MoviesService } from './movies.service';
import { Movie } from './entities/movies.entity';
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

  // Single film by internal DB id, scoped to the caller's own library — see
  // spec.md's 008-movie-detail for why null now means "not available to
  // you" as well as "does not exist".
  @Query(() => Movie, { name: 'movie', nullable: true })
  async getMovieById(@Args('id', { type: () => Int }) id: number, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.findOneFromDb(id, userId);
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
