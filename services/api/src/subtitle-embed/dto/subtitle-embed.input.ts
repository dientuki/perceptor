import { InputType, Field, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsString } from 'class-validator';

// Spec 101, REQ-4
@InputType()
export class SubtitleEmbedInput {
  @Field()
  @IsString()
  fileName: string;

  @Field()
  @IsString()
  languageIso3: string;

  @Field()
  @IsBoolean()
  isDefault: boolean;

  @Field(() => Int)
  @IsInt()
  offsetMs: number;
}
