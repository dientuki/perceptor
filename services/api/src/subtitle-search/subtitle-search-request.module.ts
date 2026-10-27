import { Module } from '@nestjs/common';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { SubtitleEmbedModule } from '@/subtitle-embed/subtitle-embed.module';
import { SubtitleSearchQueueModule } from './subtitle-search-queue.module';
import { SubtitleSearchRequestService } from './subtitle-search-request.service';

// Spec 103, REQ-4
@Module({
  imports: [
    MediaCapabilitiesModule,
    SubtitleSearchQueueModule,
    SubtitleEmbedModule,
  ],
  providers: [SubtitleSearchRequestService],
  exports: [SubtitleSearchRequestService],
})
export class SubtitleSearchRequestModule {}
