import { Module } from '@nestjs/common';
import { ProcessJobsResolver } from './process-jobs.resolver';
import { ProcessJobsService } from './process-jobs.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { QueueModule } from '@/queue/queue.module';

// SettingsModule exporta QbittorrentClient (lo necesita downloadRemove) y
// SettingsService (lo necesita resolveOutputRoot), igual que ya lo consume
// MoviesModule. MediaRootsModule resuelve path_movies/path_shows/path_shorts a
// la ruta absoluta de outputRoot. MediaServerModule avisa a Jellyfin (o lo que
// esté configurado) cuando encodeCompleted termina de escribir.
// MediaCapabilitiesModule (048-shorts-category): resolves whether shorts are
// effectively enabled before choosing path_shorts over path_movies.
// QueueModule (054-interrupted-encode-recovery): exports EncodeQueueService,
// needed by the boot reconciliation to remove/re-add an orphaned encode's
// queue entry. It depends only on RedisModule, so there is no cycle with the
// modules above.
@Module({
  imports: [SettingsModule, MediaRootsModule, MediaServerModule, MediaCapabilitiesModule, QueueModule],
  providers: [ProcessJobsResolver, ProcessJobsService],
})
export class ProcessJobsModule {}
