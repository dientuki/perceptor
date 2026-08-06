import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class TorrentLink {
  @Field(() => String, { nullable: true })
  downloadUrl: string | null;
}

@ObjectType()
export class TorrentResult {
  @Field() infoHash: string;

  @Field(() => String, { nullable: true })
  title: string | null;

  // Float y no Int: los releases pasan el techo de Int con facilidad (73GB medidos)
  @Field(() => Float, { nullable: true })
  size: number | null;

  @Field(() => Int) seeders: number;
  @Field(() => Int) leechers: number;

  @Field(() => [TorrentLink]) items: TorrentLink[];
  @Field(() => [TorrentLink]) infoUrl: TorrentLink[];
}
