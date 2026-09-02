import { ObjectType, Field, Int } from '@nestjs/graphql';

import { TorrentGroupScope } from './torrent-group-scope.enum';

@ObjectType({
  description:
    'A release group, scoped to films or to series. The catalog is administrator-curated.',
})
export class TorrentGroup {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => TorrentGroupScope)
  scope: TorrentGroupScope;
}
