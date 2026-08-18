import { Module } from '@nestjs/common';
import { SeasonsResolver } from './seasons.resolver';
import { SeasonsService } from './seasons.service';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [SeasonsResolver, SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
