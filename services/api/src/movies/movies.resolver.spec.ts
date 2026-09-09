import { ForbiddenException } from '@nestjs/common';
import { MoviesResolver } from './movies.resolver';
import { MoviesService } from './movies.service';
import { LanguagesService } from '@/languages/languages.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MEDIA_TYPE } from '@/types/media';
import type { AuthPrincipal } from '@/auth/auth.types';

// This suite exists because otherwise setMovieShort's guard order would be
// untestable from movies.service.spec.ts alone: a resolver that checked
// assertShortsEnabled() before assertEnabled(MOVIE) would return
// error.media.shorts_disabled to a caller with movies off, contradicting the
// error table in 048-shorts-category/spec.md — both refusals look identical
// from the outside (the mutation just fails), so only asserting the call
// order catches a swap.
describe('MoviesResolver.setMovieShort guard order', () => {
  const principal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };

  const buildResolver = () => {
    const moviesService = {
      setShort: jest.fn(),
    } as unknown as MoviesService;
    const languagesService = {} as unknown as LanguagesService;
    const mediaCapabilitiesService = {
      assertEnabled: jest.fn(),
      assertShortsEnabled: jest.fn(),
    } as unknown as MediaCapabilitiesService;

    const resolver = new MoviesResolver(moviesService, languagesService, mediaCapabilitiesService);

    return { resolver, moviesService, mediaCapabilitiesService };
  };

  it('refuses with error.media.type_disabled before checking shorts, when movies are disabled', async () => {
    const { resolver, moviesService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: MEDIA_TYPE.MOVIE } } }),
    );

    await expect(resolver.setMovieShort(7, true, principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED } },
    });
    expect(mediaCapabilitiesService.assertShortsEnabled).not.toHaveBeenCalled();
    expect(moviesService.setShort).not.toHaveBeenCalled();
  });

  it('refuses with error.media.shorts_disabled once movies are enabled but shorts are not', async () => {
    const { resolver, moviesService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockResolvedValue(undefined);
    (mediaCapabilitiesService.assertShortsEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_SHORTS_DISABLED } }),
    );

    await expect(resolver.setMovieShort(7, true, principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_SHORTS_DISABLED } },
    });
    expect(moviesService.setShort).not.toHaveBeenCalled();
  });

  it('dispatches to the service once both guards pass', async () => {
    const { resolver, moviesService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockResolvedValue(undefined);
    (mediaCapabilitiesService.assertShortsEnabled as jest.Mock).mockResolvedValue(undefined);
    (moviesService.setShort as jest.Mock).mockResolvedValue({ id: 7, isShort: true });

    const result = await resolver.setMovieShort(7, true, principal);

    expect(mediaCapabilitiesService.assertEnabled).toHaveBeenCalledWith(MEDIA_TYPE.MOVIE);
    expect(moviesService.setShort).toHaveBeenCalledWith(7, 'u1', true);
    expect(result).toEqual({ id: 7, isShort: true });
  });
});
