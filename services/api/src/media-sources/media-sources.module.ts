import { Module } from '@nestjs/common';
import { MediaSourcesResolver } from './media-sources.resolver';
import { MediaSourcesService } from './media-sources.service';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';
import { TitleStatusModule } from '@/title-status/title-status.module';

@Module({
  // SettingsModule for QbittorrentClient (downloadedFiles) — no new
  // provider, no forwardRef: nothing in SettingsModule's graph imports
  // MediaSourcesModule. TitleStatusModule (Spec 089) is the single writer
  // of Movie/Episode/Show status — it imports PrismaModule only, so no
  // forwardRef is needed here either.
  imports: [QueueModule, SettingsModule, TitleStatusModule],
  providers: [MediaSourcesResolver, MediaSourcesService],
})
export class MediaSourcesModule {}
