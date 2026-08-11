import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { assertAuthEnv } from './auth/auth.constants';

// /uploads (ver src/uploads/) recibe el body crudo de tus, potencialmente de
// varios GB por request: no puede pasar por el body parser global. bodyParser:
// false lo desactiva del todo y acá se lo aplica a mano al resto de las rutas.
function skipUploads(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/uploads')) return next();
    return middleware(req, res, next);
  };
}

async function bootstrap() {
  // First statement, on purpose: a missing JWT_SECRET must fail loudly at
  // boot (AC-8), before anything else — including the health check — can
  // make it look like the api started successfully without one (REQ-6).
  assertAuthEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(skipUploads(json()));
  app.use(skipUploads(urlencoded({ extended: true })));

  // Igual que el worker (ver services/worker/src/index.ts): sin esto, lo que
  // escribe la api (el archivo subido por /uploads) queda 644/root y el worker
  // no lo puede leer.
  process.umask(0o002);

  // Habilita el parsing de cookies entrantes
  app.use(cookieParser());

  // Habilita la validación automática de los DTOs. Nest's default
  // exceptionFactory throws BadRequestException(errors) with the raw
  // ValidationError[] as the message — Apollo then serializes that array as
  // the generic "Bad Request Exception" string at errors[0].message, burying
  // the real class-validator message under
  // errors[0].extensions.originalError.message[0]. Every consumer in
  // services/web/src/actions/*.ts reads errors[0].message directly, so this
  // exceptionFactory throws a plain string instead, matching how every other
  // BadRequestException in this codebase is constructed (users.service.ts,
  // media-roots.service.ts, settings.service.ts). None of this app's DTOs use
  // @ValidateNested, so the first top-level error's first constraint is
  // always the whole story — no children to walk.
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const firstError = errors[0];
      const firstMessage = firstError?.constraints
        ? Object.values(firstError.constraints)[0]
        : 'Validation failed';
      return new BadRequestException(firstMessage);
    },
  }));

  // El browser sube archivos a /uploads directo contra la api (ver
  // src/uploads/): no pasa por INTERNAL_GRAPHQL_URL ni por web, así que
  // necesita CORS. exposedHeaders es lo que le permite a tus-js-client leer
  // Upload-Offset/Location y poder reanudar una subida cortada.
  app.enableCors({
    origin: [`http://${process.env.DOMAIN}`, `http://localhost:${process.env.WEB_PORT}`],
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
