import { ObjectType, Field, Int } from '@nestjs/graphql';

// One row per `ffprobe` call the worker makes before an encode starts
// (023-ffprobe-log). Append-only: no update path, no relation to
// ProcessJob/MediaSource — the log must outlive the row it was taken for.
@ObjectType()
export class FfprobeLog {
  @Field(() => Int)
  id: number;

  @Field()
  file: string;

  @Field()
  ffprobe: string;

  @Field()
  createdAt: Date;
}
