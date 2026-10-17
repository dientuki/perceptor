import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import { DownloadError } from './download-error.entity';

// Spec 095, REQ-4 REQ-10
@ObjectType()
export class DownloadJob {
  @Field(() => Int)
  processJobId: number;

  @Field()
  label: string;

  @Field(() => Int, { nullable: true })
  episodeId?: number;

  @Field(() => Int, { nullable: true })
  seasonNumber?: number;

  @Field(() => Int, { nullable: true })
  episodeNumber?: number;

  @Field()
  status: string;

  @Field(() => Float)
  progress: number;

  @Field(() => Float, { nullable: true })
  encodeSpeed?: number;

  @Field(() => DownloadError, { nullable: true })
  lastError?: DownloadError;

  @Field()
  retryable: boolean;
}
