import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { AppResolver } from './app.resolver';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { MoviesModule } from './movies/movies.module';
import { IndexerModule } from './indexer/indexer.module';
import { SettingsModule } from './settings/settings.module';
import { DownloadsModule } from './downloads/downloads.module';
import { MediaSourcesModule } from './media-sources/media-sources.module';
import { ProcessJobsModule } from './process-jobs/process-jobs.module';
import { UploadsModule } from './uploads/uploads.module';
import { MediaRootsModule } from './media-roots/media-roots.module';
import { MediaServerModule } from './media-server/media-server.module';
import { MediaModule } from './media/media.module';
import { ShowsModule } from './shows/shows.module';
import { EpisodesModule } from './episodes/episodes.module';
import { LanguagesModule } from './languages/languages.module';
import { SeasonsModule } from './seasons/seasons.module';
import { FfprobeLogsModule } from './ffprobe-logs/ffprobe-logs.module';
import { PreferencesModule } from './preferences/preferences.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { EnvironmentModule } from './environment/environment.module';
import { CalendarModule } from './calendar/calendar.module';
import { formatGraphQLError } from './i18n/graphql-error.formatter';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile:
        process.env.NODE_ENV === 'production' ? true : join(process.cwd(), 'src/schema.gql'),
      context: ({ req, res }) => ({ req, res }),
      playground: process.env.NODE_ENV !== 'production',
      introspection: process.env.NODE_ENV !== 'production',
      // Spec 018, REQ-7
      formatError: formatGraphQLError,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    MoviesModule,
    IndexerModule,
    MediaRootsModule,
    SettingsModule,
    DownloadsModule,
    MediaSourcesModule,
    ProcessJobsModule,
    UploadsModule,
    MediaServerModule,
    MediaModule,
    ShowsModule,
    EpisodesModule,
    LanguagesModule,
    SeasonsModule,
    FfprobeLogsModule,
    PreferencesModule,
    SchedulerModule,
    EnvironmentModule,
    CalendarModule,
  ],
  providers: [AppResolver, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}