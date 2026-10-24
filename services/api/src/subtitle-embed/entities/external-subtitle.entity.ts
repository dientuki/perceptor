import { ObjectType, Field } from '@nestjs/graphql';

// Spec 101, REQ-1
@ObjectType()
export class ExternalSubtitle {
  @Field({
    description:
      'The sidecar\'s base name (e.g. "Green Book (2018).spa.srt"); its identity, sent back unchanged in SubtitleEmbedInput.fileName.',
  })
  fileName: string;

  @Field(() => String, {
    nullable: true,
    description:
      'ISO 639-2 code as Jellyfin reports it, null when it reports none.',
  })
  languageIso3: string | null;

  @Field()
  isForced: boolean;

  @Field({
    description:
      'Jellyfin\'s DisplayTitle for the stream (e.g. "Spanish - SUBRIP - External"), for the modal only.',
  })
  title: string;
}
