import { Module } from '@nestjs/common';
import { SettingsModule } from '@/settings/settings.module';
import { ImdbIdsService } from './imdb-ids.service';

@Module({
  imports: [SettingsModule],
  providers: [ImdbIdsService],
  exports: [ImdbIdsService],
})
export class ImdbIdsModule {}
