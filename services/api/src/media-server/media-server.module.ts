import { Module } from '@nestjs/common';
import { MediaServerResolver } from './media-server.resolver';
import { MediaServerService } from './media-server.service';
import { MediaServerReconcileService } from './media-server-reconcile.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerIndexModule } from '@/media-server-index/media-server-index.module';

@Module({
  imports: [SettingsModule, MediaRootsModule, MediaServerIndexModule],
  providers: [
    MediaServerResolver,
    MediaServerService,
    MediaServerReconcileService,
  ],
  exports: [MediaServerService, MediaServerReconcileService],
})
export class MediaServerModule {}
