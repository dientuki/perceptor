import { Module } from '@nestjs/common';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';
import { MediaServerIndexModule } from '@/media-server-index/media-server-index.module';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';
import { SubtitleEmbedModule } from '@/subtitle-embed/subtitle-embed.module';
import { SubtitleSearchQueueModule } from './subtitle-search-queue.module';
import { SubtitleSearchDriver } from './subtitle-search.driver';
import { SubtitleSearchStaging } from './staging';
import { SubtitleSearchService } from './subtitle-search.service';
import {
  EpisodeSubtitleSearchFieldsResolver,
  MovieSubtitleSearchFieldsResolver,
  SubtitleSearchResolver,
} from './subtitle-search.resolver';

@Module({
  imports: [
    SubtitleSearchQueueModule,
    SubtitleEmbedModule,
    MediaServerModule,
    MediaServerIndexModule,
    MediaCapabilitiesModule,
    MediaRootsModule,
    SettingsModule,
    QueueModule,
  ],
  providers: [
    SubtitleSearchService,
    SubtitleSearchDriver,
    SubtitleSearchStaging,
    SubtitleSearchResolver,
    MovieSubtitleSearchFieldsResolver,
    EpisodeSubtitleSearchFieldsResolver,
  ],
  exports: [SubtitleSearchService],
})
export class SubtitleSearchModule {}
