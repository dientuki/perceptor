import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class ConfiguredIndexer {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  definitionName: string;

  @Field()
  enabled: boolean;

  @Field()
  usesFlareSolverr: boolean;
}
