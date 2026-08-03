import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // 1. Validar email y password contra MariaDB
  async validateUser(email: string, pass: string) {
    // Buscar usuario en la base de datos
    const user = await this.prisma.users.findUnique({
      where: { email },
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

  // 2. Generar el JWT
  async login(email: string, pass: string) {
    const user = await this.validateUser(email, pass);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Payload con sub (ID de usuario) y email
    const payload = { email: user.email, sub: user.id };

    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }
}