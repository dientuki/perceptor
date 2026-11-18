import { ObjectType, Field } from '@nestjs/graphql';
import { SubtitleProviderKind } from './subtitle-provider-kind.enum';

// Spec 121, REQ-3
@ObjectType()
export class SubtitleProvider {
  @Field(() => SubtitleProviderKind)
  kind: SubtitleProviderKind;

  @Field({ description: "True when this provider's credentials are complete (121 REQ-2)." })
  configured: boolean;

  @Field()
  isDefault: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'OpenSubtitles only; null for SUBDIVX.',
  })
  username: string | null;

  @Field({
    description:
      'True when the password (OPENSUBTITLES) or API key (SUBDIVX) is stored. Never the value.',
  })
  secretSet: boolean;

  @Field(() => [String], {
    nullable: true,
    description: 'ISO 639 tags this kind can serve; null means every language.',
  })
  languageTags: string[] | null;
}

@ObjectType()
export class SubtitleProviderLanguage {
  @Field()
  languageTag: string;

  @Field(() => SubtitleProviderKind)
  provider: SubtitleProviderKind;
}

@ObjectType()
export class SubtitleProviderSettings {
  @Field(() => [SubtitleProvider], {
    description: 'Every kind, configured or not, in enum order.',
  })
  providers: SubtitleProvider[];

  @Field(() => [SubtitleProviderLanguage])
  languages: SubtitleProviderLanguage[];
}
