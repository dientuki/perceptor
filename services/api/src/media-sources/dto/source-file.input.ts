import { InputType, Field, Float } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsNumber, IsBoolean } from 'class-validator';

@InputType()
export class SourceFileInput {
  @Field()
  @IsNotEmpty()
  filePath: string;

  @Field()
  @IsNotEmpty()
  fileName: string;

  // Float y no Int: los releases pasan el techo de Int con facilidad.
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  size?: number;

  // The extension list that decides what counts as a video lives in the worker
  // (src/scan/scan-folder.ts), not here. If api re-tested extensions itself, the
  // two lists would drift apart silently: a mismatch would treat a real video as
  // an unmatched sidecar file (or vice versa), which would set hasUnmatchedFiles
  // and suppress cleanup forever without ever raising an error anywhere.
  @Field()
  @IsBoolean()
  isVideo: boolean;
}
