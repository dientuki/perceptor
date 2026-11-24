import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

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
      'Value of the PERCEPTOR → SOURCE track tag (107 REQ-14, 123 REQ-9): the OpenSubtitles file name for a searched track, `user` for a sidecar embedded by hand. Written verbatim after sanitizing; never empty.',
  })
  provenance: string;

  // Spec 123, REQ-9
  @Field({
    description:
      'Lower-case provider id written verbatim as PERCEPTOR → PROVIDER: opensubtitles, subdivx, …, or `user` for a hand embed (123 REQ-9/10).',
  })
  provider: string;

  @Field(() => Float, {
    nullable: true,
    description:
      'ffsubsync score of the accepted measurement; null when none ran (manual offset).',
  })
  syncScore: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Measured framerate ratio of the accepted measurement; null when none ran.',
  })
  framerateRatio: number | null;
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

  // Spec 119, REQ-5
  @Field(() => [String], {
    description:
      'ISO 639-2 codes whose existing non-forced text subtitle tracks the worker drops in the same remux (119 REQ-5); empty means append only.',
  })
  replaceLanguagesIso3: string[];
}
