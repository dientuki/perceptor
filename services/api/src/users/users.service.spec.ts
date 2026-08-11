import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { User } from './entities/user.entity';

// This suite exists because otherwise the deletion safeguards (REQ-5) fail
// silently: without them, a user can delete their own account or the last
// administrator, and the app is locked with no error anywhere — the exact
// failure mode this feature was written to close. It also covers the
// password-hashing bug fix in update(): without it, updating a user's
// password would silently write plaintext to the database.
describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };

  const admin: User = {
    id: 'admin-id',
    username: 'admin',
    name: 'Admin',
    isAdmin: true,
  } as User;

  const other: User = {
    id: 'other-id',
    username: 'other',
    name: 'Other',
    isAdmin: false,
  } as User;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('remove', () => {
    it('refuses to delete your own account, before touching the database', async () => {
      await expect(service.remove(admin.id, admin.id)).rejects.toThrow(
        new BadRequestException('No podés eliminar tu propio usuario'),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete the last administrator', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.count.mockResolvedValue(1);

      await expect(service.remove(admin.id, other.id)).rejects.toThrow(
        new BadRequestException('No podés eliminar al único administrador'),
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('allows deleting an administrator when another administrator remains', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.count.mockResolvedValue(2);
      prisma.user.delete.mockResolvedValue(admin);

      await service.remove(admin.id, other.id);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: admin.id } });
    });

    it('allows deleting a non-administrator without checking the admin count', async () => {
      prisma.user.findUnique.mockResolvedValue(other);
      prisma.user.delete.mockResolvedValue(other);

      await service.remove(other.id, admin.id);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: other.id } });
    });

    it('raises NotFoundException for a target id that does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id', other.id)).rejects.toThrow(NotFoundException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('checks self-deletion before the last-admin check (AC-7 message priority)', async () => {
      // A lone administrator deleting themselves must see "your own
      // account", not "last administrator" — both conditions are true at
      // once, and only the order of checks decides which message wins.
      await expect(service.remove(admin.id, admin.id)).rejects.toThrow(
        new BadRequestException('No podés eliminar tu propio usuario'),
      );
      expect(prisma.user.count).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('hashes a new password instead of writing it in plaintext', async () => {
      prisma.user.update.mockResolvedValue(other);

      await service.update(other.id, { id: other.id, password: 'newpassword' });

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(writtenData.password).not.toBe('newpassword');
      expect(await bcrypt.compare('newpassword', writtenData.password)).toBe(true);
    });

    it('leaves other fields untouched when no password is given', async () => {
      prisma.user.update.mockResolvedValue(other);

      await service.update(other.id, { id: other.id, name: 'New Name' });

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(writtenData).toEqual({ name: 'New Name' });
    });
  });
});
