import { Module } from '@nestjs/common';
import { MediaServerResolver } from './media-server.resolver';
import { MediaServerService } from './media-server.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';

@Module({
  imports: [SettingsModule, MediaRootsModule],
  providers: [MediaServerResolver, MediaServerService],
  exports: [MediaServerService],
})
export class MediaServerModule {}
