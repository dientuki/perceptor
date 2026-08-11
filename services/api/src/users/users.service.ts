import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async create(createUserInput: CreateUserInput): Promise<User> {
    const { username, password, name } = createUserInput;

    // 1. Verificar si el username ya existe
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('El nombre de usuario ya está registrado');
    }

    // 2. Hash de la contraseña (10 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Crear el usuario en MariaDB
    return await this.prisma.user.create({
      data: {
        username,
        name,
        password: hashedPassword,
      },
    });
  }

  async findAll(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado`);
    }

    return user;
  }

  async update(id: string, updateUserInput: UpdateUserInput, requesterId: string): Promise<User> {
    // Si tu UpdateUserInput trae el 'id' adentro, lo separamos
    // para no intentarlo actualizar en la BD.
    const { id: _, ...dataToUpdate } = updateUserInput;

    // Only an actual disable (isEnabled === false, not undefined/true) runs
    // the REQ-5 safeguards — same ordering remove() uses: self-check first,
    // then the last-*enabled*-admin check, so a lone admin disabling
    // themself sees the "your own account" message, not the "last admin"
    // one.
    const isDisabling = dataToUpdate.isEnabled === false;
    if (isDisabling) {
      if (id === requesterId) {
        throw new BadRequestException('No podés deshabilitar tu propio usuario');
      }

      const target = await this.findOne(id);
      if (target.isAdmin) {
        // Counting only *enabled* admins is the requirement, not an
        // optimisation (REQ-5): counting disabled admins would let someone
        // disable every admin but themselves one at a time and lock the app.
        const enabledAdminCount = await this.prisma.user.count({
          where: { isAdmin: true, isEnabled: true },
        });
        if (enabledAdminCount === 1) {
          throw new BadRequestException('No podés deshabilitar al único administrador');
        }
      }
    }

    // create() hashes the password before writing; update() must too, or a
    // password change lands in the database in plaintext.
    if (dataToUpdate.password) {
      dataToUpdate.password = await bcrypt.hash(dataToUpdate.password, 10);
    }

    let updated: User;
    try {
      updated = await this.prisma.user.update({
        where: { id },
        data: dataToUpdate,
      });
    } catch {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado`);
    }

    // NFR-3: a disable that doesn't also revoke the live session is a silent
    // failure — do it here, inside the same method, rather than leaving it
    // to a caller who could forget.
    if (isDisabling) {
      await this.sessionService.revokeAllForUser(id);
    }

    return updated;
  }

  async remove(id: string, requesterId: string): Promise<User> {
    // Order matters (AC-7): a lone admin deleting themself must see the
    // "your own account" message, not the "last admin" one.
    if (id === requesterId) {
      throw new BadRequestException('No podés eliminar tu propio usuario');
    }

    const target = await this.findOne(id);

    if (target.isAdmin) {
      const adminCount = await this.prisma.user.count({ where: { isAdmin: true } });
      if (adminCount === 1) {
        throw new BadRequestException('No podés eliminar al único administrador');
      }
    }

    return await this.prisma.user.delete({
      where: { id },
    });
  }
}