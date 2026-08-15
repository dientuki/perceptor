import { Module } from '@nestjs/common';
import { EpisodesResolver } from './episodes.resolver';
import { EpisodesService } from './episodes.service';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [EpisodesResolver, EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
