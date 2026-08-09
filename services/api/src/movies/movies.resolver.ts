import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MoviesService } from './movies.service';
import { Movie } from './entities/movies.entity';
import { MediaSearchResult } from './entities/media-search-result.entity';

@Resolver(() => Movie)
export class MoviesResolver {
  constructor(private readonly moviesService: MoviesService) {}

  // Consulta directa a la DB (MariaDB / Prisma)
  @Query(() => [Movie], { name: 'movies' })
  async getMovies() {
    return this.moviesService.findAll();
  }

  // Si querés obtener una sola película por su ID interno de DB
  @Query(() => Movie, { name: 'movie', nullable: true })
  async getMovieById(@Args('id', { type: () => Int }) id: number) {
    return this.moviesService.findOneFromDb(id);
  }

  @Query(() => [MediaSearchResult], { name: 'searchMovies', description: 'Busca películas en TMDB' })
  async searchMovies(
    @Args('query', { type: () => String }) query: string,
  ): Promise<MediaSearchResult[]> {
    return this.moviesService.searchMovies(query);
  }

  // Sin anotar el tipo de retorno: igual que getMovies/getMovieById, el shape que
  // devuelve Prisma (overview/posterUrl null en vez de undefined, status como enum)
  // no calza estructuralmente con el @ObjectType() Movie, y es GraphQL —vía los
  // decoradores— quien define la forma real de la respuesta, no el tipo de TS.
  @Mutation(() => Movie, { name: 'addMovie', description: 'Registra una película de TMDB en la biblioteca' })
  async addMovie(@Args('tmdbId', { type: () => Int }) tmdbId: number) {
    return this.moviesService.addMovie(tmdbId);
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
  ) {
    return this.moviesService.addTorrentToMovie(movieId, { infoHash, urls, releaseTitle, force });
  }

  @Mutation(() => Movie, {
    name: 'addMagnetToMovie',
    description: 'Manda un magnet pegado por el usuario a qBittorrent y lo asocia a la película',
  })
  async addMagnetToMovie(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('magnet') magnet: string,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
  ) {
    return this.moviesService.addMagnetToMovie(movieId, { magnet, force });
  }
}
