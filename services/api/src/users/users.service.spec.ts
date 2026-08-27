import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
// `028-users-screen-refactor` added the duplicate-username guard: without
// it, renaming a user onto another user's username reaches Prisma's unique
// constraint and surfaces as `error.user.not_found`, a misleading message
// for a conflict that has nothing to do with a missing row.
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
        new BadRequestException('You cannot delete your own user'),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete the last administrator', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.count.mockResolvedValue(1);

      await expect(service.remove(admin.id, other.id)).rejects.toThrow(
        new BadRequestException('You cannot delete the only administrator'),
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
        new BadRequestException('You cannot delete your own user'),
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
      ).rejects.toThrow(new BadRequestException('You cannot disable your own user'));
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
      ).rejects.toThrow(new BadRequestException('You cannot disable the only administrator'));
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { isAdmin: true, isEnabled: true },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('checks self-disable before the last-admin check (AC-7 message priority)', async () => {
      await expect(
        service.update(admin.id, { id: admin.id, isEnabled: false }, admin.id),
      ).rejects.toThrow(new BadRequestException('You cannot disable your own user'));
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

    it('refuses to rename a user onto a username another user already holds', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);

      await expect(
        service.update(other.id, { id: other.id, username: admin.username }, admin.id),
      ).rejects.toThrow(new ConflictException('That username is already registered'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows an update whose username matches the target\'s own current username', async () => {
      prisma.user.findUnique.mockResolvedValue(other);
      prisma.user.update.mockResolvedValue(other);

      await service.update(other.id, { id: other.id, username: other.username }, admin.id);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: other.id },
        data: { username: other.username },
      });
    });
  });

  // This suite exists because otherwise `updateProfile` fails silently in
  // three different ways (`020-profile-edit` plan.md § Risks): a future
  // `...input` spread lets a caller escalate `isAdmin`/`isEnabled` with a
  // normal-looking success; an omitted hash call writes a login-breaking
  // plaintext password; and an unexcluded self-collision on the uniqueness
  // check rejects a name-only edit forever with a confusing message.
  describe('updateProfile', () => {
    it('writes only name, username and password — never a spread of the input', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(other);

      await service.updateProfile(other.id, {
        name: 'New Name',
        username: 'newusername',
        password: 'newpassword',
      });

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(Object.keys(writtenData).sort()).toEqual(['name', 'password', 'username']);
    });

    it('hashes the password instead of writing it in plaintext', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(other);

      await service.updateProfile(other.id, {
        name: other.name,
        username: other.username,
        password: 'newpassword',
      });

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect(writtenData.password).not.toBe('newpassword');
      expect(await bcrypt.compare('newpassword', writtenData.password as string)).toBe(true);
    });

    it('omits password from the update payload entirely when none is given', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(other);

      await service.updateProfile(other.id, { name: 'New Name', username: other.username });

      const writtenData = prisma.user.update.mock.calls[0][0].data;
      expect('password' in writtenData).toBe(false);
    });

    it('accepts the caller keeping their own current username', async () => {
      prisma.user.findUnique.mockResolvedValue(other);
      prisma.user.update.mockResolvedValue(other);

      await expect(
        service.updateProfile(other.id, { name: 'New Name', username: other.username }),
      ).resolves.toEqual(other);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: other.id },
        data: { name: 'New Name', username: other.username },
      });
    });

    it('rejects a username belonging to someone else', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);

      await expect(
        service.updateProfile(other.id, { name: other.name, username: admin.username }),
      ).rejects.toThrow(new ConflictException('That username is already registered'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  // AC-6: a rejected locale must not be indistinguishable, at render time,
  // from a bug in the resolver — `web` never ships a catalog for a locale
  // that isn't in SUPPORTED_LOCALES, so the write must be refused before it
  // ever reaches the database, and the previous value must be provably
  // untouched afterwards.
  describe('setUiLocale', () => {
    it('stores an accepted locale', async () => {
      prisma.user.update.mockResolvedValue({ ...other, uiLocale: 'es' });

      const result = await service.setUiLocale(other.id, 'es');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: other.id },
        data: { uiLocale: 'es' },
      });
      expect(result.uiLocale).toBe('es');
    });

    it('refuses an unsupported locale before writing anything, and leaves the previous value unchanged', async () => {
      await expect(service.setUiLocale(other.id, 'kl')).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
