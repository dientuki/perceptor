import { Module } from '@nestjs/common';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [ProcessQueueService, EncodeQueueService],
  exports: [ProcessQueueService, EncodeQueueService],
})
export class QueueModule {}
