import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { SessionService } from './session.service';
import { SESSION_TTL, REMEMBER_ME_TTL, ttlToSeconds } from './auth.constants';
import type { UserJwtPayload } from './auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  async validateUser(username: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(pass, user.password);

    if (isPasswordValid) {
      const { password, ...result } = user;
      return result;
    }

    return null;
  }

  async login(username: string, pass: string, rememberMe: boolean) {
    const user = await this.validateUser(username, pass);

    if (!user) {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_INVALID_CREDENTIALS);
    }

    // Spec 004, REQ-2
    if (!user.isEnabled) {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_ACCOUNT_DISABLED);
    }

    const ttlSeconds = ttlToSeconds(rememberMe ? REMEMBER_ME_TTL : SESSION_TTL);
    const jti = await this.sessionService.create(user.id, ttlSeconds);

    const payload: UserJwtPayload = {
      sub: user.id,
      username: user.username,
      jti,
    };

    return {
      access_token: this.jwtService.sign(payload, { expiresIn: ttlSeconds }),
      user,
    };
  }

  // Spec 002, AC-5
  async logout(jti: string): Promise<void> {
    await this.sessionService.revoke(jti);
  }

  // Spec 018, REQ-14
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    }
    const { password, ...result } = user;
    return result;
  }
}
