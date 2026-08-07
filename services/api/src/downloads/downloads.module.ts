import { Module } from '@nestjs/common';
import { DownloadsResolver } from './downloads.resolver';
import { DownloadsService } from './downloads.service';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [DownloadsResolver, DownloadsService],
})
export class DownloadsModule {}
