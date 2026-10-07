import { Module } from '@nestjs/common';
import { DownloadsResolver } from './downloads.resolver';
import { DownloadsService } from './downloads.service';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { TitleStatusModule } from '@/title-status/title-status.module';

// Spec 022, REQ-19
@Module({
  imports: [QueueModule, SettingsModule, MediaRootsModule, TitleStatusModule],
  providers: [DownloadsResolver, DownloadsService],
  exports: [DownloadsService],
})
export class DownloadsModule {}
