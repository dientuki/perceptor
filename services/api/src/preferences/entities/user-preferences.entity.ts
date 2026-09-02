import { ObjectType, Field } from '@nestjs/graphql';

import { Language } from '@/languages/entities/language.entity';

import { TorrentGroup } from './torrent-group.entity';

@ObjectType({
  description: "The signed-in caller's own preferences. Never reachable from another user.",
})
export class UserPreferences {
  @Field({
    description:
      'CAM/TS releases acceptable for this user. False for every user until they say otherwise.',
  })
  allowCinemaReleases: boolean;

  @Field(() => [Language])
  audioLanguages: Language[];

  @Field(() => [Language])
  subtitleLanguages: Language[];

  @Field(() => [TorrentGroup], {
    description: "The caller's selection, both scopes in one list — web splits it by `scope`.",
  })
  torrentGroups: TorrentGroup[];
}
