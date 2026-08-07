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

  // 2. Generar el JWT
  async login(username: string, pass: string) {
    const user = await this.validateUser(username, pass);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Payload con sub (ID de usuario) y username
    const payload = { username: user.username, sub: user.id };

    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }
}