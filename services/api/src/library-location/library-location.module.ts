import { Module } from '@nestjs/common';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { MediaServerModule } from '@/media-server/media-server.module';
import { LibraryLocationService } from './library-location.service';

// Spec 108, REQ-3
@Module({
  imports: [MediaServerModule, MediaRootsModule],
  providers: [LibraryLocationService],
  exports: [LibraryLocationService],
})
export class LibraryLocationModule {}
