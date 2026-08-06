import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { AppResolver } from './app.resolver'; // Lo creamos en el paso 2
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { MoviesModule } from './movies/movies.module';
import { IndexerModule } from './indexer/indexer.module';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Genera el archivo schema.gql automáticamente en la raíz
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
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
  ],
  providers: [AppResolver],
})
export class AppModule {}