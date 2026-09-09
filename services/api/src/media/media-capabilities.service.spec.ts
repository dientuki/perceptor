import { Test, TestingModule } from '@nestjs/testing';
import { MediaCapabilitiesService } from './media-capabilities.service';
import { SettingsService } from '@/settings/settings.service';
import { MEDIA_TYPE } from '@/types/media';
import { ERROR_KEYS } from '@/i18n/error-keys';

// This test exists because otherwise a hand-edited or pre-seed `settings`
// table — one missing `movies_enabled`/`shows_enabled` row — presents the
// whole install as switched off with no error anywhere: the sidebar empty,
// the carousels gone, search dead, and nothing in the logs to say why. The
// only thing standing between that and REQ-7's "absent reads as enabled" is
// the `!== 'false'` comparison below, so this suite pins that direction and
// fails loudly if it is ever flipped to `=== 'true'`.
describe('MediaCapabilitiesService', () => {
  let service: MediaCapabilitiesService;
  let settingsService: { getMap: jest.Mock };

  const build = async (map: Record<string, string>) => {
    settingsService = { getMap: jest.fn().mockResolvedValue(map) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaCapabilitiesService,
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();
    service = module.get(MediaCapabilitiesService);
  };

  it('reads an empty settings map as both types enabled, shorts disabled', async () => {
    await build({});
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: true,
      showsEnabled: true,
      shortsEnabled: false,
    });
  });

  it('reads a map with unrelated keys as both types enabled, shorts disabled', async () => {
    await build({ movie_db_api_key: 'abc' });
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: true,
      showsEnabled: true,
      shortsEnabled: false,
    });
  });

  it('reads any value other than the literal "false" as enabled', async () => {
    await build({ movies_enabled: 'TRUE', shows_enabled: 'nope' });
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: true,
      showsEnabled: true,
      shortsEnabled: false,
    });
  });

  it('reads the literal "false" as disabled, per flag independently', async () => {
    await build({ movies_enabled: 'false', shows_enabled: 'true' });
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: false,
      showsEnabled: true,
      shortsEnabled: false,
    });
  });

  it('reads shorts as enabled only when both movies and shorts are on', async () => {
    await build({ movies_enabled: 'true', shorts_enabled: 'true' });
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: true,
      showsEnabled: true,
      shortsEnabled: true,
    });
  });

  it('reads shorts as disabled when movies is off, even if shorts_enabled is "true"', async () => {
    await build({ movies_enabled: 'false', shorts_enabled: 'true' });
    await expect(service.read()).resolves.toEqual({
      moviesEnabled: false,
      showsEnabled: true,
      shortsEnabled: false,
    });
  });

  describe('isEnabled', () => {
    it('answers per type from the same map', async () => {
      await build({ shows_enabled: 'false' });
      await expect(service.isEnabled(MEDIA_TYPE.MOVIE)).resolves.toBe(true);
      await expect(service.isEnabled(MEDIA_TYPE.SHOW)).resolves.toBe(false);
    });
  });

  describe('assertEnabled', () => {
    it('resolves silently for an enabled type', async () => {
      await build({});
      await expect(service.assertEnabled(MEDIA_TYPE.MOVIE)).resolves.toBeUndefined();
    });

    it('throws a forbidden i18n error for a disabled type', async () => {
      await build({ shows_enabled: 'false' });
      await expect(service.assertEnabled(MEDIA_TYPE.SHOW)).rejects.toMatchObject({
        status: 403,
        response: {
          i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: MEDIA_TYPE.SHOW } },
        },
      });
    });

    it('resolves silently for a type it does not recognise, leaving MEDIA_UNSUPPORTED_TYPE to MediaDispatchService', async () => {
      await build({ movies_enabled: 'false', shows_enabled: 'false' });
      await expect(service.assertEnabled('podcast')).resolves.toBeUndefined();
    });
  });

  describe('assertShortsEnabled', () => {
    it('resolves silently when movies and shorts are both enabled', async () => {
      await build({ shorts_enabled: 'true' });
      await expect(service.assertShortsEnabled()).resolves.toBeUndefined();
    });

    it('throws MEDIA_SHORTS_DISABLED when shorts_enabled is absent', async () => {
      await build({});
      await expect(service.assertShortsEnabled()).rejects.toMatchObject({
        status: 403,
        response: { i18n: { key: ERROR_KEYS.MEDIA_SHORTS_DISABLED } },
      });
    });

    it('throws MEDIA_SHORTS_DISABLED when movies is off even if shorts_enabled is "true"', async () => {
      await build({ movies_enabled: 'false', shorts_enabled: 'true' });
      await expect(service.assertShortsEnabled()).rejects.toMatchObject({
        status: 403,
        response: { i18n: { key: ERROR_KEYS.MEDIA_SHORTS_DISABLED } },
      });
    });
  });

  describe('enabledTypes', () => {
    it('lists both types when nothing is stored', async () => {
      await build({});
      await expect(service.enabledTypes()).resolves.toEqual([MEDIA_TYPE.MOVIE, MEDIA_TYPE.SHOW]);
    });

    it('excludes a disabled type', async () => {
      await build({ shows_enabled: 'false' });
      await expect(service.enabledTypes()).resolves.toEqual([MEDIA_TYPE.MOVIE]);
    });

    it('is empty when both are disabled', async () => {
      await build({ movies_enabled: 'false', shows_enabled: 'false' });
      await expect(service.enabledTypes()).resolves.toEqual([]);
    });
  });
});
