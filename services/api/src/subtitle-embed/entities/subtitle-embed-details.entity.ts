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

  @Field({
    description:
      'True for a sidecar the worker deletes after the rename; false for a staged track api cleans up itself (Spec 103, REQ-11).',
  })
  isSidecar: boolean;

  // Spec 107, REQ-14
  @Field({
    description:
      'Value of the PERCEPTOR_SOURCE track tag (107 REQ-14): the OpenSubtitles file name for a searched track, `user` for a sidecar embedded by hand. Written verbatim after sanitizing; never empty.',
  })
  provenance: string;
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
