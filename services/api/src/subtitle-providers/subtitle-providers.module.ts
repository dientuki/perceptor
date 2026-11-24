import { Module } from '@nestjs/common';
import { SettingsModule } from '@/settings/settings.module';
import { SubtitleProvidersResolver } from './subtitle-providers.resolver';
import { SubtitleProvidersService } from './subtitle-providers.service';

@Module({
  imports: [SettingsModule],
  providers: [SubtitleProvidersResolver, SubtitleProvidersService],
  exports: [SubtitleProvidersService],
})
export class SubtitleProvidersModule {}
