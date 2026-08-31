import { ObjectType, Field, Int } from '@nestjs/graphql';

// `state` is a plain String!, never a registerEnumType — same reasoning as
// Movie.status/Show.status crossing the wire as strings: a value the client
// doesn't recognize yet (a future fifth state) must not fail to parse.
@ObjectType()
export class MediaServerIndexStatus {
  @Field()
  state: string; // 'never' | 'syncing' | 'ready' | 'failed'

  @Field(() => Int)
  itemCount: number;

  @Field({ nullable: true })
  syncedAt?: Date;
}
