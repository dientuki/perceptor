import { Module } from '@nestjs/common';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { LibraryLocationModule } from '@/library-location/library-location.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';
import { SubtitleEmbedModule } from '@/subtitle-embed/subtitle-embed.module';
import { SubtitleSearchQueueModule } from './subtitle-search-queue.module';
import { SubtitleSearchRequestService } from './subtitle-search-request.service';

// Spec 103, REQ-4
@Module({
  imports: [
    MediaCapabilitiesModule,
    SubtitleSearchQueueModule,
    SubtitleEmbedModule,
    MediaServerModule,
    MediaRootsModule,
    LibraryLocationModule,
  ],
  providers: [SubtitleSearchRequestService],
  exports: [SubtitleSearchRequestService],
})
export class SubtitleSearchRequestModule {}
