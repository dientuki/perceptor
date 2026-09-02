import { Resolver, Query, Mutation, Args, Int, ResolveField, Parent } from '@nestjs/graphql';
import { LanguageTrackKind as PrismaLanguageTrackKind } from '@prisma/client';
import { MoviesService } from './movies.service';
import { Movie } from './entities/movies.entity';
import { Language } from '@/languages/entities/language.entity';
import { LanguagesService } from '@/languages/languages.service';
import { LanguageTrackKind } from '@/preferences/entities/language-track-kind.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

@Resolver(() => Movie)
export class MoviesResolver {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly languagesService: LanguagesService,
  ) {}

  // Field resolvers only run when the client selects them — keeps the
  // `movies` listing from turning into N+1 (see 011-av1-transcode/plan.md's
  // risk table). The caller's own per-title list, per kind, never the
  // merged set (039-per-title-language-split).
  @ResolveField(() => [Language])
  async audioLanguages(@Parent() movie: Movie, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.languagesService.findMoviePreferredTrackLanguagesFor(
      userId,
      movie.id,
      PrismaLanguageTrackKind.AUDIO,
    );
  }

  @ResolveField(() => [Language])
  async subtitleLanguages(@Parent() movie: Movie, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.languagesService.findMoviePreferredTrackLanguagesFor(
      userId,
      movie.id,
      PrismaLanguageTrackKind.SUBTITLE,
    );
  }

  // The caller's own audio-mandatory flag for this film (039-per-title-
  // language-split REQ-9). Only runs when the client selects it, same
  // N+1-avoidance reasoning as audioLanguages/subtitleLanguages above.
  @ResolveField(() => Boolean)
  async audioMandatory(@Parent() movie: Movie, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.moviesService.findAudioMandatoryFor(userId, movie.id);
  }

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
    @Args('infoHash', { type: () => String, nullable: true }) infoHash: string | null,
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

  @Mutation(() => [Language], {
    name: 'setMoviePreferredTrackLanguages',
    description: 'Reemplaza la preferencia de idiomas del usuario para esta película, para un tipo de pista',
  })
  async setMoviePreferredTrackLanguages(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('kind', { type: () => LanguageTrackKind }) kind: LanguageTrackKind,
    @Args('tags', { type: () => [String] }) tags: string[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    // The global JwtAuthGuard already requires a credential and this operation
    // carries no @AllowService(), so principal should always be 'user' — narrowed
    // anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    // findOneFromDb() returns null both for a missing id and for a film the
    // caller does not own (see movies.service.ts) — same ownership scoping
    // as movie(id), same message reused verbatim from 008-movie-detail.
    const movie = await this.moviesService.findOneFromDb(movieId, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: movieId });
    return this.languagesService.setMoviePreferredTrackLanguagesFor(
      userId,
      movieId,
      kind as unknown as PrismaLanguageTrackKind,
      tags,
    );
  }

  @Mutation(() => Boolean, {
    name: 'setMovieAudioMandatory',
    description: 'Marca si el audio en el idioma preferido es obligatorio para esta película',
  })
  async setMovieAudioMandatory(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('mandatory', { type: () => Boolean }) mandatory: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    // Same ownership refusal as setMoviePreferredTrackLanguages, reused
    // verbatim (039-per-title-language-split REQ-10).
    const movie = await this.moviesService.findOneFromDb(movieId, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: movieId });
    return this.moviesService.setAudioMandatoryFor(userId, movieId, mandatory);
  }
}
