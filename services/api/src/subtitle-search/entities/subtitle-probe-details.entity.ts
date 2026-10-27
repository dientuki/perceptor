import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 107, T005
@ObjectType()
export class SubtitleProbeDetails {
  @Field(() => Int)
  id: number;

  @Field({ description: 'Absolute container path of the library file to probe.' })
  filePath: string;
}
