import { Module } from '@nestjs/common';
import { MediaCapabilitiesService } from './media-capabilities.service';
import { SettingsModule } from '@/settings/settings.module';

// Split out of MediaModule (048-shorts-category) so ProcessJobsModule and
// MoviesModule can read the shorts capability without importing MediaModule
// itself — MediaModule already imports MoviesModule, so the reverse import
// would be circular. No forwardRef: this module depends on SettingsModule
// only.
@Module({
  imports: [SettingsModule],
  providers: [MediaCapabilitiesService],
  exports: [MediaCapabilitiesService],
})
export class MediaCapabilitiesModule {}
