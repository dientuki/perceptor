import { Module } from '@nestjs/common';
import { EpisodesResolver } from './episodes.resolver';
import { EpisodesService } from './episodes.service';
import { SettingsModule } from '@/settings/settings.module';
import { DownloadsModule } from '@/downloads/downloads.module';

@Module({
  imports: [SettingsModule, DownloadsModule],
  providers: [EpisodesResolver, EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
