import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

// Read-only projection of the Prisma Episode model, one level below Season
// (season.entity.ts) below Show (show.entity.ts). `status` is a plain
// `string` for the same reason Show.status/Movie.status already are: three
// structurally-parallel status fields should not diverge into an enum for
// only one of them (see show.entity.ts's own comment). No image field — the
// Prisma model has none.
@ObjectType()
export class Episode {
  @Field(() => ID)
  id: number;

  @Field(() => Int)
  episodeNumber: number;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  overview?: string;

  @Field({ nullable: true })
  releaseDate?: Date;

  @Field()
  status: string;
}
