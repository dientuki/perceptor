import { Module } from '@nestjs/common';
import { LibraryLocationModule } from '@/library-location/library-location.module';
import { QueueModule } from '@/queue/queue.module';
import { LibraryProbeService } from './library-probe.service';
import {
  EpisodeLibraryTracksResolver,
  LibraryProbeResolver,
  MovieLibraryTracksResolver,
} from './library-probe.resolver';

// Spec 108, REQ-1 REQ-2
@Module({
  imports: [LibraryLocationModule, QueueModule],
  providers: [
    LibraryProbeService,
    LibraryProbeResolver,
    MovieLibraryTracksResolver,
    EpisodeLibraryTracksResolver,
  ],
  exports: [LibraryProbeService],
})
export class LibraryProbeModule {}
