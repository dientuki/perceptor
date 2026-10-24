import { Module } from '@nestjs/common';
import { MediaServerModule } from '@/media-server/media-server.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { QueueModule } from '@/queue/queue.module';
import { ActiveEmbedGuardModule } from './active-embed-guard.module';
import { SubtitleEmbedService } from './subtitle-embed.service';
import {
  EpisodeSubtitleEmbedFieldsResolver,
  MovieSubtitleEmbedFieldsResolver,
  SubtitleEmbedResolver,
} from './subtitle-embed.resolver';

// Spec 101
@Module({
  imports: [
    MediaServerModule,
    MediaRootsModule,
    QueueModule,
    ActiveEmbedGuardModule,
  ],
  providers: [
    SubtitleEmbedService,
    SubtitleEmbedResolver,
    MovieSubtitleEmbedFieldsResolver,
    EpisodeSubtitleEmbedFieldsResolver,
  ],
  exports: [SubtitleEmbedService],
})
export class SubtitleEmbedModule {}
