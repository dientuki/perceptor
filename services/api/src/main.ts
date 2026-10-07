import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { assertAuthEnv } from './auth/auth.constants';
import { MESSAGES_EN } from '@/i18n/messages.en';
import type { ErrorKey } from '@/i18n/error-keys';
import { runMigrations } from './bootstrap/run-migrations';
import { seedProduction } from './database/seed/production-seed';
import { PrismaService } from './prisma/prisma.service';
import { recomputeAllStatuses } from '../scripts/recompute-statuses';

function skipUploads(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/uploads')) return next();
    return middleware(req, res, next);
  };
}

async function bootstrap() {
  // Spec 002, AC-8; Spec 002, REQ-6
  assertAuthEnv();

  if (process.env.PERCEPTOR_AUTO_MIGRATE !== 'false') {
    try {
      await runMigrations();
      const prisma = new PrismaService();
      await prisma.$connect();
      try {
        await seedProduction(prisma);
        // Spec 089, NFR-3
        await recomputeAllStatuses(prisma);
      } finally {
        await prisma.$disconnect();
      }
    } catch (err) {
      console.error('[bootstrap] Failed to migrate/seed the database:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(skipUploads(json({ limit: '2mb' })));
  app.use(skipUploads(urlencoded({ extended: true, limit: '2mb' })));

  process.umask(0o002);

  app.use(cookieParser());

  // Spec 018, REQ-9
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const firstError = errors[0];
      const firstMessage = firstError?.constraints
        ? Object.values(firstError.constraints)[0]
        : 'Validation failed';
      const englishMessage = MESSAGES_EN[firstMessage];
      if (englishMessage !== undefined) {
        return new BadRequestException({
          message: englishMessage,
          i18n: { key: firstMessage as ErrorKey },
        });
      }
      return new BadRequestException(firstMessage);
    },
  }));

  app.enableCors({
    origin: [
      `http://${process.env.DOMAIN}`,
      `https://${process.env.DOMAIN}`,
      `http://localhost:${process.env.WEB_PORT}`],
    credentials: true,
    exposedHeaders: [
      'Upload-Offset',
      'Location',
      'Upload-Length',
      'Tus-Version',
      'Tus-Resumable',
      'Tus-Max-Size',
      'Tus-Extension',
      'Upload-Metadata',
    ],
    maxAge: 86400,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
