import { Module } from '@nestjs/common';
import { ProcessJobsResolver } from './process-jobs.resolver';
import { ProcessJobsService } from './process-jobs.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';

// SettingsModule exporta QbittorrentClient (lo necesita downloadRemove) y
// SettingsService (lo necesita resolveOutputRoot), igual que ya lo consume
// MoviesModule. MediaRootsModule resuelve path_movies/path_shows a la ruta
// absoluta de outputRoot. MediaServerModule avisa a Jellyfin (o lo que esté
// configurado) cuando encodeCompleted termina de escribir.
@Module({
  imports: [SettingsModule, MediaRootsModule, MediaServerModule],
  providers: [ProcessJobsResolver, ProcessJobsService],
})
export class ProcessJobsModule {}
