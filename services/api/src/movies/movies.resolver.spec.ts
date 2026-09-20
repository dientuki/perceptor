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

// This suite exists for the same reason as setMovieShort's above: a resolver
// that read the film before checking assertEnabled(MOVIE) would leak whether
// movieId exists to a caller in an installation with movies turned off, even
// though content kind itself has no capability flag of its own
// (057-content-kind-classification's frozen contract has no
// assertShortsEnabled-style analogue here).
describe('MoviesResolver.setMovieContentKind guard order', () => {
  const principal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };

  const buildResolver = () => {
    const moviesService = {
      setContentKind: jest.fn(),
    } as unknown as MoviesService;
    const languagesService = {} as unknown as LanguagesService;
    const mediaCapabilitiesService = {
      assertEnabled: jest.fn(),
    } as unknown as MediaCapabilitiesService;

    const resolver = new MoviesResolver(moviesService, languagesService, mediaCapabilitiesService);

    return { resolver, moviesService, mediaCapabilitiesService };
  };

  it('refuses with error.media.type_disabled before the service is ever called, when movies are disabled', async () => {
    const { resolver, moviesService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: MEDIA_TYPE.MOVIE } } }),
    );

    await expect(
      resolver.setMovieContentKind(7, 'ANIME' as never, principal),
    ).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED } },
    });
    expect(moviesService.setContentKind).not.toHaveBeenCalled();
  });

  it('dispatches to the service once the capability guard passes', async () => {
    const { resolver, moviesService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockResolvedValue(undefined);
    (moviesService.setContentKind as jest.Mock).mockResolvedValue({ id: 7, contentKind: 'ANIME' });

    const result = await resolver.setMovieContentKind(7, 'ANIME' as never, principal);

    expect(mediaCapabilitiesService.assertEnabled).toHaveBeenCalledWith(MEDIA_TYPE.MOVIE);
    expect(moviesService.setContentKind).toHaveBeenCalledWith(7, 'u1', 'ANIME');
    expect(result).toEqual({ id: 7, contentKind: 'ANIME' });
  });
});

// This suite exists because a removeMovie that read the film before
// assertEnabled(MOVIE) would tell a caller in an installation with movies
// off whether an id exists, and one that skipped the guard would let a
// disabled type still be deleted — the refusal looks like any other failure.
describe('MoviesResolver.removeMovie', () => {
  const principal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };

  const build = () => {
    const moviesService = { remove: jest.fn() } as unknown as MoviesService;
    const caps = { assertEnabled: jest.fn() } as unknown as MediaCapabilitiesService;
    const resolver = new MoviesResolver(moviesService, {} as unknown as LanguagesService, caps);
    return { resolver, moviesService, caps };
  };

  it('refuses with error.media.type_disabled before the service is touched when movies are disabled', async () => {
    const { resolver, moviesService, caps } = build();
    (caps.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: MEDIA_TYPE.MOVIE } } }),
    );

    await expect(resolver.removeMovie(7, principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED } },
    });
    expect(moviesService.remove).not.toHaveBeenCalled();
  });

  it('dispatches to the service with the caller id once enabled', async () => {
    const { resolver, moviesService, caps } = build();
    (caps.assertEnabled as jest.Mock).mockResolvedValue(undefined);
    (moviesService.remove as jest.Mock).mockResolvedValue({ deleted: true, remainingOwners: 0 });

    await expect(resolver.removeMovie(7, principal)).resolves.toEqual({ deleted: true, remainingOwners: 0 });
    expect(caps.assertEnabled).toHaveBeenCalledWith(MEDIA_TYPE.MOVIE);
    expect(moviesService.remove).toHaveBeenCalledWith(7, 'u1');
  });
});
