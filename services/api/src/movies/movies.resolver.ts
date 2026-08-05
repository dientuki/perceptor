import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MoviesService } from './movies.service';
import { Movie } from './entities/movies.entity';

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
}