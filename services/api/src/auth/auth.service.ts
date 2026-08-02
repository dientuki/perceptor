import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// Usuario hardcodeado como en la docu oficial pero sin DB
const HARDCODED_USER = {
  id: 'usr_123',
  username: 'admin',
  pass: 'admin123',
};

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  // 1. Validar usuario/password (El "validateUser" que menciona Nest Docs)
  async validateUser(username: string, pass: string) {
    if (username === HARDCODED_USER.username && pass === HARDCODED_USER.pass) {
      const { pass, ...result } = HARDCODED_USER;
      return result;
    }
    return null;
  }

  // 2. Generar el JWT
  async login(user: any) {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }
}