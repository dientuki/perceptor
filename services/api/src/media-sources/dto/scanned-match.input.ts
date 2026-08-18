import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsInt } from 'class-validator';

@InputType()
export class ScannedMatchInput {
  @Field()
  @IsNotEmpty()
  filePath: string;

  // Only populated for a season source; api ignores these for a film or a
  // single-episode source. Both are read from the worker's filename parse only,
  // never derived here.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  seasonNumber?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  episodeNumber?: number;
}
