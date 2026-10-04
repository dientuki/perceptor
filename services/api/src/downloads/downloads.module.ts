import { Module } from '@nestjs/common';
import { DownloadsResolver } from './downloads.resolver';
import { DownloadsService } from './downloads.service';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';

// Spec 022, REQ-19
@Module({
  imports: [QueueModule, SettingsModule, MediaRootsModule],
  providers: [DownloadsResolver, DownloadsService],
  exports: [DownloadsService],
})
export class DownloadsModule {}
