import { BadRequestException, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { UploadTicket } from './entities/upload-ticket.entity';
import { UploadTicketsService } from './upload-tickets.service';
import { SessionService } from './session.service';
import { MoviesService } from '@/movies/movies.service';
import { EpisodesService } from '@/episodes/episodes.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

@Resolver()
export class UploadsResolver {
  constructor(
    private readonly uploadTickets: UploadTicketsService,
    private readonly movies: MoviesService,
    private readonly episodes: EpisodesService,
    private readonly sessions: SessionService,
  ) {}

  // Spec 002, REQ-11
  @UseGuards(JwtAuthGuard)
  @Mutation(() => UploadTicket)
  async createUploadTicket(
    @Args('movieId', { type: () => Int, nullable: true }) movieId: number | null | undefined,
    @Args('episodeId', { type: () => Int, nullable: true }) episodeId: number | null | undefined,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<UploadTicket> {
    if (principal.type !== 'user') {
      throw new UnauthorizedException('No autenticado');
    }

    const hasMovieId = movieId !== null && movieId !== undefined;
    const hasEpisodeId = episodeId !== null && episodeId !== undefined;

    if (hasMovieId === hasEpisodeId) {
      throw new BadRequestException('Indicá exactamente uno de movieId o episodeId');
    }

    if (hasMovieId) {
      const movie = await this.movies.findOneFromDb(movieId as number, principal.id);
      if (!movie) {
        throw new NotFoundException(`La película ${movieId} no existe`);
      }

      // Spec 022, REQ-7 REQ-6 REQ-19
      if (movie.status === 'COMPLETED' && !force) {
        throw i18nError.conflict(ERROR_KEYS.MOVIE_ALREADY_COMPLETED);
      }

      return await this.uploadTickets.mint(principal.id, { movieId: movieId as number }, force);
    }

    const episode = await this.episodes.findOneFromDb(episodeId as number, principal.id);
    if (!episode) {
      throw new NotFoundException(`El episodio ${episodeId} no existe`);
    }

    // Spec 022, REQ-7
    if (episode.status === 'COMPLETED' && !force) {
      throw i18nError.conflict(ERROR_KEYS.EPISODE_ALREADY_COMPLETED);
    }

    return await this.uploadTickets.mint(principal.id, { episodeId: episodeId as number }, force);
  }

  // 068-season-multi-file-upload: one single-use ticket per file of an open
  // season upload session. Nothing is minted unless the caller owns an open
  // session (LOCAL_FOLDER + PENDING + season-scoped).
  @UseGuards(JwtAuthGuard)
  @Mutation(() => UploadTicket)
  async createSeasonUploadTicket(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<UploadTicket> {
    if (principal.type !== 'user') {
      throw new UnauthorizedException('No autenticado');
    }

    const session = await this.sessions.findOpenSeasonSession(mediaSourceId, principal.id);
    if (!session) {
      throw i18nError.notFound(ERROR_KEYS.UPLOAD_SESSION_NOT_FOUND, { id: mediaSourceId });
    }

    return await this.uploadTickets.mint(principal.id, { mediaSourceId });
  }
}
