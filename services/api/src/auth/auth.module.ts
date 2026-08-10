import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RedisModule } from '../redis/redis.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionService } from './session.service';
import { getJwtSecret } from './auth.constants';

@Module({
  imports: [
    PassportModule,
    RedisModule,
    // No signOptions here on purpose: every TTL (session, remember-me,
    // upload ticket) is decided at the call site now, never inherited from
    // the module — see auth.constants.ts.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: getJwtSecret() }),
    }),
  ],
  providers: [AuthService, AuthResolver, JwtStrategy, SessionService],
  exports: [JwtModule],
})
export class AuthModule {}