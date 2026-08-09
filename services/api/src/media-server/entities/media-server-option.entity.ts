import { ObjectType, Field, ID } from '@nestjs/graphql';

// Una opción del combo de Settings — 'Ninguno' + una por cada media server
// del registro (ver clients/media-server/registry.ts). Sin esta query el
// contrato GraphQL-only obligaría a hardcodear la lista en services/web.
@ObjectType()
export class MediaServerOption {
  @Field(() => ID)
  id: string; // 'none' | 'jellyfin' | ...

  @Field()
  label: string;
}
