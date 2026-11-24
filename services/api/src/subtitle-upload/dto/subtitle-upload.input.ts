import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsString } from 'class-validator';

// Spec 124, REQ-6
@InputType()
export class SubtitleUploadInput {
  @Field({
    description:
      "The picked file's base name, ending in .srt (case-insensitive); the row's identity within the request, never used as a path.",
  })
  @IsString()
  fileName: string;

  @Field({
    description:
      "The file's bytes, base64-encoded, as uploaded (any charset; api normalizes to UTF-8, REQ-8). At most 2 MiB decoded.",
  })
  @IsString()
  contentBase64: string;

  @Field({
    description:
      'A Language.tag from the languages catalog (e.g. "es-419", "en"), so a regional variant can be chosen.',
  })
  @IsString()
  languageTag: string;

  @Field()
  @IsBoolean()
  isForced: boolean;

  @Field()
  @IsBoolean()
  isDefault: boolean;

  @Field({
    description:
      "Drop the file's existing non-forced text subtitle tracks of this language in the same remux (REQ-9).",
  })
  @IsBoolean()
  replace: boolean;

  @Field(() => Int, {
    description:
      "Manual offset in ms (101's convention). Ignored when autoOffset is true.",
  })
  @IsInt()
  offsetMs: number;

  @Field({
    description: 'True: api measures the offset (113) and ignores offsetMs.',
  })
  @IsBoolean()
  autoOffset: boolean;
}
