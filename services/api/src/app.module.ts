import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { AppResolver } from './app.resolver'; // Lo creamos en el paso 2

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Genera el archivo schema.gql automáticamente en la raíz
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      // Muestra el Sandbox/Playground de Apollo solo si NO estás en prod
      playground: process.env.NODE_ENV !== 'production',
      // Desactiva la intro en producción por seguridad
      introspection: process.env.NODE_ENV !== 'production',
    }),
  ],
  providers: [AppResolver],
})
export class AppModule {}