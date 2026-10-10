import { Module } from '@nestjs/common';
import { EpisodesResolver } from './episodes.resolver';
import { EpisodesService } from './episodes.service';
import { SettingsModule } from '@/settings/settings.module';
import { DownloadsModule } from '@/downloads/downloads.module';
import { AcquisitionModule } from '@/acquisition/acquisition.module';
import { TitleStatusModule } from '@/title-status/title-status.module';

@Module({
  imports: [SettingsModule, DownloadsModule, AcquisitionModule, TitleStatusModule],
  providers: [EpisodesResolver, EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
