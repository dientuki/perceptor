import { ObjectType, Field, Int } from '@nestjs/graphql';

// Reference to a newly-registered (or already-registered) row, without
// committing to which table it lives in — `type` names it, `id` is that
// table's own primary key. See media-search-result.entity.ts's `mediaId`
// doc comment for the same convention.
@ObjectType()
export class MediaRef {
  @Field(() => Int)
  id: number;

  @Field()
  type: string;
}
