import { Module } from '@nestjs/common';
import { AttachSourceService } from './attach-source.service';
import { SettingsModule } from '@/settings/settings.module';
import { DownloadsModule } from '@/downloads/downloads.module';

// Spec 088, REQ-1 REQ-10
@Module({
  imports: [SettingsModule, DownloadsModule],
  providers: [AttachSourceService],
  exports: [AttachSourceService],
})
export class AcquisitionModule {}
