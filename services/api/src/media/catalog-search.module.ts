import { Module } from '@nestjs/common';
import { CatalogSearchService } from './catalog-search.service';
import { RedisModule } from '@/redis/redis.module';
import { SettingsModule } from '@/settings/settings.module';

// Split out of MediaModule (088-acquisition-path-unification, mirroring
// 048-shorts-category's MediaCapabilitiesModule) so MoviesModule and
// ShowsModule can import CatalogSearchService without importing MediaModule
// itself — MediaModule already imports MoviesModule, so the reverse import
// would be circular. No forwardRef: this module depends on RedisModule and
// SettingsModule (for TmdbClient) only; PrismaService comes from the global
// PrismaModule.
@Module({
  imports: [RedisModule, SettingsModule],
  providers: [CatalogSearchService],
  exports: [CatalogSearchService],
})
export class CatalogSearchModule {}
