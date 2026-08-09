import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [SettingsModule, MediaRootsModule, QueueModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
