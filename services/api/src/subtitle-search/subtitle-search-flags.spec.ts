import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { MoviesService } from '@/movies/movies.service';
import { ShowsService } from '@/shows/shows.service';
import { PreferencesService } from '@/preferences/preferences.service';
import { ERROR_KEYS } from '@/i18n/error-keys';

// This suite exists because the three subtitle-search setters are the only
// gate on the Jellyfin requirement: without the media-server check a Plex or no-server install
// stores a flag that can never take effect and the UI reads as enabled, with
// no error anywhere. It runs the real MediaCapabilitiesService over a settings
// map and asserts that nothing is written when the call is refused (Article IX,
// Spec 103, REQ-1 REQ-2 REQ-3).
describe('subtitle search setters', () => {
  describe.each(['none', 'plex', 'jellyfin'])(
    'subtitle search setters with media_server_client=%s',
    (client) => {
      const available = client === 'jellyfin';
      let userUpdate: jest.Mock;
      let userMovieUpdate: jest.Mock;
      let userShowUpdate: jest.Mock;
      let movies: MoviesService;
      let shows: ShowsService;
      let preferences: PreferencesService;

      beforeEach(() => {
        const capabilities = new MediaCapabilitiesService({
          getMap: () => Promise.resolve({ media_server_client: client }),
        } as never);
        userUpdate = jest.fn().mockResolvedValue({});
        userMovieUpdate = jest.fn().mockResolvedValue({});
        userShowUpdate = jest.fn().mockResolvedValue({});
        const prisma = {
          user: { update: userUpdate },
          userMovie: { update: userMovieUpdate },
          userShow: { update: userShowUpdate },
        };
        const stub = {} as never;
        movies = new MoviesService(
          prisma as never,
          stub,
          stub,
          stub,
          stub,
          capabilities,
          stub,
          stub,
          stub,
          stub,
        );
        shows = new ShowsService(
          prisma as never,
          stub,
          stub,
          stub,
          stub,
          stub,
          capabilities,
        );
        preferences = new PreferencesService(
          prisma as never,
          stub,
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

      const expected = available
        ? 'accepted'
        : ERROR_KEYS.SUBTITLE_SEARCH_UNSUPPORTED_MEDIA_SERVER;

      it('setSubtitleSearch', async () => {
        expect(
          await outcome(() => preferences.setSubtitleSearch('u1', true)),
        ).toBe(expected);
        expect(userUpdate).toHaveBeenCalledTimes(available ? 1 : 0);
      });

      it('setMovieSubtitleSearch', async () => {
        expect(
          await outcome(() => movies.setSubtitleSearchFor('u1', 1, true)),
        ).toBe(expected);
        expect(userMovieUpdate).toHaveBeenCalledTimes(available ? 1 : 0);
      });

      it('setShowSubtitleSearch', async () => {
        expect(
          await outcome(() => shows.setSubtitleSearchFor('u1', 1, true)),
        ).toBe(expected);
        expect(userShowUpdate).toHaveBeenCalledTimes(available ? 1 : 0);
      });
    },
  );
});
