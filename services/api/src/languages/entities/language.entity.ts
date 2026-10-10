import { ObjectType, Field, ID } from '@nestjs/graphql';

// Spec 011, NFR-4; Spec 030, REQ-2
@ObjectType()
export class Language {
  @Field(() => ID)
  id: number;

  @Field()
  tag: string;

  @Field()
  iso2: string;

  @Field()
  iso3: string;

  @Field()
  name: string;
}
