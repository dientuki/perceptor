import { ForbiddenException } from '@nestjs/common';
import { MediaResolver } from './media.resolver';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchService } from './media-search.service';
import { PopularMediaService } from './popular-media.service';
import { MediaCapabilitiesService } from './media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { AuthPrincipal } from '@/auth/auth.types';

// This suite exists because otherwise a disabled media type would keep
// answering `searchMedia`/`popularMedia`/`addMedia` with no error anywhere —
// the switch in Settings → Media Manager would be pure decoration for these
// three entry points, exactly the bug 045-media-type-availability/spec.md
// describes. It also defends the ordering the api/plan.md calls out
// explicitly: a genuinely unsupported type must still surface
// `MEDIA_UNSUPPORTED_TYPE`, never `MEDIA_TYPE_DISABLED` — a capability check
// that ran ahead of `MediaDispatchService.resolve()` and swallowed every type
// indiscriminately would fail this silently, since both are just
// "the mutation didn't happen".
describe('MediaResolver capability enforcement', () => {
  const principal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };

  const buildResolver = () => {
    const mediaDispatch = {
      resolve: jest.fn(),
    } as unknown as MediaDispatchService;
    const mediaSearch = {
      searchAll: jest.fn(),
    } as unknown as MediaSearchService;
    const popularMediaService = {
      list: jest.fn(),
    } as unknown as PopularMediaService;
    const mediaCapabilitiesService = {
      read: jest.fn(),
      assertEnabled: jest.fn(),
    } as unknown as MediaCapabilitiesService;

    const resolver = new MediaResolver(
      mediaDispatch,
      mediaSearch,
      popularMediaService,
      mediaCapabilitiesService,
    );

    return { resolver, mediaDispatch, mediaSearch, popularMediaService, mediaCapabilitiesService };
  };

  it('refuses searchMedia for a disabled type before dispatching', async () => {
    const { resolver, mediaDispatch, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: 'show' } } }),
    );

    await expect(resolver.searchMedia('query', 'show', principal)).rejects.toThrow(ForbiddenException);
    expect(mediaDispatch.resolve).not.toHaveBeenCalled();
  });

  it('refuses popularMedia for a disabled type before listing', async () => {
    const { resolver, popularMediaService, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: 'show' } } }),
    );

    await expect(resolver.popularMedia('show', principal)).rejects.toThrow(ForbiddenException);
    expect(popularMediaService.list).not.toHaveBeenCalled();
  });

  it('refuses addMedia for a disabled type before registering', async () => {
    const { resolver, mediaDispatch, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: 'show' } } }),
    );

    await expect(resolver.addMedia(1399, 'show', principal)).rejects.toThrow(ForbiddenException);
    expect(mediaDispatch.resolve).not.toHaveBeenCalled();
  });

  it('lets an enabled type reach the underlying service', async () => {
    const { resolver, mediaDispatch, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.assertEnabled as jest.Mock).mockResolvedValue(undefined);
    const register = jest.fn().mockResolvedValue({ id: 'm1' });
    (mediaDispatch.resolve as jest.Mock).mockReturnValue({ register });

    await resolver.addMedia(1399, 'movie', principal);

    expect(mediaCapabilitiesService.assertEnabled).toHaveBeenCalledWith('movie');
    expect(register).toHaveBeenCalledWith(1399, 'u1');
  });

  // The ordering guarantee itself: a bogus type must still fail as
  // "unsupported", not as "disabled" — even though the resolver calls
  // `assertEnabled` first, `MediaCapabilitiesService.assertEnabled` (T002)
  // returns silently for a type it doesn't recognise, so the real
  // `MediaDispatchService.resolve()` behaviour is exercised end to end here
  // rather than stubbed away.
  it('still surfaces MEDIA_UNSUPPORTED_TYPE for an unsupported type, not MEDIA_TYPE_DISABLED', async () => {
    const realDispatch = new MediaDispatchService(
      {} as never,
      {} as never,
    );
    const mediaSearch = { searchAll: jest.fn() } as unknown as MediaSearchService;
    const popularMediaService = { list: jest.fn() } as unknown as PopularMediaService;
    const mediaCapabilitiesService = {
      read: jest.fn(),
      assertEnabled: jest.fn().mockResolvedValue(undefined),
    } as unknown as MediaCapabilitiesService;

    const resolver = new MediaResolver(realDispatch, mediaSearch, popularMediaService, mediaCapabilitiesService);

    await expect(resolver.addMedia(1399, 'bogus', principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_UNSUPPORTED_TYPE } },
    });
  });

  it('mediaCapabilities requires no admin guard and reads from the service', async () => {
    const { resolver, mediaCapabilitiesService } = buildResolver();
    (mediaCapabilitiesService.read as jest.Mock).mockResolvedValue({
      moviesEnabled: true,
      showsEnabled: false,
    });

    const result = await resolver.mediaCapabilities();

    expect(result).toEqual({ moviesEnabled: true, showsEnabled: false });
  });
});
