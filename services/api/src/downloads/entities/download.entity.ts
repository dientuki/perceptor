import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import { DownloadError } from './download-error.entity';

// Spec 022, REQ-9 REQ-10 REQ-18 REQ-19
@ObjectType()
export class Download {
  @Field(() => Int)
  mediaSourceId: number;

  @Field({ nullable: true })
  infoHash?: string;

  @Field()
  kind: string;

  @Field()
  label: string;

  @Field({ nullable: true })
  releaseTitle?: string;

  @Field(() => Int, { nullable: true })
  movieId?: number;

  @Field(() => Int, { nullable: true })
  seasonId?: number;

  @Field(() => Int, { nullable: true })
  seasonNumber?: number;

  @Field(() => Int, { nullable: true })
  showId?: number;

  @Field({ nullable: true })
  showTitle?: string;

  @Field()
  owned: boolean;

  @Field(() => Int, { nullable: true })
  episodeId?: number;

  @Field()
  status: string;

  @Field({ nullable: true })
  torrentState?: string;

  @Field(() => Float, { nullable: true })
  downloadProgress?: number;

  @Field(() => Float, { nullable: true })
  encodeProgress?: number;

  @Field()
  compressionEnabled: boolean;

  @Field(() => Float, { nullable: true })
  downloadSpeed?: number;

  @Field(() => Float, { nullable: true })
  encodeSpeed?: number;

  @Field(() => DownloadError, { nullable: true })
  lastError?: DownloadError;

  @Field()
  retryable: boolean;

  @Field()
  readAt: Date;
}
