import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Show } from './show.entity';

// Spec 117, REQ-8
@ObjectType()
export class ShowPage {
  @Field(() => [Show])
  items: Show[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  pageSize: number;

  @Field(() => Int)
  totalPages: number;
}
