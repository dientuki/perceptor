import { Module } from '@nestjs/common';

import { LanguagesModule } from '@/languages/languages.module';
import { UsersModule } from '@/users/users.module';

import { PreferencesResolver } from './preferences.resolver';
import { PreferencesService } from './preferences.service';

// PrismaService is provided by the global PrismaModule — no explicit import
// needed, matching the neighbouring domain modules.
@Module({
  imports: [LanguagesModule, UsersModule],
  providers: [PreferencesResolver, PreferencesService],
})
export class PreferencesModule {}
