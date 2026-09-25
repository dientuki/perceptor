import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';

// The outcome of refreshing a title from TMDB and from the media server (069).
export enum RefreshCatalogOutcome {
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export enum RefreshMediaServerOutcome {
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

registerEnumType(RefreshCatalogOutcome, { name: 'RefreshCatalogOutcome' });
registerEnumType(RefreshMediaServerOutcome, { name: 'RefreshMediaServerOutcome' });

@ObjectType({ description: 'The outcome of refreshing a title from TMDB and from the media server.' })
export class TitleRefresh {
  @Field(() => RefreshCatalogOutcome, {
    description: 'Whether the TMDB catalog data was re-read and written in full.',
  })
  catalog: RefreshCatalogOutcome;

  @Field(() => RefreshMediaServerOutcome, {
    description: 'Whether the media server was checked, skipped because none is configured, or failed.',
  })
  mediaServer: RefreshMediaServerOutcome;

  @Field(() => Int, {
    description: 'Films/episodes moved from MISSING to COMPLETED. 0 unless mediaServer is DONE.',
  })
  promoted: number;

  @Field(() => Int, {
    description: 'Films/episodes moved from COMPLETED to MISSING. 0 unless mediaServer is DONE.',
  })
  demoted: number;
}
