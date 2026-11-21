import { Module } from '@nestjs/common';
import { MediaServerModule } from '@/media-server/media-server.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { LibraryLocationModule } from '@/library-location/library-location.module';
import { QueueModule } from '@/queue/queue.module';
import { LibraryTagsService } from './library-tags.service';
import { LibraryTagsResolver } from './library-tags.resolver';

// Spec 123, REQ-12
@Module({
  imports: [
    MediaServerModule,
    MediaRootsModule,
    LibraryLocationModule,
    QueueModule,
  ],
  providers: [LibraryTagsService, LibraryTagsResolver],
  exports: [LibraryTagsService],
})
export class LibraryTagsModule {}
