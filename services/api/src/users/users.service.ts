import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { UpdateProfileInput } from './dto/update-profile.input';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { isSupportedLocale } from '@/i18n/locales';

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
      throw i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN);
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
      throw i18nError.notFound(ERROR_KEYS.USER_NOT_FOUND, { id });
    }

    return user;
  }

  async update(id: string, updateUserInput: UpdateUserInput, requesterId: string): Promise<User> {
    // Si tu UpdateUserInput trae el 'id' adentro, lo separamos
    // para no intentarlo actualizar en la BD.
    const { id: _, ...dataToUpdate } = updateUserInput;

    // Same duplicate-username guard as updateProfile(): a row with the
    // target's own id is that user keeping their current username and must
    // pass, only a different user's row is a real collision. Skipped when
    // username is absent, or setUserEnabledAction's { id, isEnabled } payload
    // (no username) would look up an arbitrary row and match it.
    if (dataToUpdate.username !== undefined) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username: dataToUpdate.username },
      });

      if (existingUser && existingUser.id !== id) {
        throw i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN);
      }
    }

    // Only an actual disable (isEnabled === false, not undefined/true) runs
    // the REQ-5 safeguards — same ordering remove() uses: self-check first,
    // then the last-*enabled*-admin check, so a lone admin disabling
    // themself sees the "your own account" message, not the "last admin"
    // one.
    const isDisabling = dataToUpdate.isEnabled === false;
    if (isDisabling) {
      if (id === requesterId) {
        throw i18nError.badRequest(ERROR_KEYS.USER_CANNOT_DISABLE_SELF);
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
          throw i18nError.badRequest(ERROR_KEYS.USER_CANNOT_DISABLE_LAST_ADMIN);
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
      throw i18nError.notFound(ERROR_KEYS.USER_NOT_FOUND, { id });
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
      throw i18nError.badRequest(ERROR_KEYS.USER_CANNOT_DELETE_SELF);
    }

    const target = await this.findOne(id);

    if (target.isAdmin) {
      const adminCount = await this.prisma.user.count({ where: { isAdmin: true } });
      if (adminCount === 1) {
        throw i18nError.badRequest(ERROR_KEYS.USER_CANNOT_DELETE_LAST_ADMIN);
      }
    }

    return await this.prisma.user.delete({
      where: { id },
    });
  }

  // Self-service write for `020-profile-edit`'s `updateProfile` mutation: the
  // caller acting on their own row, never on `id`. Reuses the exact
  // duplicate-username check and bcrypt hash `create()`/`update()` already
  // use, but never spreads `input` into the write payload — see
  // `../../docs/spec/features/020-profile-edit/plan.md` § Risks for why a
  // future `...input` spread here would be a silent privilege-escalation
  // hole shaped like a convenience.
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const existingUser = await this.prisma.user.findUnique({
      where: { username: input.username },
    });

    // A row with the caller's own id is the caller keeping their current
    // username (a name-only edit) — that must succeed, not collide with
    // itself.
    if (existingUser && existingUser.id !== userId) {
      throw i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN);
    }

    const data: Prisma.UserUpdateInput = {
      name: input.name,
      username: input.username,
    };
    // The `password` key is only added when the input actually carries a
    // non-empty string — passing `password: undefined` would still overwrite
    // the stored hash on some Prisma versions, and an absent key is the only
    // way to guarantee the existing hash survives untouched.
    if (input.password) {
      data.password = await bcrypt.hash(input.password, 10);
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data,
      });
    } catch (error) {
      // Two concurrent saves racing on the same free username: the check
      // above passed for both, and the database's unique constraint is what
      // actually catches the second one. Rethrow as the same conflict rather
      // than letting a raw Prisma error reach the browser.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN);
      }
      throw error;
    }
  }

  // Validate-then-write, same shape as `LanguagesService`'s preference
  // writes: nothing is persisted until the locale is confirmed to be one
  // `web` actually ships a catalog for (REQ-19). An unsupported locale must
  // leave the previous value untouched — AC-6 checks that explicitly, so the
  // rejection has to happen before any `prisma.user.update` call, not after.
  async setUiLocale(userId: string, locale: string): Promise<User> {
    if (!isSupportedLocale(locale)) {
      throw i18nError.badRequest(ERROR_KEYS.USER_UNSUPPORTED_LOCALE, { locale });
    }

    return await this.prisma.user.update({
      where: { id: userId },
      data: { uiLocale: locale },
    });
  }

  // Same shape as setUiLocale: a single-field self-service write, no
  // validation to perform beyond the boolean's own type, so no early throw
  // is needed before the update.
  async setAllowCinemaReleases(userId: string, allowed: boolean): Promise<User> {
    return await this.prisma.user.update({
      where: { id: userId },
      data: { allowCinemaReleases: allowed },
    });
  }

  // Twin of setAllowCinemaReleases — the general per-user *Audio mandatory*
  // flag (039-per-title-language-split REQ-9). Inert this cycle: nothing
  // reads it yet (REQ-11).
  async setAudioMandatory(userId: string, mandatory: boolean): Promise<User> {
    return await this.prisma.user.update({
      where: { id: userId },
      data: { audioMandatory: mandatory },
    });
  }
}