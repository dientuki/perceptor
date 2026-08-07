import { Module } from '@nestjs/common';
import { MediaSourcesResolver } from './media-sources.resolver';
import { MediaSourcesService } from './media-sources.service';

@Module({
  providers: [MediaSourcesResolver, MediaSourcesService],
})
export class MediaSourcesModule {}
