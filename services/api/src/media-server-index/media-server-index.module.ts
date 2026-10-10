import { Module } from '@nestjs/common';
import { MediaServerIndexService } from './media-server-index.service';
import { RedisModule } from '@/redis/redis.module';

// Spec 034, REQ-2
@Module({
  imports: [RedisModule],
  providers: [MediaServerIndexService],
  exports: [MediaServerIndexService],
})
export class MediaServerIndexModule {}
