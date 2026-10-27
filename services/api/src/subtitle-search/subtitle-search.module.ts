import { Module } from '@nestjs/common';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { RedisModule } from '@/redis/redis.module';
import { OpenSubtitlesClient } from '@/clients/opensubtitles/client';
import { QueueModule } from '@/queue/queue.module';
import { SettingsModule } from '@/settings/settings.module';
import { SubtitleEmbedModule } from '@/subtitle-embed/subtitle-embed.module';
import { SubtitleSearchRequestModule } from './subtitle-search-request.module';
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
    SubtitleSearchRequestModule,
    SubtitleEmbedModule,
    MediaCapabilitiesModule,
    MediaRootsModule,
    SettingsModule,
    QueueModule,
    RedisModule,
  ],
  providers: [
    SubtitleSearchService,
    SubtitleSearchDriver,
    SubtitleSearchStaging,
    OpenSubtitlesClient,
    SubtitleSearchResolver,
    MovieSubtitleSearchFieldsResolver,
    EpisodeSubtitleSearchFieldsResolver,
  ],
  exports: [SubtitleSearchService],
})
export class SubtitleSearchModule {}
