import { InputType, Field, Float } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

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
}
