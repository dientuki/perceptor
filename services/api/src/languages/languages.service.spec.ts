import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LanguageTrackKind } from '@prisma/client';
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
    userLanguagePreference: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let readFindMany: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(async () => {
    languageFindMany = jest.fn();
    readFindMany = jest.fn().mockResolvedValue([]);
    tx = {
      userMovieLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
      userShowLanguage: { deleteMany: jest.fn(), createMany: jest.fn() },
      userLanguagePreference: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    transactionMock = jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback(tx);
    });

    const prisma = {
      language: { findMany: languageFindMany },
      userMovieLanguage: { findMany: readFindMany },
      userShowLanguage: { findMany: readFindMany },
      userLanguagePreference: { findMany: readFindMany },
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
      name: 'setMoviePreferredTrackLanguagesFor (user + movie + kind)',
      call: (tags: string[]) =>
        service.setMoviePreferredTrackLanguagesFor('user-1', 42, LanguageTrackKind.AUDIO, tags),
      txModel: () => tx.userMovieLanguage,
      expectedDeleteWhere: { userId: 'user-1', movieId: 42, kind: LanguageTrackKind.AUDIO },
      expectedCreateRow: (languageId: number) => ({
        userId: 'user-1',
        movieId: 42,
        kind: LanguageTrackKind.AUDIO,
        languageId,
      }),
    },
    {
      name: 'setShowPreferredTrackLanguagesFor (user + show + kind)',
      call: (tags: string[]) =>
        service.setShowPreferredTrackLanguagesFor('user-1', 7, LanguageTrackKind.AUDIO, tags),
      txModel: () => tx.userShowLanguage,
      expectedDeleteWhere: { userId: 'user-1', showId: 7, kind: LanguageTrackKind.AUDIO },
      expectedCreateRow: (languageId: number) => ({
        userId: 'user-1',
        showId: 7,
        kind: LanguageTrackKind.AUDIO,
        languageId,
      }),
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

  it('setPreferredTrackLanguagesFor: writing AUDIO deletes only AUDIO rows, leaving SUBTITLE untouched, and the reverse', async () => {
    // Both kinds live in the same `userLanguagePreference` table, keyed apart
    // only by `kind` — the fault this guards against is `deleteMany`'s `where`
    // narrowed to `{ userId }`, which would silently wipe the caller's other
    // kind on every write. Verified to fail with `kind` dropped from the
    // `where` (T009).
    languageFindMany.mockResolvedValue([spanish, english]);

    await service.setPreferredTrackLanguagesFor('user-1', LanguageTrackKind.AUDIO, ['es']);

    expect(tx.userLanguagePreference.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', kind: LanguageTrackKind.AUDIO },
    });
    expect(tx.userLanguagePreference.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', kind: LanguageTrackKind.AUDIO, languageId: spanish.id }],
    });

    tx.userLanguagePreference.deleteMany.mockClear();
    tx.userLanguagePreference.createMany.mockClear();

    await service.setPreferredTrackLanguagesFor('user-1', LanguageTrackKind.SUBTITLE, ['en']);

    expect(tx.userLanguagePreference.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', kind: LanguageTrackKind.SUBTITLE },
    });
    expect(tx.userLanguagePreference.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', kind: LanguageTrackKind.SUBTITLE, languageId: english.id }],
    });
  });

  it('setMoviePreferredTrackLanguagesFor: writing AUDIO deletes only AUDIO rows for that movie, leaving SUBTITLE untouched, and the reverse', async () => {
    // Same fault as the per-user case above, but for the per-title table:
    // both kinds live in `userMovieLanguage`, keyed apart only by `kind` on
    // top of `userId`/`movieId`. The fault this guards against is
    // `deleteMany`'s `where` narrowed back to `{ userId, movieId }`, which
    // would silently wipe the caller's other kind for the same movie on
    // every save. Verified to fail by temporarily dropping `kind` from
    // `setMoviePreferredTrackLanguagesFor`'s `deleteMany` where and watching
    // this assertion fail (`{ userId: 'user-1', movieId: 42 }` instead of the
    // kind-narrowed where), then restoring it (039-per-title-language-split,
    // T002/NFR-3).
    languageFindMany.mockResolvedValue([spanish, english]);

    await service.setMoviePreferredTrackLanguagesFor('user-1', 42, LanguageTrackKind.AUDIO, ['es']);

    expect(tx.userMovieLanguage.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', movieId: 42, kind: LanguageTrackKind.AUDIO },
    });
    expect(tx.userMovieLanguage.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', movieId: 42, kind: LanguageTrackKind.AUDIO, languageId: spanish.id }],
    });

    tx.userMovieLanguage.deleteMany.mockClear();
    tx.userMovieLanguage.createMany.mockClear();

    await service.setMoviePreferredTrackLanguagesFor(
      'user-1',
      42,
      LanguageTrackKind.SUBTITLE,
      ['en'],
    );

    expect(tx.userMovieLanguage.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', movieId: 42, kind: LanguageTrackKind.SUBTITLE },
    });
    expect(tx.userMovieLanguage.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', movieId: 42, kind: LanguageTrackKind.SUBTITLE, languageId: english.id }],
    });
  });

  it('setShowPreferredTrackLanguagesFor: writing AUDIO deletes only AUDIO rows for that show, leaving SUBTITLE untouched, and the reverse', async () => {
    // Same fault, for `userShowLanguage`. Verified to fail by temporarily
    // dropping `kind` from `setShowPreferredTrackLanguagesFor`'s `deleteMany`
    // where and watching this assertion fail, then restoring it
    // (039-per-title-language-split, T002/NFR-3).
    languageFindMany.mockResolvedValue([spanish, english]);

    await service.setShowPreferredTrackLanguagesFor('user-1', 7, LanguageTrackKind.AUDIO, ['es']);

    expect(tx.userShowLanguage.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', showId: 7, kind: LanguageTrackKind.AUDIO },
    });
    expect(tx.userShowLanguage.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', showId: 7, kind: LanguageTrackKind.AUDIO, languageId: spanish.id }],
    });

    tx.userShowLanguage.deleteMany.mockClear();
    tx.userShowLanguage.createMany.mockClear();

    await service.setShowPreferredTrackLanguagesFor('user-1', 7, LanguageTrackKind.SUBTITLE, ['en']);

    expect(tx.userShowLanguage.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', showId: 7, kind: LanguageTrackKind.SUBTITLE },
    });
    expect(tx.userShowLanguage.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', showId: 7, kind: LanguageTrackKind.SUBTITLE, languageId: english.id }],
    });
  });

  it('resolves every tag even with a third, unrelated language present in the table', async () => {
    // Guards against a lookup that only checks "at least one row exists"
    // instead of mapping every requested tag — that bug would silently
    // resolve 'pt' to spanish's id if the map were built wrong.
    languageFindMany.mockResolvedValue([spanish, english, portuguese]);

    await service.setMoviePreferredTrackLanguagesFor(
      'user-1',
      42,
      LanguageTrackKind.AUDIO,
      ['pt', 'es'],
    );

    expect(tx.userMovieLanguage.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', movieId: 42, kind: LanguageTrackKind.AUDIO, languageId: portuguese.id },
        { userId: 'user-1', movieId: 42, kind: LanguageTrackKind.AUDIO, languageId: spanish.id },
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

// This suite exists because `findTrackTitles()` collapses three rows sharing
// one `iso3` (a base language plus its regional variants) down to a single
// entry, and the rule for which row survives is easy to get backwards: if a
// variant row won instead of the base row, the worker would still get one
// entry per `iso3` — nothing would throw, the count would still look right —
// but a title using `es-419`'s or `es-ES`'s bare row would render whichever
// variant happened to be seeded last instead of the intended `Español`, with
// no error anywhere to catch it.
describe('LanguagesService — findTrackTitles (worker track-title catalog)', () => {
  let service: LanguagesService;
  let languageFindMany: jest.Mock;

  const spanish = { tag: 'es', iso2: 'es', iso3: 'spa', trackTitle: 'Español' };
  const spanishLatam = { tag: 'es-419', iso2: 'es', iso3: 'spa', trackTitle: null };
  const spanishSpain = { tag: 'es-ES', iso2: 'es', iso3: 'spa', trackTitle: null };
  const english = { tag: 'en', iso2: 'en', iso3: 'eng', trackTitle: 'English' };
  const japanese = { tag: 'ja', iso2: 'ja', iso3: 'jpn', trackTitle: '日本語' };
  const korean = { tag: 'ko', iso2: 'ko', iso3: 'kor', trackTitle: '한국어' };
  const french = { tag: 'fr', iso2: 'fr', iso3: 'fre', trackTitle: 'Français' };

  beforeEach(async () => {
    languageFindMany = jest.fn();
    const prisma = { language: { findMany: languageFindMany } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [LanguagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<LanguagesService>(LanguagesService);
  });

  it('collapses three rows sharing iso3 "spa" into one entry carrying the base row\'s title (fault-injection target)', async () => {
    // Both variant rows are given a (hypothetical) non-null trackTitle here,
    // unlike the real seed — if they carried `null` like the seed does, the
    // existing `if (!row.trackTitle) continue` filter would already exclude
    // them and this case would pass even with the tie-break rule inverted,
    // proving nothing. Giving them a title forces the assertion to actually
    // exercise "prefer the base row", not "prefer whichever row has a
    // title". Seeded in reverse of the seed-file order on top of that — a
    // rule that picked "whichever row was seen last" rather than "the base
    // row" would still pass if the base row happened to be last.
    const spanishLatamWithTitle = { ...spanishLatam, trackTitle: 'Español (LatAm)' };
    const spanishSpainWithTitle = { ...spanishSpain, trackTitle: 'Español (España)' };
    languageFindMany.mockResolvedValue([
      spanishSpainWithTitle,
      spanishLatamWithTitle,
      spanish,
    ]);

    const result = await service.findTrackTitles();

    expect(result).toEqual([{ iso3: 'spa', title: 'Español' }]);
  });

  it('never produces an entry of its own for es-419 or es-ES', async () => {
    languageFindMany.mockResolvedValue([spanish, spanishLatam, spanishSpain]);

    const result = await service.findTrackTitles();
    const iso3s = result.map((row) => row.iso3);

    expect(iso3s).toEqual(['spa']);
    expect(iso3s.filter((iso3) => iso3 === 'spa')).toHaveLength(1);
  });

  it('a null trackTitle produces no entry rather than an empty one', async () => {
    languageFindMany.mockResolvedValue([spanishLatam, spanishSpain]);

    const result = await service.findTrackTitles();

    expect(result).toEqual([]);
  });

  it('the seeded set yields 20 entries, including jpn/kor/fre with their native titles', async () => {
    // Mirrors prisma/seeds/languages.ts row-for-row (22 rows: `es` plus its
    // two variants, which carry no `trackTitle`, plus 19 other languages) —
    // this is the actual shape `LanguagesService` sees against a freshly
    // seeded database, not a hand-picked subset.
    languageFindMany.mockResolvedValue([
      spanish,
      spanishLatam,
      spanishSpain,
      english,
      { tag: 'pt', iso2: 'pt', iso3: 'por', trackTitle: 'Português' },
      japanese,
      korean,
      french,
      { tag: 'de', iso2: 'de', iso3: 'ger', trackTitle: 'Deutsch' },
      { tag: 'it', iso2: 'it', iso3: 'ita', trackTitle: 'Italiano' },
      { tag: 'zh', iso2: 'zh', iso3: 'chi', trackTitle: '中文' },
      { tag: 'ru', iso2: 'ru', iso3: 'rus', trackTitle: 'Русский' },
      { tag: 'hi', iso2: 'hi', iso3: 'hin', trackTitle: 'हिन्दी' },
      { tag: 'ar', iso2: 'ar', iso3: 'ara', trackTitle: 'العربية' },
      { tag: 'sv', iso2: 'sv', iso3: 'swe', trackTitle: 'Svenska' },
      { tag: 'da', iso2: 'da', iso3: 'dan', trackTitle: 'Dansk' },
      { tag: 'nl', iso2: 'nl', iso3: 'dut', trackTitle: 'Nederlands' },
      { tag: 'nb', iso2: 'nb', iso3: 'nor', trackTitle: 'Norsk' },
      { tag: 'pl', iso2: 'pl', iso3: 'pol', trackTitle: 'Polski' },
      { tag: 'tr', iso2: 'tr', iso3: 'tur', trackTitle: 'Türkçe' },
      { tag: 'th', iso2: 'th', iso3: 'tha', trackTitle: 'ไทย' },
      { tag: 'cs', iso2: 'cs', iso3: 'cze', trackTitle: 'Čeština' },
    ]);

    const result = await service.findTrackTitles();

    expect(result).toHaveLength(20);
    expect(result).toEqual(
      expect.arrayContaining([
        { iso3: 'jpn', title: '日本語' },
        { iso3: 'kor', title: '한국어' },
        { iso3: 'fre', title: 'Français' },
      ]),
    );
  });
});
