import { Module } from '@nestjs/common';
import { MediaSourcesResolver } from './media-sources.resolver';
import { MediaSourcesService } from './media-sources.service';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  // SettingsModule for QbittorrentClient (downloadedFiles) — no new
  // provider, no forwardRef: nothing in SettingsModule's graph imports
  // MediaSourcesModule.
  imports: [QueueModule, SettingsModule],
  providers: [MediaSourcesResolver, MediaSourcesService],
})
export class MediaSourcesModule {}
