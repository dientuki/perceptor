import { Module } from '@nestjs/common';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';

@Module({
  providers: [ProcessQueueService, EncodeQueueService],
  exports: [ProcessQueueService, EncodeQueueService],
})
export class QueueModule {}
