import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { PreferencesService } from '@/preferences/preferences.service';
import { ERROR_KEYS } from '@/i18n/error-keys';

// This suite exists because the subtitle-search setter is the only gate on
// the OpenSubtitles requirement: without the key and account check an install
// that cannot reach OpenSubtitles stores a flag that can never take effect and
// the UI reads as enabled, with no error anywhere. It runs the real
// MediaCapabilitiesService over a settings map and asserts that nothing is
// written when the call is refused, that each of the three inputs (key,
// username, password) is required on its own, and that the media server is
// irrelevant (Article IX, Spec 107, REQ-2 REQ-13).
describe('subtitle search setters', () => {
  const saved = process.env.OPENSUBTITLES_API_KEY;
  let userUpdate: jest.Mock;
  let preferences: PreferencesService;
  let capabilities: MediaCapabilitiesService;

  const build = (settings: Record<string, string>) => {
    capabilities = new MediaCapabilitiesService({
      getMap: () => Promise.resolve(settings),
    } as never);
    userUpdate = jest.fn().mockResolvedValue({});
    const prisma = { user: { update: userUpdate } };
    preferences = new PreferencesService(
      prisma as never,
      {} as never,
      {
        setSubtitleSearch: (id: string, enabled: boolean) =>
          prisma.user.update({
            where: { id },
            data: { subtitleSearch: enabled },
          }) as Promise<unknown>,
      } as never,
      capabilities,
    );
    jest.spyOn(preferences, 'findForUser').mockResolvedValue({} as never);
  };

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENSUBTITLES_API_KEY;
    else process.env.OPENSUBTITLES_API_KEY = saved;
  });

  const outcome = async (call: () => Promise<unknown>) => {
    try {
      await call();
      return 'accepted';
    } catch (error) {
      const body = (
        error as { getResponse?: () => { i18n?: { key?: string } } }
      ).getResponse?.();
      return body?.i18n?.key ?? String(error);
    }
  };

  const account = {
    opensubtitles_username: 'fake-user',
    opensubtitles_password: 'fake-pass',
  };

  const cases: Array<[string, string | undefined, Record<string, string>, boolean]> = [
    ['key and account present', 'fake-key', account, true],
    ['key missing', undefined, account, false],
    ['username empty', 'fake-key', { ...account, opensubtitles_username: '' }, false],
    ['password empty', 'fake-key', { ...account, opensubtitles_password: '' }, false],
    ['password whitespace only', 'fake-key', { ...account, opensubtitles_password: '  ' }, false],
    ['username row absent', 'fake-key', { opensubtitles_password: 'fake-pass' }, false],
  ];

  it.each(cases)(
    'setSubtitleSearch with %s',
    async (_label, key, settings, available) => {
      if (key === undefined) delete process.env.OPENSUBTITLES_API_KEY;
      else process.env.OPENSUBTITLES_API_KEY = key;
      build(settings);
      expect(
        await outcome(() => preferences.setSubtitleSearch('u1', true)),
      ).toBe(
        available
          ? 'accepted'
          : ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_NOT_CONFIGURED,
      );
      expect(userUpdate).toHaveBeenCalledTimes(available ? 1 : 0);
      expect(await capabilities.isSubtitleSearchAvailable()).toBe(available);
    },
  );

  it.each(['none', 'plex', 'jellyfin'])(
    'ignores media_server_client=%s',
    async (client) => {
      process.env.OPENSUBTITLES_API_KEY = 'fake-key';
      build({ ...account, media_server_client: client });
      expect(await capabilities.isSubtitleSearchAvailable()).toBe(true);
    },
  );
});
