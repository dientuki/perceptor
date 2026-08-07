import { Module } from '@nestjs/common';
import { IndexerResolver } from './indexer.resolver';
import { IndexerService } from './indexer.service';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [IndexerResolver, IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
