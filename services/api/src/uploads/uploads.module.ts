import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { SettingsModule } from '@/settings/settings.module';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [SettingsModule, QueueModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
