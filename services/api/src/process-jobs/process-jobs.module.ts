import { Module } from '@nestjs/common';
import { ProcessJobsResolver } from './process-jobs.resolver';
import { ProcessJobsService } from './process-jobs.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [SettingsModule, MediaRootsModule, MediaServerModule, MediaCapabilitiesModule, QueueModule],
  providers: [ProcessJobsResolver, ProcessJobsService],
})
export class ProcessJobsModule {}
