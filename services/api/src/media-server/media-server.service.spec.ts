// The layout picked here decides how every encode is named on disk. A wrong
// answer files each finished encode under the wrong naming scheme: the job
// reports COMPLETED, the file plays, and the media server's scanner simply
// fails to match it, with no error anywhere. An unknown or absent client must
// degrade to the Jellyfin layout rather than throw, because this runs inside
// getEncodeJobDetails and a throw would fail every encode.

import { MediaServerService } from './media-server.service';

describe('MediaServerService.resolveLibraryLayout', () => {
  const service = new MediaServerService(
    {} as never,
    {} as never,
    {} as never,
  );

  it('returns the jellyfin layout for jellyfin', () => {
    expect(
      service.resolveLibraryLayout({ media_server_client: 'jellyfin' }),
    ).toBe('jellyfin');
  });

  it('returns the plex layout for plex', () => {
    expect(service.resolveLibraryLayout({ media_server_client: 'plex' })).toBe(
      'plex',
    );
  });

  it('falls back to jellyfin for none', () => {
    expect(service.resolveLibraryLayout({ media_server_client: 'none' })).toBe(
      'jellyfin',
    );
  });

  it('falls back to jellyfin when the row is missing', () => {
    expect(service.resolveLibraryLayout({})).toBe('jellyfin');
  });

  it('falls back to jellyfin for an unknown id without throwing', () => {
    expect(
      service.resolveLibraryLayout({ media_server_client: 'kodi' }),
    ).toBe('jellyfin');
    expect(
      service.resolveLibraryLayout({ media_server_client: 'toString' }),
    ).toBe('jellyfin');
  });
});
