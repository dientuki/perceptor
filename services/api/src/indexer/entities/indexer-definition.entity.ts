import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';

export enum IndexerMediaCategory {
  MOVIES = 'MOVIES',
  TV = 'TV',
  ANIME = 'ANIME',
}

registerEnumType(IndexerMediaCategory, { name: 'IndexerMediaCategory' });

@ObjectType()
export class IndexerDefinition {
  @Field({ description: "Prowlarr's definition identifier (definitionName). Opaque to web." })
  definitionName: string;

  @Field()
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'As Prowlarr reports it (e.g. en-US). Null when Prowlarr reports none.',
  })
  language: string | null;

  @Field(() => [IndexerMediaCategory])
  categories: IndexerMediaCategory[];

  @Field({
    description:
      'Prowlarr marks this site as Cloudflare-fronted; addIndexer will attach the flaresolverr tag.',
  })
  needsFlareSolverr: boolean;

  @Field({ description: 'This Prowlarr already holds an indexer of this definition.' })
  configured: boolean;
}
