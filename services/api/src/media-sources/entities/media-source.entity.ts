import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class MediaSource {
  @Field(() => ID)
  id: number;

  @Field()
  status: string;

  @Field(() => String, { nullable: true })
  downloadPath: string | null;

  @Field(() => String, { nullable: true })
  releaseTitle: string | null;

  @Field(() => Int, { nullable: true })
  movieId: number | null;

  @Field(() => Int, { nullable: true })
  episodeId: number | null;

  @Field(() => Int, { nullable: true })
  seasonId: number | null;

  @Field(() => String, { nullable: true })
  errorMessage: string | null;

  @Field(() => String, { nullable: true })
  errorKey: string | null;

  @Field(() => String, { nullable: true })
  errorParams: string | null;

  @Field()
  hasUnmatchedFiles: boolean;

  // Resolved on demand against the source's torrent client, never stored —
  // see MediaSourcesResolver's @ResolveField. `[String]` with nullable: true
  // yields `[String!]` in SDL: nullable list, non-null items.
  @Field(() => [String], { nullable: true })
  downloadedFiles: string[] | null;
}
