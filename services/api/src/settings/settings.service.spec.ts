import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { LanguagesService } from '@/languages/languages.service';

// This suite exists because otherwise a `default_languages` value that
// parses loosely fails with no error anywhere: "es,,en" or a trailing comma
// yields an empty-string code, and if that reached storage un-normalized the
// encode-time merge (`ProcessJobsService.collectAllowedLanguages`) would
// later read a code that resolves to nothing — a track silently dropped from
// every future encode, discovered weeks later by someone missing an audio
// track, never by a thrown error. Each case is written to fail if the rule
// it defends against is removed (the trim, the empty-segment drop, the
// validate-before-write ordering, or storing the raw input instead of the
// normalized join).
describe('SettingsService — languages kind', () => {
  let service: SettingsService;
  let upsert: jest.Mock;
  let findMany: jest.Mock;
  let validateAndResolveLanguageIds: jest.Mock;

  const spanish = { id: 1, iso2: 'es', iso3: 'spa' };
  const english = { id: 2, iso2: 'en', iso3: 'eng' };

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue({});
    findMany = jest.fn().mockResolvedValue([]);
    validateAndResolveLanguageIds = jest.fn();

    const prisma = {
      setting: { upsert, findMany },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MediaRootsService, useValue: { resolveFromRoot: jest.fn() } },
        { provide: LanguagesService, useValue: { validateAndResolveLanguageIds } },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  it('trims whitespace around each code before validating and storing', async () => {
    validateAndResolveLanguageIds.mockResolvedValue([spanish.id, english.id]);

    await service.updateMany([{ key: 'default_languages', value: ' es , en ' }]);

    expect(validateAndResolveLanguageIds).toHaveBeenCalledWith(['es', 'en']);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'default_languages' },
      update: { value: 'es,en' },
      create: { key: 'default_languages', value: 'es,en' },
    });
  });

  it('drops empty segments from a trailing or double comma rather than validating them', async () => {
    validateAndResolveLanguageIds.mockResolvedValue([spanish.id]);

    await service.updateMany([{ key: 'default_languages', value: 'es,,' }]);

    // The bug this defends against: passing ['es', '', ''] through would
    // make resolveLanguageIds throw "unavailable ''", or worse — if empty
    // codes were ever tolerated upstream — store a code that silently
    // resolves to nothing at encode time.
    expect(validateAndResolveLanguageIds).toHaveBeenCalledWith(['es']);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 'es' } }),
    );
  });

  it('accepts the empty string as the empty list and writes nothing to validate', async () => {
    await service.updateMany([{ key: 'default_languages', value: '' }]);

    expect(validateAndResolveLanguageIds).toHaveBeenCalledWith([]);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'default_languages' },
      update: { value: '' },
      create: { key: 'default_languages', value: '' },
    });
  });

  it('rejects an unknown code before writing anything', async () => {
    validateAndResolveLanguageIds.mockRejectedValue(
      new BadRequestException('Language zz is not available'),
    );

    await expect(
      service.updateMany([{ key: 'default_languages', value: 'es,zz' }]),
    ).rejects.toThrow('Language zz is not available');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a duplicated code before writing anything', async () => {
    validateAndResolveLanguageIds.mockRejectedValue(
      new BadRequestException('Language es is repeated'),
    );

    await expect(
      service.updateMany([{ key: 'default_languages', value: 'es,es' }]),
    ).rejects.toThrow('Language es is repeated');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('a rejected languages entry leaves an earlier, otherwise-valid entry in the same call unwritten', async () => {
    validateAndResolveLanguageIds.mockRejectedValue(
      new BadRequestException('Language zz is not available'),
    );

    await expect(
      service.updateMany([
        { key: 'movies_enabled', value: 'true' },
        { key: 'default_languages', value: 'zz' },
      ]),
    ).rejects.toThrow('Language zz is not available');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores the normalized joined list rather than echoing the raw input', async () => {
    validateAndResolveLanguageIds.mockResolvedValue([spanish.id, english.id]);

    await service.updateMany([{ key: 'default_languages', value: 'es , en' }]);

    const call = upsert.mock.calls[0][0];
    expect(call.update.value).toBe('es,en');
    expect(call.update.value).not.toBe('es , en');
  });
});
