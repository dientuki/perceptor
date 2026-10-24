import { Module } from '@nestjs/common';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { SubtitleSearchQueueModule } from './subtitle-search-queue.module';
import { SubtitleSearchRequestService } from './subtitle-search-request.service';

// Spec 103, REQ-4
@Module({
  imports: [MediaCapabilitiesModule, SubtitleSearchQueueModule],
  providers: [SubtitleSearchRequestService],
  exports: [SubtitleSearchRequestService],
})
export class SubtitleSearchRequestModule {}
