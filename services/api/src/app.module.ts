import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { AppResolver } from './app.resolver'; // Lo creamos en el paso 2
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

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Genera el archivo schema.gql automáticamente en la raíz
      // In production the runner image has no `src/` (only `dist`, `prisma`, `node_modules` and
      // `package*.json` are copied), so the schema is built in memory instead of written to disk.
      autoSchemaFile:
        process.env.NODE_ENV === 'production' ? true : join(process.cwd(), 'src/schema.gql'),
      // Pasa el request y response de Express al contexto de GraphQL
      context: ({ req, res }) => ({ req, res }),
      // Muestra el Sandbox/Playground de Apollo solo si NO estás en prod
      playground: process.env.NODE_ENV !== 'production',
      // Desactiva la intro en producción por seguridad
      introspection: process.env.NODE_ENV !== 'production',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    MoviesModule, // Asegúrate de importar el módulo de películas
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
  ],
  providers: [AppResolver, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}