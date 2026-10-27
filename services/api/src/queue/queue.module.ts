import { Module } from '@nestjs/common';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { SubtitleEmbedQueueService } from '@/queue/subtitle-embed-queue.service';
import { SubtitleSyncQueueService } from '@/queue/subtitle-sync-queue.service';
import { SubtitleProbeQueueService } from '@/queue/subtitle-probe-queue.service';
import { LibraryProbeQueueService } from '@/queue/library-probe-queue.service';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [
    ProcessQueueService,
    EncodeQueueService,
    SubtitleEmbedQueueService,
    SubtitleSyncQueueService,
    SubtitleProbeQueueService,
    LibraryProbeQueueService,
  ],
  exports: [
    ProcessQueueService,
    EncodeQueueService,
    SubtitleEmbedQueueService,
    SubtitleSyncQueueService,
    SubtitleProbeQueueService,
    LibraryProbeQueueService,
  ],
})
export class QueueModule {}
