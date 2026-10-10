import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class MediaSearchResult {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  releaseDate?: string | null;

  @Field(() => String, { nullable: true })
  posterUrl?: string | null;

  @Field()
  originalLanguage: string;

  @Field({ nullable: true })
  overview?: string;

  @Field()
  type: string;

  @Field({ nullable: true })
  status?: string;

  // The id of the registered row, in whatever table `type` names; null when
  // it is not registered by anyone yet (see cacheKey ordering note in
  // movies.service.ts — this field is deliberately absent from
  // clients/types.ts's MediaSearchResult, which is the shared Redis-cached
  // shape).
  @Field(() => Int, { nullable: true })
  mediaId?: number | null;

  // True only when the calling user already has this title in their own
  // library. Never cached — computed per-request after the catalog result
  // is already in Redis.
  @Field()
  inLibrary: boolean;

  // Spec 048, REQ-7
  @Field()
  isShort: boolean;
}
