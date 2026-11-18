import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubtitleProviderKind } from '@prisma/client';
import { SubtitleProvidersService } from './subtitle-providers.service';

const OS = SubtitleProviderKind.OPENSUBTITLES;
const SX = SubtitleProviderKind.SUBDIVX;

// This suite exists because otherwise the provider settings fail with no
// error anywhere: an existing OpenSubtitles installation stops reading as
// configured after the upgrade (every manual search silently refused), adding
// a second provider flips which one is the default (searches start going to a
// provider nobody chose), a blank secret on edit wipes the stored one, or an
// entry that can never serve its language is stored and the fallback it was
// meant to give never happens. The store is an in-memory Setting table, so
// what the service writes is what the next read sees.
describe('SubtitleProvidersService', () => {
  const LANGUAGES = [
    { tag: 'en', iso3: 'eng' },
    { tag: 'es', iso3: 'spa' },
    { tag: 'es-419', iso3: 'spa' },
    { tag: 'es-ES', iso3: 'spa' },
  ];

  let store: Record<string, string>;
  let service: SubtitleProvidersService;
  let upsert: jest.Mock;
  const originalKey = process.env.OPENSUBTITLES_API_KEY;

  const build = (initial: Record<string, string>) => {
    store = {
      opensubtitles_username: '',
      opensubtitles_password: '',
      subdivx_api_key: '',
      subtitle_provider_default: '',
      subtitle_provider_languages: '[]',
      ...initial,
    };
    upsert = jest.fn(async ({ where, update }) => {
      store[where.key] = update.value;
    });
    const prisma = {
      setting: { upsert },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      language: {
        findMany: jest.fn(async ({ where }) => {
          if (where.iso3) return LANGUAGES.filter((l) => l.iso3 === where.iso3);
          return LANGUAGES.filter((l) => where.tag.in.includes(l.tag));
        }),
      },
    };
    const settings = { getMap: jest.fn(async () => ({ ...store })) };
    service = new SubtitleProvidersService(prisma as never, settings as never);
  };

  const keyOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as BadRequestException | NotFoundException;
      return {
        type: e.constructor.name,
        key: (e.getResponse() as { i18n: { key: string } }).i18n.key,
        params: (e.getResponse() as { i18n: { params?: object } }).i18n.params,
      };
    }
    return null;
  };

  beforeEach(() => {
    process.env.OPENSUBTITLES_API_KEY = 'app-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.OPENSUBTITLES_API_KEY;
    else process.env.OPENSUBTITLES_API_KEY = originalKey;
  });

  describe('REQ-17 existing installation', () => {
    it('reads OpenSubtitles rows alone as configured and default, with no languages', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });

      const result = await service.read();

      expect(result.providers.map((p) => p.kind)).toEqual([OS, SX]);
      expect(result.providers[0]).toMatchObject({
        kind: OS,
        configured: true,
        isDefault: true,
        username: 'user',
        secretSet: true,
        languageTags: null,
      });
      expect(result.providers[1]).toMatchObject({
        kind: SX,
        configured: false,
        isDefault: false,
        secretSet: false,
        languageTags: ['es', 'es-419', 'es-ES'],
      });
      expect(result.languages).toEqual([]);
    });

    it('never returns a secret value', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'hunter2', subdivx_api_key: 'subdivx-key' });
      const json = JSON.stringify(await service.read());
      expect(json).not.toContain('hunter2');
      expect(json).not.toContain('subdivx-key');
    });
  });

  describe('saveSubtitleProvider', () => {
    it('refuses OpenSubtitles without a username as incomplete and writes nothing', async () => {
      build({});
      await expect(
        keyOf(service.save({ kind: OS, secret: 'pw' })),
      ).resolves.toMatchObject({ type: 'BadRequestException', key: 'error.subtitleProvider.incomplete' });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a provider with no secret given and none stored as incomplete', async () => {
      build({});
      await expect(
        keyOf(service.save({ kind: SX, secret: '' })),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.incomplete' });
      await expect(
        keyOf(service.save({ kind: OS, username: 'user' })),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.incomplete' });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a username for Subdivx', async () => {
      build({});
      await expect(
        keyOf(service.save({ kind: SX, username: 'user', secret: 'key' })),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.field_not_allowed' });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses OpenSubtitles while the application key is missing', async () => {
      build({});
      delete process.env.OPENSUBTITLES_API_KEY;
      await expect(
        keyOf(service.save({ kind: OS, username: 'user', secret: 'pw' })),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.app_key_missing' });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('keeps the stored secret when the edit leaves it blank or null', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'stored-pw' });

      await service.save({ kind: OS, username: 'renamed', secret: '' });
      await service.save({ kind: OS, username: 'renamed-again', secret: null });

      expect(store.opensubtitles_password).toBe('stored-pw');
      expect(store.opensubtitles_username).toBe('renamed-again');
    });

    it('replaces the secret when one is given', async () => {
      build({ subdivx_api_key: 'old' });
      await service.save({ kind: SX, secret: ' new ' });
      expect(store.subdivx_api_key).toBe('new');
    });

    it('does not flip the default when OpenSubtitles is added while Subdivx is the derived default', async () => {
      build({ subdivx_api_key: 'key' });

      const result = await service.save({ kind: OS, username: 'user', secret: 'pw' });

      expect(store.subtitle_provider_default).toBe('SUBDIVX');
      expect(result.providers.find((p) => p.isDefault)?.kind).toBe(SX);
    });

    it('does not flip the default when Subdivx is added to an OpenSubtitles installation', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });

      const result = await service.save({ kind: SX, secret: 'key' });

      expect(store.subtitle_provider_default).toBe('OPENSUBTITLES');
      expect(result.providers.find((p) => p.isDefault)?.kind).toBe(OS);
    });

    it('leaves the default derived when the first provider is added', async () => {
      build({});
      const result = await service.save({ kind: SX, secret: 'key' });
      expect(store.subtitle_provider_default).toBe('');
      expect(result.providers.find((p) => p.isDefault)?.kind).toBe(SX);
    });
  });

  describe('removeSubtitleProvider', () => {
    it('refuses a provider that is not configured', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });
      await expect(keyOf(service.remove(SX))).resolves.toMatchObject({
        type: 'NotFoundException',
        key: 'error.subtitleProvider.not_configured',
      });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('clears the credentials, drops its languages and the stored default', async () => {
      build({
        opensubtitles_username: 'user',
        opensubtitles_password: 'pw',
        subdivx_api_key: 'key',
        subtitle_provider_default: 'SUBDIVX',
        subtitle_provider_languages: JSON.stringify([
          { languageTag: 'en', provider: 'OPENSUBTITLES' },
          { languageTag: 'es-419', provider: 'SUBDIVX' },
        ]),
      });

      const result = await service.remove(SX);

      expect(store.subdivx_api_key).toBe('');
      expect(store.subtitle_provider_default).toBe('');
      expect(JSON.parse(store.subtitle_provider_languages)).toEqual([
        { languageTag: 'en', provider: 'OPENSUBTITLES' },
      ]);
      expect(result.providers.find((p) => p.kind === SX)).toMatchObject({
        configured: false,
        secretSet: false,
      });
      expect(result.providers.find((p) => p.isDefault)?.kind).toBe(OS);
    });

    it('clears both OpenSubtitles fields', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });
      const result = await service.remove(OS);
      expect(store.opensubtitles_username).toBe('');
      expect(store.opensubtitles_password).toBe('');
      expect(result.providers.some((p) => p.configured || p.isDefault)).toBe(false);
    });
  });

  describe('setSubtitleProviderLanguages', () => {
    const both = {
      opensubtitles_username: 'user',
      opensubtitles_password: 'pw',
      subdivx_api_key: 'key',
    };

    it('stores the default and the languages and returns them', async () => {
      build(both);

      const result = await service.setLanguages(OS, [{ languageTag: 'es-419', provider: SX }]);

      expect(store.subtitle_provider_default).toBe('OPENSUBTITLES');
      expect(result.languages).toEqual([{ languageTag: 'es-419', provider: SX }]);
    });

    it('can change the default', async () => {
      build(both);
      const result = await service.setLanguages(SX, []);
      expect(result.providers.find((p) => p.isDefault)?.kind).toBe(SX);
    });

    it('refuses a default that is not configured', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });
      await expect(keyOf(service.setLanguages(SX, []))).resolves.toMatchObject({
        type: 'BadRequestException',
        key: 'error.subtitleProvider.not_configured',
      });
    });

    it('refuses a tag that is not a Language and leaves the stored languages unchanged', async () => {
      build({ ...both, subtitle_provider_languages: '[{"languageTag":"es","provider":"SUBDIVX"}]' });
      await expect(
        keyOf(service.setLanguages(OS, [{ languageTag: 'xx', provider: SX }])),
      ).resolves.toMatchObject({ key: 'error.language.unavailable', params: { tag: 'xx' } });
      expect(upsert).not.toHaveBeenCalled();
      expect(store.subtitle_provider_languages).toBe('[{"languageTag":"es","provider":"SUBDIVX"}]');
    });

    it('refuses en to Subdivx as unsupported, naming the provider and the tag', async () => {
      build(both);
      await expect(
        keyOf(service.setLanguages(OS, [{ languageTag: 'en', provider: SX }])),
      ).resolves.toMatchObject({
        key: 'error.subtitleProvider.language_unsupported',
        params: { provider: 'Subdivx', languageTag: 'en' },
      });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a entry to the default provider', async () => {
      build(both);
      await expect(
        keyOf(service.setLanguages(OS, [{ languageTag: 'es', provider: OS }])),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.language_invalid' });
    });

    it('refuses a entry to a provider that is not configured', async () => {
      build({ opensubtitles_username: 'user', opensubtitles_password: 'pw' });
      await expect(
        keyOf(service.setLanguages(OS, [{ languageTag: 'es', provider: SX }])),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.language_invalid' });
    });

    it('refuses two languages for the same tag', async () => {
      build({ ...both });
      await expect(
        keyOf(
          service.setLanguages(OS, [
            { languageTag: 'es', provider: SX },
            { languageTag: 'es', provider: SX },
          ]),
        ),
      ).resolves.toMatchObject({ key: 'error.subtitleProvider.language_duplicate' });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('chainFor', () => {
    it('resolves the base tag from the Language table and applies the variant entry', async () => {
      build({
        opensubtitles_username: 'user',
        opensubtitles_password: 'pw',
        subdivx_api_key: 'key',
        subtitle_provider_default: 'OPENSUBTITLES',
        subtitle_provider_languages: '[{"languageTag":"es-419","provider":"SUBDIVX"}]',
      });
      await expect(service.chainFor('spa', 'es-419')).resolves.toEqual([SX, OS]);
      await expect(service.chainFor('spa', 'es-ES')).resolves.toEqual([OS]);
      await expect(service.chainFor('eng', null)).resolves.toEqual([OS]);
    });
  });
});
