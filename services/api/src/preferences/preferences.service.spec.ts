import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PreferencesService } from './preferences.service';
import { TorrentGroupScope } from './entities/torrent-group-scope.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { LanguagesService } from '@/languages/languages.service';
import { UsersService } from '@/users/users.service';

// setPreferredTorrentGroupsFor replaces a caller's selection for one scope by
// deleting the old rows and inserting the new ones. If that delete is keyed on
// `{ userId }` alone — dropping the join through `torrent_groups` that narrows
// it to the scope being written, or dropping `userId` itself — a save silently
// wipes the sibling scope's rows, or another user's rows, with no exception,
// no failed assertion in `web`, and no trace in the logs: the mutation reports
// the correct list for the scope it wrote while the database quietly loses
// data nobody asked to touch. This suite runs against an in-memory fake of
// `torrent_groups`/`user_torrent_groups` that actually applies the `where`
// clause the service passes, rather than a mock that only records call
// arguments, so a wrongly-scoped `where` produces the wrong stored rows here
// exactly as it would in MariaDB.
describe('PreferencesService — setPreferredTorrentGroupsFor', () => {
  type CatalogRow = { id: number; name: string };
  type SelectionRow = { userId: string; torrentGroupId: number; scope: 'MOVIE' | 'SHOW' };
  type Where = {
    userId?: string;
    id?: { in: number[] };
    scope?: 'MOVIE' | 'SHOW';
  };

  const movieA: CatalogRow = { id: 1, name: 'movie-a' };
  const movieB: CatalogRow = { id: 2, name: 'movie-b' };
  const showC: CatalogRow = { id: 3, name: 'show-c' };
  const showD: CatalogRow = { id: 4, name: 'show-d' };

  let catalog: CatalogRow[];
  let selections: SelectionRow[];
  let deleteManyMock: jest.Mock;
  let createManyMock: jest.Mock;
  let transactionMock: jest.Mock;
  let service: PreferencesService;

  function matchesWhere(row: SelectionRow, where: Where): boolean {
    if (where.userId !== undefined && row.userId !== where.userId) {
      return false;
    }
    if (where.scope !== undefined && row.scope !== where.scope) {
      return false;
    }
    return true;
  }

  function selectionsOf(userId: string): SelectionRow[] {
    return selections.filter((row) => row.userId === userId);
  }

  beforeEach(async () => {
    catalog = [movieA, movieB, showC, showD];
    selections = [
      { userId: 'user-1', torrentGroupId: movieA.id, scope: 'MOVIE' },
      { userId: 'user-1', torrentGroupId: showC.id, scope: 'SHOW' },
      { userId: 'user-2', torrentGroupId: movieA.id, scope: 'MOVIE' },
      { userId: 'user-2', torrentGroupId: showC.id, scope: 'SHOW' },
    ];

    deleteManyMock = jest.fn(async ({ where }: { where: Where }) => {
      selections = selections.filter((row) => !matchesWhere(row, where));
    });
    createManyMock = jest.fn(async ({ data }: { data: SelectionRow[] }) => {
      selections.push(...data);
    });
    transactionMock = jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({
        userTorrentGroup: { deleteMany: deleteManyMock, createMany: createManyMock },
      });
    });

    const prisma = {
      torrentGroup: {
        findMany: jest.fn(async ({ where }: { where?: Where }) => {
          if (where?.id?.in !== undefined) {
            return catalog.filter((row) => where.id!.in.includes(row.id));
          }
          return catalog;
        }),
      },
      userTorrentGroup: {
        findMany: jest.fn(async ({ where }: { where: Where }) => {
          return selections
            .filter((row) => matchesWhere(row, where))
            .map((row) => ({
              ...row,
              torrentGroup: catalog.find((candidate) => candidate.id === row.torrentGroupId),
            }));
        }),
      },
      $transaction: transactionMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferencesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LanguagesService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    service = module.get<PreferencesService>(PreferencesService);
  });

  it('saving MOVIE groups leaves the caller\'s SHOW rows in place, and the reverse', async () => {
    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [movieB.id]);

    expect(selectionsOf('user-1').map((row) => row.torrentGroupId).sort()).toEqual(
      [movieB.id, showC.id].sort(),
    );

    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.SHOW, [showD.id]);

    expect(selectionsOf('user-1').map((row) => row.torrentGroupId).sort()).toEqual(
      [movieB.id, showD.id].sort(),
    );
  });

  it('saving MOVIE groups leaves another user\'s rows in place', async () => {
    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [movieB.id]);

    expect(selectionsOf('user-2').map((row) => row.torrentGroupId).sort()).toEqual(
      [movieA.id, showC.id].sort(),
    );
  });

  it('an id matching no row throws not_found and writes nothing', async () => {
    const before = [...selections];

    await expect(
      service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [999]),
    ).rejects.toThrow('Torrent group 999 does not exist');

    expect(selections).toEqual(before);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('a repeated id throws duplicated and writes nothing', async () => {
    const before = [...selections];

    await expect(
      service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [movieA.id, movieA.id]),
    ).rejects.toThrow('Torrent group 1 is repeated');

    expect(selections).toEqual(before);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('ids: [] clears that scope only', async () => {
    const result = await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, []);

    expect(result).toEqual([]);
    expect(selectionsOf('user-1').map((row) => row.torrentGroupId)).toEqual([showC.id]);
  });

  it('the same group id selected for both scopes yields two rows and neither save clobbers the other', async () => {
    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [movieA.id]);
    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.SHOW, [movieA.id]);

    const rows = selectionsOf('user-1');
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: 'user-1', torrentGroupId: movieA.id, scope: 'MOVIE' },
        { userId: 'user-1', torrentGroupId: movieA.id, scope: 'SHOW' },
      ]),
    );
    expect(rows).toHaveLength(2);

    await service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [movieB.id]);

    expect(selectionsOf('user-1')).toEqual(
      expect.arrayContaining([
        { userId: 'user-1', torrentGroupId: movieB.id, scope: 'MOVIE' },
        { userId: 'user-1', torrentGroupId: movieA.id, scope: 'SHOW' },
      ]),
    );
    expect(selectionsOf('user-1')).toHaveLength(2);
  });
});

// createTorrentGroup checks for a name collision in JS before writing, but
// the JS comparison and MariaDB's column collation are two different
// authorities that nothing forces to agree — a lookup bug in one must not
// let a duplicate reach the database as long as the other still catches it.
describe('PreferencesService — createTorrentGroup name collision', () => {
  let rows: { id: number; name: string }[];
  let nextId: number;
  let service: PreferencesService;
  let prisma: {
    torrentGroup: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    rows = [];
    nextId = 1;

    prisma = {
      torrentGroup: {
        findFirst: jest.fn(async ({ where }: { where: { name: string } }) => {
          const normalized = where.name.toLowerCase();
          return rows.find((row) => row.name.toLowerCase() === normalized) ?? null;
        }),
        create: jest.fn(async ({ data }: { data: { name: string } }) => {
          const normalized = data.name.toLowerCase();
          if (rows.some((row) => row.name.toLowerCase() === normalized)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row = { id: nextId++, name: data.name };
          rows.push(row);
          return row;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferencesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LanguagesService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    service = module.get<PreferencesService>(PreferencesService);
  });

  it('rejects a case-insensitive duplicate found by the JS lookup, leaving one row', async () => {
    await service.createTorrentGroup('FLUX');

    await expect(service.createTorrentGroup('flux')).rejects.toThrow(
      'A torrent group named "flux" already exists',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('FLUX');
  });

  it('translates a P2002 the JS lookup missed into the same name_taken message', async () => {
    // Simulates the JS lookup and the collation disagreeing: findFirst is
    // stubbed to miss the duplicate (as a case-sensitive query against a
    // case-insensitive column could), so only the unique-index race,
    // surfaced here as a raw P2002 from create(), is left to catch it. The
    // caller must still see the translated message, not the raw Prisma error.
    rows.push({ id: 1, name: 'FLUX' });
    prisma.torrentGroup.findFirst.mockResolvedValueOnce(null);

    await expect(service.createTorrentGroup('flux')).rejects.toThrow(
      'A torrent group named "flux" already exists',
    );

    expect(rows).toHaveLength(1);
  });
});
