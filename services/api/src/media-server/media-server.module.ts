import { Module } from '@nestjs/common';
import { MediaServerResolver } from './media-server.resolver';
import { MediaServerService } from './media-server.service';
import { MediaServerReconcileService } from './media-server-reconcile.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { QueueModule } from '@/queue/queue.module';
import { MediaServerIndexModule } from '@/media-server-index/media-server-index.module';
import { ShowTrackLanguagesModule } from '@/show-track-languages/show-track-languages.module';

@Module({
  imports: [SettingsModule, MediaRootsModule, MediaServerIndexModule, QueueModule, ShowTrackLanguagesModule],
  providers: [
    MediaServerResolver,
    MediaServerService,
    MediaServerReconcileService,
  ],
  exports: [MediaServerService, MediaServerReconcileService],
})
export class MediaServerModule {}
