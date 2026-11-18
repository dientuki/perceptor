import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SubtitleProviderKind } from '../entities/subtitle-provider-kind.enum';

// Spec 121, REQ-3
@InputType()
export class SubtitleProviderInput {
  @Field(() => SubtitleProviderKind)
  @IsEnum(SubtitleProviderKind)
  kind: SubtitleProviderKind;

  @Field(() => String, { nullable: true, description: 'OPENSUBTITLES only.' })
  @IsOptional()
  @IsString()
  username?: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Password (OPENSUBTITLES) or API key (SUBDIVX). Null or empty keeps the stored value.',
  })
  @IsOptional()
  @IsString()
  secret?: string | null;
}

// Spec 121, REQ-6
@InputType()
export class SubtitleProviderLanguageInput {
  @Field()
  @IsString()
  languageTag: string;

  @Field(() => SubtitleProviderKind)
  @IsEnum(SubtitleProviderKind)
  provider: SubtitleProviderKind;
}
