import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 109, REQ-3
@ObjectType()
export class TmdbList {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  tmdbListId: number;

  @Field()
  name: string;

  @Field(() => Date, { nullable: true })
  lastImportedAt?: Date | null;

  @Field(() => String, { nullable: true })
  lastError?: string | null;

  @Field(() => Int, {
    nullable: true,
    description:
      'Items TMDB reported for the list at its last successful read; null until then (109 0.2.0).',
  })
  itemCount?: number | null;
}
