import { Resolver, Query } from '@nestjs/graphql';
import { MediaRootsService } from './media-roots.service';
import { MediaRoot } from './entities/media-root.entity';

@Resolver(() => MediaRoot)
export class MediaRootsResolver {
  constructor(private readonly mediaRootsService: MediaRootsService) {}

  @Query(() => [MediaRoot], {
    name: 'mediaRoots',
    description: 'Raíces de media declaradas por .env (descargas, biblioteca) — la UI arma "hostPath + segmento" con esto, nunca una ruta de container.',
  })
  async mediaRoots() {
    return this.mediaRootsService.getRoots();
  }
}
