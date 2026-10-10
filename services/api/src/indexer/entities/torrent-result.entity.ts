import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class TorrentLink {
  @Field(() => String, { nullable: true })
  downloadUrl: string | null;
}

@ObjectType()
export class ReleaseRanking {
  @Field(() => Int) resolutionTier: number;
  @Field() resolutionLabel: string;
  @Field() preferredGroup: boolean;

  @Field(() => String, { nullable: true })
  groupLabel: string | null;

  @Field(() => Int) sourceRank: number;
  @Field() sourceLabel: string;
  @Field(() => Int) codecRank: number;
  @Field() codecLabel: string;
  @Field(() => Int) dynamicRangeRank: number;
  @Field() dynamicRangeLabel: string;
  @Field(() => Int) audioRank: number;
  @Field() audioLabel: string;

  @Field(() => String, { nullable: true })
  matchedLanguage: string | null;

  @Field() sourcePromoted: boolean;
}

@ObjectType()
export class TorrentResult {
  @Field() id: string;

  @Field(() => String, { nullable: true })
  infoHash: string | null;

  @Field(() => String, { nullable: true })
  title: string | null;

  @Field(() => Float, { nullable: true })
  size: number | null;

  @Field(() => Int) seeders: number;
  @Field(() => Int) leechers: number;

  @Field(() => [TorrentLink]) items: TorrentLink[];
  @Field(() => [TorrentLink]) infoUrl: TorrentLink[];

  @Field(() => ReleaseRanking, {
    description: 'Parsed ranking of this release. Present on every row, vetoed ones included.',
  })
  ranking: ReleaseRanking;

  @Field({
    description:
      'True when this row survived every veto and sits in the best resolution tier present in this response.',
  })
  candidate: boolean;

  @Field(() => Int, {
    nullable: true,
    description: '1-based position among the candidates, best first. Null when `candidate` is false.',
  })
  candidateRank: number | null;
}
