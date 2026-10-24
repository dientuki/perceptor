import { Module } from '@nestjs/common';
import { SubtitleSearchQueueService } from './subtitle-search-queue.service';

// Spec 103: one instance, so exactly one BullMQ Worker consumes subtitle-search.
@Module({
  providers: [SubtitleSearchQueueService],
  exports: [SubtitleSearchQueueService],
})
export class SubtitleSearchQueueModule {}
