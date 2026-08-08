import { Module } from '@nestjs/common';
import { MediaSourcesResolver } from './media-sources.resolver';
import { MediaSourcesService } from './media-sources.service';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [MediaSourcesResolver, MediaSourcesService],
})
export class MediaSourcesModule {}
