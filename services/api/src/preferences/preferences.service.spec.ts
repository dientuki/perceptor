import { Test, TestingModule } from '@nestjs/testing';
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
  type CatalogRow = { id: number; name: string; scope: 'MOVIE' | 'SHOW' };
  type SelectionRow = { userId: string; torrentGroupId: number };
  type Where = {
    userId?: string;
    id?: { in: number[] };
    torrentGroup?: { scope: 'MOVIE' | 'SHOW' };
  };

  const movieA: CatalogRow = { id: 1, name: 'movie-a', scope: 'MOVIE' };
  const movieB: CatalogRow = { id: 2, name: 'movie-b', scope: 'MOVIE' };
  const showC: CatalogRow = { id: 3, name: 'show-c', scope: 'SHOW' };
  const showD: CatalogRow = { id: 4, name: 'show-d', scope: 'SHOW' };

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
    if (where.torrentGroup?.scope !== undefined) {
      const group = catalog.find((candidate) => candidate.id === row.torrentGroupId);
      if (group === undefined || group.scope !== where.torrentGroup.scope) {
        return false;
      }
    }
    return true;
  }

  function selectionsOf(userId: string): SelectionRow[] {
    return selections.filter((row) => row.userId === userId);
  }

  beforeEach(async () => {
    catalog = [movieA, movieB, showC, showD];
    selections = [
      { userId: 'user-1', torrentGroupId: movieA.id },
      { userId: 'user-1', torrentGroupId: showC.id },
      { userId: 'user-2', torrentGroupId: movieA.id },
      { userId: 'user-2', torrentGroupId: showC.id },
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

  it('an id whose row is SHOW, passed with scope MOVIE, throws wrong_scope and writes nothing', async () => {
    const before = [...selections];

    await expect(
      service.setPreferredTorrentGroupsFor('user-1', TorrentGroupScope.MOVIE, [showC.id]),
    ).rejects.toThrow('Torrent group 3 does not belong to MOVIE');

    expect(selections).toEqual(before);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
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
});
