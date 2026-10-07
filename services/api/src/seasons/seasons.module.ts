import { Module } from '@nestjs/common';
import { SeasonsResolver } from './seasons.resolver';
import { SeasonsService } from './seasons.service';
import { SettingsModule } from '@/settings/settings.module';
import { DownloadsModule } from '@/downloads/downloads.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { QueueModule } from '@/queue/queue.module';
import { UploadsModule } from '@/uploads/uploads.module';
import { AcquisitionModule } from '@/acquisition/acquisition.module';
import { TitleStatusModule } from '@/title-status/title-status.module';

@Module({
  imports: [
    SettingsModule,
    DownloadsModule,
    UploadsModule,
    MediaRootsModule,
    QueueModule,
    AcquisitionModule,
    TitleStatusModule,
  ],
  providers: [SeasonsResolver, SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
