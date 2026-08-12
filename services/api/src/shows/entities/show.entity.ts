import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

// Field-for-field twin of Movie (movies/entities/movies.entity.ts), minus the
// film-only file/source fields and plus seasonsSyncedAt. `status` is a plain
// `string` on purpose even though the Prisma column is the MediaStatus enum:
// Movie.status already crosses the boundary as String! and web hand-retypes
// both listings, so a GraphQL enum here alone would make the two structurally
// different (see 007-library-listing/plan.md § Contract Freeze).
@ObjectType()
export class Show {
  @Field(() => ID)
  id: number;

  @Field(() => Int)
  tmdbId: number;

  @Field()
  title: string;

  @Field({ nullable: true })
  overview?: string;

  @Field({ nullable: true })
  posterUrl?: string;

  @Field({ nullable: true })
  releaseDate?: Date;

  @Field()
  originalLanguage: string;

  @Field()
  isLiveAction: boolean;

  @Field()
  status: string;

  @Field({ nullable: true })
  seasonsSyncedAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
