import { Module } from '@nestjs/common';
import { LibraryLocationModule } from '@/library-location/library-location.module';
import { ShowTrackLanguagesModule } from '@/show-track-languages/show-track-languages.module';
import { QueueModule } from '@/queue/queue.module';
import { LibraryProbeService } from './library-probe.service';
import {
  EpisodeLibraryTracksResolver,
  LibraryProbeResolver,
  MovieLibraryTracksResolver,
  ShowLibraryTracksResolver,
} from './library-probe.resolver';

// Spec 108, REQ-1 REQ-2
@Module({
  imports: [LibraryLocationModule, QueueModule, ShowTrackLanguagesModule],
  providers: [
    LibraryProbeService,
    LibraryProbeResolver,
    MovieLibraryTracksResolver,
    EpisodeLibraryTracksResolver,
    ShowLibraryTracksResolver,
  ],
  exports: [LibraryProbeService],
})
export class LibraryProbeModule {}
