import { BadRequestException, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { UploadTicket } from './entities/upload-ticket.entity';
import { UploadTicketsService } from './upload-tickets.service';
import { MoviesService } from '@/movies/movies.service';
import { EpisodesService } from '@/episodes/episodes.service';

@Resolver()
export class UploadsResolver {
  constructor(
    private readonly uploadTickets: UploadTicketsService,
    private readonly movies: MoviesService,
    private readonly episodes: EpisodesService,
  ) {}

  // Deliberately no @AllowService() — an upload ticket is delegated from a
  // user session (REQ-11), and a service principal has no user to delegate
  // for. The guard's missing @AllowService() already keeps a service
  // principal out; the `principal.type` narrowing below is for TypeScript.
  //
  // 010-episode-acquisition: both arguments are nullable and exactly one
  // must be supplied — a required-one-of has no expression in GraphQL's
  // type system, so it is a runtime check here, deliberately (see
  // api/plan.md § Contract Freeze — do not "fix" this with a second
  // mutation, and do not let one argument silently win over the other).
  @UseGuards(JwtAuthGuard)
  @Mutation(() => UploadTicket)
  async createUploadTicket(
    @Args('movieId', { type: () => Int, nullable: true }) movieId: number | null | undefined,
    @Args('episodeId', { type: () => Int, nullable: true }) episodeId: number | null | undefined,
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
      return await this.uploadTickets.mint(principal.id, { movieId: movieId as number });
    }

    const episode = await this.episodes.findOneFromDb(episodeId as number, principal.id);
    if (!episode) {
      throw new NotFoundException(`El episodio ${episodeId} no existe`);
    }
    return await this.uploadTickets.mint(principal.id, { episodeId: episodeId as number });
  }
}
