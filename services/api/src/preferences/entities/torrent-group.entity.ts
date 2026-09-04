import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType({
  description:
    'A release group name in the administrator-curated catalog. Carries no scope of its own — ' +
    'a user decides, per group, whether it applies to their films, their series, both or neither.',
})
export class TorrentGroup {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;
}
