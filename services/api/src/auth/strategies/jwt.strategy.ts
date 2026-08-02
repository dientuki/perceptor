import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Extrae la cookie "token" que configuramos en el login
      jwtFromRequest: (req: Request) => req?.cookies?.token || null,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secreto-perceptor',
    });
  }

  async validate(payload: any) {
    // Esto se inyecta en req.user
    return { id: payload.sub, username: payload.username };
  }
}