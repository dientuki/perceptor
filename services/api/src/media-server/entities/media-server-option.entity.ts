import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class MediaServerOption {
  @Field(() => ID)
  id: string; // 'none' | 'jellyfin' | ...

  @Field()
  label: string;

  @Field(() => Int, { nullable: true })
  defaultPort: number | null;

  @Field(() => String, { nullable: true })
  credentialLabel: string | null;

  @Field(() => String, { nullable: true })
  credentialHelpUrl: string | null;
}
