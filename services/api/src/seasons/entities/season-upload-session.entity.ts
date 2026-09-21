import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SeasonUploadSession {
  @Field(() => Int)
  mediaSourceId: number;

  @Field(() => Int)
  seasonId: number;
}
