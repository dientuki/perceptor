import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 101, REQ-14
@ObjectType()
export class SubtitleEmbedTrack {
  @Field({
    description:
      "Absolute container path of the sidecar, in filePath's directory (REQ-14); read, then deleted after the rename (REQ-12).",
  })
  sourcePath: string;

  @Field()
  languageIso3: string;

  @Field()
  trackTitle: string;

  @Field()
  isDefault: boolean;

  @Field()
  isForced: boolean;

  @Field(() => Int)
  offsetMs: number;
}

// Spec 101, REQ-13
@ObjectType()
export class SubtitleEmbedDetails {
  @Field(() => Int)
  id: number;

  @Field({
    description: 'Absolute container path of the library .mkv to replace.',
  })
  filePath: string;

  @Field(() => [SubtitleEmbedTrack])
  tracks: SubtitleEmbedTrack[];
}
