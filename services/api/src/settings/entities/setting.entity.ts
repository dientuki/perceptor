import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class Setting {
  @Field()
  key: string;

  @Field()
  value: string;
}
