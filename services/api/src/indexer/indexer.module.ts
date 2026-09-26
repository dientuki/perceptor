import { Module } from '@nestjs/common';
import { IndexerResolver } from './indexer.resolver';
import { IndexerService } from './indexer.service';
import { RankingContextService } from './ranking-context.service';
import { SettingsModule } from '@/settings/settings.module';
import { RedisModule } from '@/redis/redis.module';
import { MoviesModule } from '@/movies/movies.module';
import { ShowsModule } from '@/shows/shows.module';
import { SeasonsModule } from '@/seasons/seasons.module';
import { EpisodesModule } from '@/episodes/episodes.module';
import { PreferencesModule } from '@/preferences/preferences.module';
import { LanguagesModule } from '@/languages/languages.module';

@Module({
  imports: [
    SettingsModule,
    RedisModule,
    MoviesModule,
    ShowsModule,
    SeasonsModule,
    EpisodesModule,
    PreferencesModule,
    LanguagesModule,
  ],
  providers: [IndexerResolver, IndexerService, RankingContextService],
  exports: [IndexerService, RankingContextService],
})
export class IndexerModule {}
