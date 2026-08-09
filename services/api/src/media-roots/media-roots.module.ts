import { Module } from '@nestjs/common';
import { MediaRootsService } from './media-roots.service';
import { MediaRootsResolver } from './media-roots.resolver';
import { MEDIA_ROOTS, MediaRootConfig } from './media-roots.types';

// Arma MEDIA_ROOTS leyendo env acá, no adentro del servicio, para que
// media-roots.service.spec.ts pueda inyectar raíces apuntando a un mkdtemp
// (con symlinks reales) sin tocar process.env ni el filesystem del container.
function buildMediaRoots(): MediaRootConfig[] {
  return [
    {
      id: 'downloads',
      label: 'Descargas',
      hostPath: process.env.HOST_DOWNLOADS_DIR ?? '',
      containerPath: process.env.CONTAINER_DOWNLOADS_DIR ?? '/media/downloads',
    },
    {
      id: 'library',
      label: 'Biblioteca',
      hostPath: process.env.HOST_DESTINATIONS_DIR ?? '',
      containerPath: process.env.CONTAINER_DESTINATIONS_DIR ?? '/media/library',
    },
  ];
}

@Module({
  providers: [
    MediaRootsResolver,
    MediaRootsService,
    { provide: MEDIA_ROOTS, useFactory: buildMediaRoots },
  ],
  exports: [MediaRootsService],
})
export class MediaRootsModule {}
