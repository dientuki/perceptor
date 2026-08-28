import { Module } from '@nestjs/common';
import { DownloadsResolver } from './downloads.resolver';
import { DownloadsService } from './downloads.service';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';

// SettingsModule exports QbittorrentClient — the read/control surface
// (movieDownloads/showDownloads, downloadStart/Stop/Delete) and the race
// arbiter both need it, same as MoviesModule/ProcessJobsModule already do.
// Exports DownloadsService so UploadsModule can call the shared race
// arbiter (resolveRace, REQ-19) without reimplementing it.
@Module({
  imports: [QueueModule, SettingsModule],
  providers: [DownloadsResolver, DownloadsService],
  exports: [DownloadsService],
})
export class DownloadsModule {}
