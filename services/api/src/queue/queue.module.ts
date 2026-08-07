import { Module } from '@nestjs/common';
import { ProcessQueueService } from '@/queue/process-queue.service';

@Module({
  providers: [ProcessQueueService],
  exports: [ProcessQueueService],
})
export class QueueModule {}
