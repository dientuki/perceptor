import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Episode } from './episode.entity';

// Read-only projection of the Prisma Season model. No image field — the
// schema has none. `episodes` is always resolved via a nested Prisma
// `include` on the same `show(id)` query (ShowsService.findOneFromDb), never
// a separate resolver-level lookup — see show.entity.ts and shows.service.ts.
@ObjectType()
export class Season {
  @Field(() => ID)
  id: number;

  @Field(() => Int)
  seasonNumber: number;

  @Field({ nullable: true })
  releaseDate?: Date;

  @Field(() => [Episode])
  episodes: Episode[];
}
