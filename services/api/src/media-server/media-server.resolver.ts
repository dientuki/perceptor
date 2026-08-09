import { Resolver, Query } from '@nestjs/graphql';
import { MediaServerOption } from './entities/media-server-option.entity';
import { MEDIA_SERVER_OPTIONS } from '@/clients/media-server/registry';

@Resolver(() => MediaServerOption)
export class MediaServerResolver {
  @Query(() => [MediaServerOption], {
    name: 'mediaServerClients',
    description:
      'Media servers soportados, derivados del registro de clientes — la UI arma el combo con esto en vez de hardcodear las opciones.',
  })
  mediaServerClients() {
    return MEDIA_SERVER_OPTIONS;
  }
}
