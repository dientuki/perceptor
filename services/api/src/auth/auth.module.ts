import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RedisModule } from '../redis/redis.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionService } from './session.service';
import { getJwtSecret } from './auth.constants';
import { LanguagesModule } from '@/languages/languages.module';

@Module({
  imports: [
    PassportModule,
    RedisModule,
    // AuthResolver's User.preferredLanguages field resolver reads
    // LanguagesService directly (011-av1-transcode).
    LanguagesModule,
    // No signOptions here on purpose: every TTL (session, remember-me,
    // upload ticket) is decided at the call site now, never inherited from
    // the module — see auth.constants.ts.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: getJwtSecret() }),
    }),
  ],
  providers: [AuthService, AuthResolver, JwtStrategy, SessionService],
  // SessionService is exported so UsersModule can revoke a disabled user's
  // live sessions (004-user-disable REQ-3) without a second Redis wrapper.
  exports: [JwtModule, SessionService],
})
export class AuthModule {}