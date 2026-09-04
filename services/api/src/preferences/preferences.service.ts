import { Injectable } from '@nestjs/common';
import { Prisma, TorrentGroupScope as PrismaTorrentGroupScope } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { LanguagesService } from '@/languages/languages.service';
import { UsersService } from '@/users/users.service';

import { TorrentGroup } from './entities/torrent-group.entity';
import { TorrentGroupScope } from './entities/torrent-group-scope.enum';
import { UserPreferences } from './entities/user-preferences.entity';

// The caller's own preferences, read in one shape (`findForUser`) and
// written through three narrow paths: two of them (the language kinds, the
// cinema flag) delegate to the services that already own that table.
// `setPreferredTorrentGroupsFor` is the one write this service owns
// directly, because `user_torrent_groups` carries no `scope` column of its
// own — the scope lives on `torrent_groups`, so narrowing the replace to
// "this user, this scope" means joining through it rather than filtering a
// plain `where`. Validate the whole `ids` list against that join *before*
// touching the database, same shape `LanguagesService`'s writes take: a
// rejected write must never leave the user with half their old selection
// gone and none of the new one written.
@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languagesService: LanguagesService,
    private readonly usersService: UsersService,
  ) {}

  async findForUser(userId: string): Promise<UserPreferences> {
    const [user, audioLanguages, subtitleLanguages, movieTorrentGroups, showTorrentGroups] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        this.languagesService.findPreferredTrackLanguagesFor(userId, 'AUDIO'),
        this.languagesService.findPreferredTrackLanguagesFor(userId, 'SUBTITLE'),
        this.findSelectedTorrentGroupsFor(userId, TorrentGroupScope.MOVIE),
        this.findSelectedTorrentGroupsFor(userId, TorrentGroupScope.SHOW),
      ]);

    return {
      allowCinemaReleases: user.allowCinemaReleases,
      audioMandatory: user.audioMandatory,
      audioLanguages,
      subtitleLanguages,
      movieTorrentGroups,
      showTorrentGroups,
    };
  }

  async findCatalog(): Promise<TorrentGroup[]> {
    const rows = await this.prisma.torrentGroup.findMany({
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toTorrentGroup(row));
  }

  // Validate-then-write: the trimmed, case-insensitive lookup rejects the
  // common case with a translated message before touching the database, but
  // it is not the only authority — MariaDB's default collation makes the
  // `name` unique index case-insensitive too, so two concurrent creates of
  // "FLUX" and "flux" can both pass the lookup and race on the insert. The
  // catch below turns that race's raw P2002 into the same translated error
  // rather than letting it reach the user untranslated.
  async createTorrentGroup(name: string): Promise<TorrentGroup> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw i18nError.badRequest(ERROR_KEYS.VALIDATION_TORRENT_GROUP_NAME_REQUIRED);
    }

    // MariaDB's default collation is already case-insensitive, so a plain
    // `equals` lookup here matches "FLUX" against a stored "flux" without
    // needing Prisma's `mode: 'insensitive'` — which the mysql provider
    // does not support in the first place.
    const existing = await this.prisma.torrentGroup.findFirst({
      where: { name: trimmed },
    });
    if (existing !== null) {
      throw i18nError.badRequest(ERROR_KEYS.TORRENT_GROUP_NAME_TAKEN, { name: trimmed });
    }

    try {
      const row = await this.prisma.torrentGroup.create({ data: { name: trimmed } });
      return this.toTorrentGroup(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw i18nError.badRequest(ERROR_KEYS.TORRENT_GROUP_NAME_TAKEN, { name: trimmed });
      }
      throw error;
    }
  }

  async deleteTorrentGroup(id: number): Promise<boolean> {
    const row = await this.prisma.torrentGroup.findUnique({ where: { id } });
    if (row === null) {
      throw i18nError.notFound(ERROR_KEYS.TORRENT_GROUP_NOT_FOUND, { id });
    }

    // `onDelete: Cascade` on UserTorrentGroup.torrentGroup already removes
    // every user's selection of this group — no manual cleanup here.
    await this.prisma.torrentGroup.delete({ where: { id } });
    return true;
  }

  async setAllowCinemaReleases(userId: string, allowed: boolean): Promise<UserPreferences> {
    await this.usersService.setAllowCinemaReleases(userId, allowed);
    return this.findForUser(userId);
  }

  async setAudioMandatory(userId: string, mandatory: boolean): Promise<UserPreferences> {
    await this.usersService.setAudioMandatory(userId, mandatory);
    return this.findForUser(userId);
  }

  // Replaces the caller's selection for one scope; [] clears it. The
  // sibling scope's rows are untouched — the `deleteMany` below is narrowed
  // to `{ userId }` **and** a subquery of the ids that belong to `scope`,
  // never `{ userId }` alone, which would wipe both scopes at once with no
  // error anywhere.
  async setPreferredTorrentGroupsFor(
    userId: string,
    scope: TorrentGroupScope,
    ids: number[],
  ): Promise<TorrentGroup[]> {
    const seen = new Set<number>();
    for (const id of ids) {
      if (seen.has(id)) {
        throw i18nError.badRequest(ERROR_KEYS.TORRENT_GROUP_DUPLICATED, { id });
      }
      seen.add(id);
    }

    const prismaScope = this.toPrismaScope(scope);
    const rows =
      ids.length > 0
        ? await this.prisma.torrentGroup.findMany({ where: { id: { in: ids } } })
        : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of ids) {
      if (byId.get(id) === undefined) {
        throw i18nError.badRequest(ERROR_KEYS.TORRENT_GROUP_NOT_FOUND, { id });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userTorrentGroup.deleteMany({
        where: { userId, scope: prismaScope },
      });
      if (ids.length > 0) {
        await tx.userTorrentGroup.createMany({
          data: ids.map((torrentGroupId) => ({ userId, torrentGroupId, scope: prismaScope })),
        });
      }
    });

    return this.findSelectedTorrentGroupsFor(userId, scope);
  }

  private async findSelectedTorrentGroupsFor(
    userId: string,
    scope?: TorrentGroupScope,
  ): Promise<TorrentGroup[]> {
    const rows = await this.prisma.userTorrentGroup.findMany({
      where: {
        userId,
        scope: scope !== undefined ? this.toPrismaScope(scope) : undefined,
      },
      include: { torrentGroup: true },
    });
    return rows.map((row) => this.toTorrentGroup(row.torrentGroup));
  }

  // GraphQL's `TorrentGroupScope` (registered via `registerEnumType`) and
  // Prisma's own enum of the same name are structurally identical but
  // nominally distinct types to TypeScript — both cross here rather than
  // being unified, since the GraphQL entity module has no reason to depend
  // on `@prisma/client`.
  private toPrismaScope(scope: TorrentGroupScope): PrismaTorrentGroupScope {
    return scope as unknown as PrismaTorrentGroupScope;
  }

  private toTorrentGroup(row: { id: number; name: string }): TorrentGroup {
    return { id: row.id, name: row.name };
  }
}
