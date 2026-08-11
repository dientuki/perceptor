import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { User } from './entities/user.entity';

// This suite exists because otherwise the deletion safeguards (REQ-5) fail
// silently: without them, a user can delete their own account or the last
// administrator, and the app is locked with no error anywhere — the exact
// failure mode this feature was written to close. It also covers the
// password-hashing bug fix in update(): without it, updating a user's
// password would silently write plaintext to the database.
//
// The `update` describe block also covers `004-user-disable`'s two safeguards
// (self-disable, last-*enabled*-admin) and the session revocation that makes
// REQ-3 real — a disable that silently fails to revoke the live session is
// exactly the Article IX failure NFR-3 names: nothing errors anywhere, and
// the administrator believes the user is locked out when they are not.
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
  let sessionService: { revokeAllForUser: jest.Mock };

  const admin: User = {
    id: 'admin-id',
    username: 'admin',
    name: 'Admin',
    isAdmin: true,
    isEnabled: true,
  } as User;

  const other: User = {
    id: 'other-id',
    username: 'other',
    name: 'Other',
    isAdmin: false,
    isEnabled: true,
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
    sessionService = {
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionService, useValue: sessionService },
      ],
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

      await service.update(other.id, { id: other.id, password: 'newpassword' }, admin.id);

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(writtenData.password).not.toBe('newpassword');
      expect(await bcrypt.compare('newpassword', writtenData.password)).toBe(true);
    });

    it('leaves other fields untouched when no password is given', async () => {
      prisma.user.update.mockResolvedValue(other);

      await service.update(other.id, { id: other.id, name: 'New Name' }, admin.id);

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(writtenData).toEqual({ name: 'New Name' });
    });

    it('refuses to disable your own account, before touching the database', async () => {
      await expect(
        service.update(admin.id, { id: admin.id, isEnabled: false }, admin.id),
      ).rejects.toThrow(new BadRequestException('No podés deshabilitar tu propio usuario'));
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses to disable the last enabled administrator, even with a disabled admin also present', async () => {
      // AC-7 shape: a second administrator exists but is already disabled.
      // A naive count({ isAdmin: true }) would see 2 and let this through,
      // leaving zero enabled admins with no way back in short of
      // bin/reset-password.
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.update(admin.id, { id: admin.id, isEnabled: false }, other.id),
      ).rejects.toThrow(new BadRequestException('No podés deshabilitar al único administrador'));
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { isAdmin: true, isEnabled: true },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('checks self-disable before the last-admin check (AC-7 message priority)', async () => {
      await expect(
        service.update(admin.id, { id: admin.id, isEnabled: false }, admin.id),
      ).rejects.toThrow(new BadRequestException('No podés deshabilitar tu propio usuario'));
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('disables an ordinary user and revokes every session they hold', async () => {
      prisma.user.findUnique.mockResolvedValue(other);
      prisma.user.update.mockResolvedValue({ ...other, isEnabled: false });

      await service.update(other.id, { id: other.id, isEnabled: false }, admin.id);

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: other.id },
        data: { isEnabled: false },
      });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(other.id);
    });

    it('allows disabling an administrator when another enabled administrator remains', async () => {
      const secondAdmin: User = { ...admin, id: 'second-admin-id' };
      prisma.user.findUnique.mockResolvedValue(secondAdmin);
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ ...secondAdmin, isEnabled: false });

      await service.update(secondAdmin.id, { id: secondAdmin.id, isEnabled: false }, admin.id);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: secondAdmin.id },
        data: { isEnabled: false },
      });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(secondAdmin.id);
    });

    it('re-enabling a user runs none of the disable checks and revokes nothing', async () => {
      prisma.user.update.mockResolvedValue({ ...other, isEnabled: true });

      await service.update(other.id, { id: other.id, isEnabled: true }, admin.id);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('an update that never mentions isEnabled runs none of the disable checks and revokes nothing', async () => {
      prisma.user.update.mockResolvedValue(other);

      await service.update(other.id, { id: other.id, name: 'New Name' }, admin.id);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
