import { ForbiddenException } from '@nestjs/common';
import { ShowsResolver } from './shows.resolver';
import { ShowsService } from './shows.service';
import { LanguagesService } from '@/languages/languages.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MEDIA_TYPE } from '@/types/media';
import type { AuthPrincipal } from '@/auth/auth.types';

// This suite exists because a removeShow that read the series before
// assertEnabled(SHOW) would tell a caller in an installation with series off
// whether an id exists, one that skipped the guard would still delete a
// disabled type, and one that skipped the ownership gate would let a user
// remove another user's series — every one of those looks like an ordinary
// failure or success from the outside.
describe('ShowsResolver.removeShow', () => {
  const principal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };

  const build = () => {
    const showsService = { findOneFromDb: jest.fn(), remove: jest.fn() };
    const caps = { assertEnabled: jest.fn() };
    const resolver = new ShowsResolver(
      showsService as unknown as ShowsService,
      {} as unknown as LanguagesService,
      caps as unknown as MediaCapabilitiesService,
    );
    return { resolver, showsService, caps };
  };

  it('refuses with error.media.type_disabled before reading the series when shows are disabled', async () => {
    const { resolver, showsService, caps } = build();
    caps.assertEnabled.mockRejectedValue(
      new ForbiddenException({ i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED, params: { type: MEDIA_TYPE.SHOW } } }),
    );

    await expect(resolver.removeShow(5, principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.MEDIA_TYPE_DISABLED } },
    });
    expect(showsService.findOneFromDb).not.toHaveBeenCalled();
    expect(showsService.remove).not.toHaveBeenCalled();
  });

  it('refuses a series the caller does not own with error.show.not_available and removes nothing', async () => {
    const { resolver, showsService, caps } = build();
    caps.assertEnabled.mockResolvedValue(undefined);
    showsService.findOneFromDb.mockResolvedValue(null);

    await expect(resolver.removeShow(5, principal)).rejects.toMatchObject({
      response: { i18n: { key: ERROR_KEYS.SHOW_NOT_AVAILABLE } },
    });
    expect(showsService.remove).not.toHaveBeenCalled();
  });

  it('dispatches to the service with the caller id once enabled and owned', async () => {
    const { resolver, showsService, caps } = build();
    caps.assertEnabled.mockResolvedValue(undefined);
    showsService.findOneFromDb.mockResolvedValue({ id: 5 });
    showsService.remove.mockResolvedValue({ deleted: true, remainingOwners: 0 });

    await expect(resolver.removeShow(5, principal)).resolves.toEqual({ deleted: true, remainingOwners: 0 });
    expect(caps.assertEnabled).toHaveBeenCalledWith(MEDIA_TYPE.SHOW);
    expect(showsService.remove).toHaveBeenCalledWith(5, 'u1');
  });
});
