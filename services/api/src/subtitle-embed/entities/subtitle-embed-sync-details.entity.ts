import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 113, REQ-3
@ObjectType()
export class SubtitleEmbedSyncDetails {
  @Field(() => Int)
  subtitleEmbedId: number;

  @Field()
  fileName: string;

  @Field({
    description:
      'Absolute container path of the library .mkv used as the reference.',
  })
  filePath: string;

  @Field({
    description:
      "Absolute container path of the sidecar, in filePath's directory.",
  })
  candidatePath: string;
}
