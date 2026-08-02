import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita el parsing de cookies entrantes
  app.use(cookieParser());
  
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
