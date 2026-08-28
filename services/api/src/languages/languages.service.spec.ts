import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LanguagesService } from './languages.service';
import { PrismaService } from '@/prisma/prisma.service';

// This suite exists because the write path (replace-all via deleteMany +
// createMany) is the exact shape Article IX worries about: if validation ran
// after the delete, or the delete+create pair were not wrapped in one
// transaction, a rejected write (unknown or duplicated `tag`) could still
// leave a user with their old preference half-deleted and none of the new
// one written — and the mutation would report the thrown error while the
// database silently disagrees with what the caller believes happened.
// Each case below is written so it fails if the rule it defends against is
// removed: the "before deleting" cases assert `deleteMany` was never called,
// not just that the promise rejected.
//
// Since 030-language-regional-variants, `iso2` is no longer unique — three
// rows can share `es` (`es`, `es-419`, `es-ES`) — so this suite also covers
// the two places a lookup left on `iso2` would silently misbehave: the
// catalog filter (`findAll`) and the tag validator.
describe('LanguagesService — preference writes', () => {
  let service: LanguagesService;

  const spanish = { id: 1, tag: 'es', iso2: 'es', iso3: 'spa' };
  const english = { id: 2, tag: 'en', iso2: 'en', iso3: 'eng' };
  const portuguese = { id: 3, tag: 'pt', iso2: 'pt', iso3: 'por' };
  const spanishLatam = { id: 4, tag: 'es-419', iso2: 'es', iso3: 'spa' };
  const spanishSpain = { id: 5, tag: 'es-ES', iso2: 'es', iso3: 'spa' };

  let languageFindMany: jest.Mock;
  let tx: {
    userMovieLanguage: { deleteMany: jest.Mock; createMany: jest.Mock };
    userShowLanguage: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let readFindMany: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(async () => {
    languageFindMany = jest.fn();
    readFindMany = jest.fn().mockResolvedValue([]);
    tx = {
      userMovieLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
      userShowLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    transactionMock = jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback(tx);
    });

    const prisma = {
      language: { findMany: languageFindMany },
      userMovieLanguage: { findMany: readFindMany },
      userShowLanguage: { findMany: readFindMany },
      $transaction: transactionMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LanguagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LanguagesService>(LanguagesService);
  });

  // Table of the two per-title write targets, exercised with the same four
  // cases — they share the private validation helper and the
  // deleteMany+createMany shape, so a bug in one is a bug in both. The
  // per-user global level (setPreferredLanguagesFor) was removed by
  // 029-settings-screen-tabs; that level is now a `Setting`, not a table this
  // service owns.
  const targets = [
    {
      name: 'setMoviePreferredLanguagesFor (user + movie)',
      call: (tags: string[]) => service.setMoviePreferredLanguagesFor('user-1', 42, tags),
      txModel: () => tx.userMovieLanguage,
      expectedDeleteWhere: { userId: 'user-1', movieId: 42 },
      expectedCreateRow: (languageId: number) => ({ userId: 'user-1', movieId: 42, languageId }),
    },
    {
      name: 'setShowPreferredLanguagesFor (user + show)',
      call: (tags: string[]) => service.setShowPreferredLanguagesFor('user-1', 7, tags),
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

      it('an unknown tag throws before anything is deleted', async () => {
        languageFindMany.mockResolvedValue([spanish]); // 'xx' is not a row

        await expect(target.call(['es', 'xx'])).rejects.toThrow(
          new BadRequestException('Language xx is not available'),
        );

        const model = target.txModel();
        expect(model.deleteMany).not.toHaveBeenCalled();
        expect(model.createMany).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
      });

      it('a duplicated tag in one argument throws before anything is deleted', async () => {
        await expect(target.call(['es', 'es'])).rejects.toThrow(
          new BadRequestException('Language es is repeated'),
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

  it('resolves every tag even with a third, unrelated language present in the table', async () => {
    // Guards against a lookup that only checks "at least one row exists"
    // instead of mapping every requested tag — that bug would silently
    // resolve 'pt' to spanish's id if the map were built wrong.
    languageFindMany.mockResolvedValue([spanish, english, portuguese]);

    await service.setMoviePreferredLanguagesFor('user-1', 42, ['pt', 'es']);

    expect(tx.userMovieLanguage.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', movieId: 42, languageId: portuguese.id },
        { userId: 'user-1', movieId: 42, languageId: spanish.id },
      ],
    });
  });

  it('resolves es-419 and es-ES to two different ids despite sharing iso2', async () => {
    // A lookup left on `iso2` (e.g. a Map keyed by row.iso2) would collapse
    // both rows under the key 'es' and silently return the same id twice —
    // a user's two-variant choice would lose one variant with no error
    // anywhere. This is the fault-injection target for T005: temporarily
    // keying the validator's Map by `row.iso2` instead of `row.tag` makes
    // this assertion fail (both resolved ids become the same one).
    languageFindMany.mockResolvedValue([spanishLatam, spanishSpain]);

    const ids = await service.validateAndResolveLanguageIds(['es-419', 'es-ES']);

    expect(ids).toEqual([spanishLatam.id, spanishSpain.id]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('accepts the base tag `es` submitted directly, even though it is not in the pickable catalog', async () => {
    // The validator checks the WHOLE table, never the filtered catalog
    // `findAll()` returns — `es` means "Spanish, no variant preference" and
    // is a real row, so it must be accepted here even though `findAll()`
    // hides it from the picker (030-language-regional-variants).
    languageFindMany.mockResolvedValue([spanish]);

    const ids = await service.validateAndResolveLanguageIds(['es']);

    expect(ids).toEqual([spanish.id]);
  });
});

// This suite exists because the naive reading of "hide a base row that has
// variants" — hiding any row whose tag equals its iso2 — hides every
// ordinary language (`en`, `ja`, `fr`, … all have tag === iso2) and would
// empty the picker down to just the two Spanish variants. Nothing would
// throw; the picker would just be silently, catastrophically empty.
describe('LanguagesService — findAll (pickable catalog)', () => {
  let service: LanguagesService;
  let languageFindMany: jest.Mock;

  const spanish = { id: 1, tag: 'es', iso2: 'es', iso3: 'spa' };
  const spanishLatam = { id: 4, tag: 'es-419', iso2: 'es', iso3: 'spa' };
  const spanishSpain = { id: 5, tag: 'es-ES', iso2: 'es', iso3: 'spa' };
  const english = { id: 2, tag: 'en', iso2: 'en', iso3: 'eng' };
  const japanese = { id: 6, tag: 'ja', iso2: 'ja', iso3: 'jpn' };

  beforeEach(async () => {
    languageFindMany = jest.fn();
    const prisma = { language: { findMany: languageFindMany } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [LanguagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<LanguagesService>(LanguagesService);
  });

  it('omits the base `es` row while still returning every single-row language', async () => {
    languageFindMany.mockResolvedValue([spanish, spanishLatam, spanishSpain, english, japanese]);

    const result = await service.findAll();
    const tags = result.map((row) => row.tag).sort();

    expect(tags).toEqual(['en', 'es-419', 'es-ES', 'ja'].sort());
    expect(tags).not.toContain('es');
  });

  it('keeps a base row when nothing else shares its iso2 (fault-injection target)', async () => {
    // With only single-row languages present, the naive filter ("hide any
    // row whose tag equals its iso2") removes every one of them. The
    // correct rule only hides a base row when ANOTHER row shares its iso2.
    languageFindMany.mockResolvedValue([english, japanese]);

    const result = await service.findAll();

    expect(result.map((row) => row.tag).sort()).toEqual(['en', 'ja']);
  });
});
