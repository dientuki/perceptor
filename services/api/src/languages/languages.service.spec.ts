import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LanguagesService } from './languages.service';
import { PrismaService } from '@/prisma/prisma.service';

// This suite exists because the write path (replace-all via deleteMany +
// createMany) is the exact shape Article IX worries about: if validation ran
// after the delete, or the delete+create pair were not wrapped in one
// transaction, a rejected write (unknown or duplicated `iso2`) could still
// leave a user with their old preference half-deleted and none of the new
// one written — and the mutation would report the thrown error while the
// database silently disagrees with what the caller believes happened.
// Each case below is written so it fails if the rule it defends against is
// removed: the "before deleting" cases assert `deleteMany` was never called,
// not just that the promise rejected.
describe('LanguagesService — preference writes', () => {
  let service: LanguagesService;

  const spanish = { id: 1, iso2: 'es', iso3: 'spa' };
  const english = { id: 2, iso2: 'en', iso3: 'eng' };
  const portuguese = { id: 3, iso2: 'pt', iso3: 'por' };

  let languageFindMany: jest.Mock;
  let tx: {
    userLanguage: { deleteMany: jest.Mock; createMany: jest.Mock };
    userMovieLanguage: { deleteMany: jest.Mock; createMany: jest.Mock };
    userShowLanguage: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let readFindMany: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(async () => {
    languageFindMany = jest.fn();
    readFindMany = jest.fn().mockResolvedValue([]);
    tx = {
      userLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
      userMovieLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
      userShowLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    transactionMock = jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback(tx);
    });

    const prisma = {
      language: { findMany: languageFindMany },
      userLanguage: { findMany: readFindMany },
      userMovieLanguage: { findMany: readFindMany },
      userShowLanguage: { findMany: readFindMany },
      $transaction: transactionMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LanguagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LanguagesService>(LanguagesService);
  });

  // Table of the three write targets, exercised with the same four cases —
  // they share the private validation helper and the deleteMany+createMany
  // shape, so a bug in any one of them is a bug in all three.
  const targets = [
    {
      name: 'setPreferredLanguagesFor (user)',
      call: (iso2: string[]) => service.setPreferredLanguagesFor('user-1', iso2),
      txModel: () => tx.userLanguage,
      expectedDeleteWhere: { userId: 'user-1' },
      expectedCreateRow: (languageId: number) => ({ userId: 'user-1', languageId }),
    },
    {
      name: 'setMoviePreferredLanguagesFor (user + movie)',
      call: (iso2: string[]) => service.setMoviePreferredLanguagesFor('user-1', 42, iso2),
      txModel: () => tx.userMovieLanguage,
      expectedDeleteWhere: { userId: 'user-1', movieId: 42 },
      expectedCreateRow: (languageId: number) => ({ userId: 'user-1', movieId: 42, languageId }),
    },
    {
      name: 'setShowPreferredLanguagesFor (user + show)',
      call: (iso2: string[]) => service.setShowPreferredLanguagesFor('user-1', 7, iso2),
      txModel: () => tx.userShowLanguage,
      expectedDeleteWhere: { userId: 'user-1', showId: 7 },
      expectedCreateRow: (languageId: number) => ({ userId: 'user-1', showId: 7, languageId }),
    },
  ];

  for (const target of targets) {
    describe(target.name, () => {
      it('replacing a set deletes the old rows and creates exactly the new ones', async () => {
        languageFindMany.mockResolvedValue([spanish, english]);

        await target.call(['es', 'en']);

        const model = target.txModel();
        expect(model.deleteMany).toHaveBeenCalledWith({ where: target.expectedDeleteWhere });
        expect(model.createMany).toHaveBeenCalledWith({
          data: [target.expectedCreateRow(spanish.id), target.expectedCreateRow(english.id)],
        });
        // Verified to fail without the transaction: if deleteMany/createMany
        // ran outside `$transaction`, this call would never have happened
        // through the mocked `tx` object at all.
        expect(transactionMock).toHaveBeenCalledTimes(1);
      });

      it('passing [] clears the preference without creating anything', async () => {
        await target.call([]);

        const model = target.txModel();
        expect(model.deleteMany).toHaveBeenCalledWith({ where: target.expectedDeleteWhere });
        expect(model.createMany).not.toHaveBeenCalled();
        // languages.findMany must not run for an empty list — nothing to
        // validate against.
        expect(languageFindMany).not.toHaveBeenCalled();
      });

      it('an unknown iso2 throws before anything is deleted', async () => {
        languageFindMany.mockResolvedValue([spanish]); // 'xx' is not a row

        await expect(target.call(['es', 'xx'])).rejects.toThrow(
          new BadRequestException('El idioma xx no está disponible'),
        );

        const model = target.txModel();
        expect(model.deleteMany).not.toHaveBeenCalled();
        expect(model.createMany).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
      });

      it('a duplicated iso2 in one argument throws before anything is deleted', async () => {
        await expect(target.call(['es', 'es'])).rejects.toThrow(
          new BadRequestException('El idioma es está repetido'),
        );

        const model = target.txModel();
        expect(model.deleteMany).not.toHaveBeenCalled();
        expect(model.createMany).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        // Duplicate detection must not even query `languages` — it's a pure
        // check on the argument itself.
        expect(languageFindMany).not.toHaveBeenCalled();
      });
    });
  }

  it('resolves every iso2 code even with a third, unrelated language present in the table', async () => {
    // Guards against a lookup that only checks "at least one row exists"
    // instead of mapping every requested code — that bug would silently
    // resolve 'pt' to spanish's id if the map were built wrong.
    languageFindMany.mockResolvedValue([spanish, english, portuguese]);

    await service.setPreferredLanguagesFor('user-1', ['pt', 'es']);

    expect(tx.userLanguage.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', languageId: portuguese.id },
        { userId: 'user-1', languageId: spanish.id },
      ],
    });
  });
});
