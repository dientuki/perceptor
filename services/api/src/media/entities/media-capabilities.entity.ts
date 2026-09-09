import { ObjectType, Field } from '@nestjs/graphql';

// The system-wide pair of switches behind `mediaCapabilities` — see
// 045-media-type-availability/spec.md § GraphQL Contract Delta. Deliberately
// exactly two booleans, not a list of enabled types: `web` derives its
// search mode from the pair rather than from a convenience field.
@ObjectType()
export class MediaCapabilities {
  @Field()
  moviesEnabled: boolean;

  @Field()
  showsEnabled: boolean;

  @Field()
  shortsEnabled: boolean;
}
