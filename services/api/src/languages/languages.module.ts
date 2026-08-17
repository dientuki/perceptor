import { Module } from '@nestjs/common';
import { LanguagesService } from './languages.service';
import { LanguagesResolver } from './languages.resolver';

// PrismaService is provided by the global PrismaModule (prisma/prisma.module.ts)
// — no explicit import needed, matching the neighbouring domain modules.
@Module({
  providers: [LanguagesResolver, LanguagesService],
  exports: [LanguagesService],
})
export class LanguagesModule {}
