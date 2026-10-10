import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { ContentKind } from '@/media/entities/content-kind.enum';

@ObjectType()
export class EncodeJobDetails {
  @Field(() => ID)
  id: number;

  @Field()
  status: string;

  @Field()
  inputFilePath: string;

  @Field()
  kind: string; // 'MOVIE' | 'EPISODE'

  @Field(() => Int)
  tmdbId: number;

  @Field()
  title: string;

  @Field(() => Int, { nullable: true })
  year: number | null;

  @Field()
  originalLanguage: string;

  @Field()
  originalLanguageIso3: string;

  // Spec 039, REQ-5 REQ-6 REQ-7
  @Field(() => [String])
  allowedAudioLanguagesIso3: string[];

  // Spec 030, REQ-8
  @Field(() => [String])
  allowedAudioLanguageTags: string[];

  // Spec 039, NFR-4; Spec 039, REQ-5 REQ-6
  @Field(() => [String])
  allowedSubtitleLanguagesIso3: string[];

  @Field(() => [String])
  allowedSubtitleLanguageTags: string[];

  @Field(() => ContentKind)
  contentKind: ContentKind;

  @Field(() => Int, { nullable: true })
  seasonNumber: number | null;

  @Field(() => Int, { nullable: true })
  episodeNumber: number | null;

  @Field(() => String, { nullable: true })
  episodeTitle: string | null;

  @Field(() => Int)
  mediaSourceId: number;

  @Field()
  sourceKind: string;

  @Field(() => String, { nullable: true })
  infoHash: string | null;

  @Field(() => String, { nullable: true })
  downloadPath: string | null;

  @Field()
  outputRoot: string;

  // Spec 012, REQ-12
  @Field()
  downloadsRoot: string;

  // Spec 032, REQ-6
  @Field()
  compressionEnabled: boolean;

  @Field()
  compressionResolution: string;

  @Field(() => [String])
  allowedSubtitleFormats: string[];

  @Field()
  libraryLayout: string;
}
