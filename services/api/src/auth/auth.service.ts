import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { SessionService } from './session.service';
import { SESSION_TTL, REMEMBER_ME_TTL, ttlToSeconds } from './auth.constants';
import type { UserJwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  // 1. Validar username y password contra MariaDB
  async validateUser(username: string, pass: string) {
    // Buscar usuario en la base de datos
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return null;
    }

    // Comparar la contraseña ingresada con el hash guardado
    const isPasswordValid = await bcrypt.compare(pass, user.password);

    if (isPasswordValid) {
      // Excluimos el password antes de retornar el usuario
      const { password, ...result } = user;
      return result;
    }

    return null;
  }

  // 2. Generar el JWT. La sesión (jti) se registra en Redis antes de firmar
  // el token para que TTL de la cookie, TTL del JWT y TTL del registro de
  // sesión sean siempre el mismo número (REQ-8).
  async login(username: string, pass: string, rememberMe: boolean) {
    const user = await this.validateUser(username, pass);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // A disabled user must not get a session, even with the correct password
    // (004-user-disable REQ-2) — this has to run before sessionService.create()
    // so a refused login never leaves a session record behind.
    if (!user.isEnabled) {
      throw new UnauthorizedException('Tu cuenta está deshabilitada');
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

  // Revoca el registro de sesión del caller — sin esto, un JWT firmado
  // correctamente seguiría autenticando hasta su expiración natural pese al
  // logout (AC-5).
  async logout(jti: string): Promise<void> {
    await this.sessionService.revoke(jti);
  }

  // `me` necesita una lectura a la DB (no alcanza con lo que ya trae el
  // payload del JWT): es la única forma de detectar un usuario borrado
  // después de que el token fue emitido.
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('No autenticado');
    }
    const { password, ...result } = user;
    return result;
  }
}
