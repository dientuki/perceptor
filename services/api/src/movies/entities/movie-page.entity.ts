import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Movie } from './movies.entity';

// Spec 117, REQ-8
@ObjectType()
export class MoviePage {
  @Field(() => [Movie])
  items: Movie[];

  @Field(() => Int, { description: 'Titles matching the filter, across every page.' })
  totalCount: number;

  @Field(() => Int, {
    description: 'The page actually returned, after clamping to [1, totalPages] (117 REQ-11).',
  })
  page: number;

  @Field(() => Int)
  pageSize: number;

  @Field(() => Int, { description: 'ceil(totalCount / pageSize), and 1 when totalCount is 0.' })
  totalPages: number;
}
