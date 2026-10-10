import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class MediaRoot {
  @Field(() => ID)
  id: string; // 'downloads' | 'library'

  @Field()
  label: string;

  @Field()
  hostPath: string;

  @Field()
  available: boolean;
}
