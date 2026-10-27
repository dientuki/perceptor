import { Field, ObjectType } from '@nestjs/graphql';

// Spec 108, REQ-2
@ObjectType()
export class LibraryProbeDetails {
  @Field({ description: 'Absolute container path of the library file to read.' })
  filePath: string;
}
