import { InputType, Field, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

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

  // Spec 113, REQ-2
  @Field({
    defaultValue: false,
    description:
      "True: api measures the offset (113 REQ-3) and ignores offsetMs. Defaults to false (101's behaviour).",
  })
  @IsOptional()
  @IsBoolean()
  autoOffset: boolean;
}
