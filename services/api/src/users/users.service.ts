import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Ajustá la ruta según tu estructura
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserInput: CreateUserInput): Promise<User> {
    const { email, password, name } = createUserInput;

    // 1. Verificar si el email ya existe
    const existingUser = await this.prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    // 2. Hash de la contraseña (10 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Crear el usuario en MariaDB
    return await this.prisma.users.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
    });
  }

  async findAll(): Promise<User[]> {
    return await this.prisma.users.findMany();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado`);
    }

    return user;
  }

  async update(id: string, updateUserInput: UpdateUserInput): Promise<User> {
    // Si tu UpdateUserInput trae el 'id' adentro, lo separamos
    // para no intentarlo actualizar en la BD.
    const { id: _, ...dataToUpdate } = updateUserInput;

    try {
      return await this.prisma.users.update({
        where: { id },
        data: dataToUpdate,
      });
    } catch {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado`);
    }
  }

  async remove(id: string): Promise<User> {
    try {
      return await this.prisma.users.delete({
        where: { id },
      });
    } catch {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado`);
    }
  }
}