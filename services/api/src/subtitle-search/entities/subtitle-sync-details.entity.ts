import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 103, REQ-10
@ObjectType()
export class SubtitleSyncDetails {
  @Field(() => Int)
  id: number;

  @Field({
    description:
      'Absolute container path of the library .mkv used as the reference.',
  })
  filePath: string;

  @Field({
    description:
      'Absolute container path of the staged candidate, under the downloads root.',
  })
  candidatePath: string;
}
