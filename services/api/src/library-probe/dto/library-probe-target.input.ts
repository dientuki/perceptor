import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional } from 'class-validator';

// Spec 108, REQ-2
@InputType()
export class LibraryProbeTarget {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  movieId?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  episodeId?: number;
}
