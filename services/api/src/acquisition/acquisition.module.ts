import { Module } from '@nestjs/common';
import { AttachSourceService } from './attach-source.service';
import { SettingsModule } from '@/settings/settings.module';
import { DownloadsModule } from '@/downloads/downloads.module';

// A module of its own, not folded into DownloadsModule or any of
// movies/episodes/seasons — see 088-acquisition-path-unification/plan.md §
// Decided Here for why. No forwardRef: DownloadsService depends on neither
// movies, episodes nor seasons, so MoviesModule/EpisodesModule/SeasonsModule
// can import this module with no cycle, the same way MediaCapabilitiesModule
// (048-shorts-category) was split out of MediaModule for an identical
// reason.

// Spec 088, REQ-1 REQ-10
@Module({
  imports: [SettingsModule, DownloadsModule],
  providers: [AttachSourceService],
  exports: [AttachSourceService],
})
export class AcquisitionModule {}
