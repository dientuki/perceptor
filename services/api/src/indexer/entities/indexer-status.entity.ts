import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class IndexerStatus {
  @Field(() => Int, {
    description: 'Indexers currently configured in Prowlarr. 0 when reachable is false.',
  })
  configuredIndexers: number;

  @Field({
    description: 'Whether Prowlarr answered this request at all.',
  })
  reachable: boolean;
}
