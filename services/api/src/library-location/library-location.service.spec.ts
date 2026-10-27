import { LibraryLocationService } from './library-location.service';

// This suite exists because the media-server path chain feeds both the manual
// subtitle search and the library track read: if a reason collapses into
// another (or a failure throws), the caller reports the wrong cause, or an
// unreadable file is probed, with no error anywhere.
describe('LibraryLocationService', () => {
  const movie = { kind: 'movie', tmdbId: 7 } as const;
  let client: {
    mediaHostPath?: jest.Mock;
    findByTmdbId: jest.Mock;
  } | null;
  let service: LibraryLocationService;

  beforeEach(() => {
    client = {
      findByTmdbId: jest.fn().mockResolvedValue('ext-1'),
      mediaHostPath: jest.fn().mockResolvedValue('/host/lib/a.mkv'),
    };
    const mediaServer = { createClient: jest.fn(() => Promise.resolve(client)) };
    const mediaRoots = {
      hostToContainerPath: jest.fn((_root: string, p: string) =>
        p.startsWith('/host/lib/') ? p.replace('/host/lib', '/lib') : null,
      ),
    };
    service = new LibraryLocationService(mediaServer as never, mediaRoots as never);
  });

  it('returns the container path for a held title', async () => {
    await expect(service.locate(movie)).resolves.toEqual({ path: '/lib/a.mkv' });
  });

  it('passes season and episode numbers only for an episode', async () => {
    await service.locate({ kind: 'episode', tmdbId: 7, seasonNumber: 2, episodeNumber: 3 });
    expect(client!.mediaHostPath).toHaveBeenCalledWith('ext-1', 2, 3);
    await service.locate({ ...movie });
    expect(client!.mediaHostPath).toHaveBeenLastCalledWith('ext-1', undefined, undefined);
  });

  it('reports no_client without a client or without mediaHostPath', async () => {
    client = null;
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'no_client' });
    client = { findByTmdbId: jest.fn() };
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'no_client' });
  });

  it('reports not_held when the server does not know the title or the file', async () => {
    client!.findByTmdbId.mockResolvedValue(null);
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'not_held' });
    client!.findByTmdbId.mockResolvedValue('ext-1');
    client!.mediaHostPath!.mockResolvedValue(null);
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'not_held' });
  });

  it('reports unavailable instead of throwing when the server fails', async () => {
    client!.findByTmdbId.mockRejectedValue(new Error('boom'));
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'unavailable' });
  });

  it('reports outside_library for a host path outside the library root', async () => {
    client!.mediaHostPath!.mockResolvedValue('/elsewhere/a.mkv');
    await expect(service.locate(movie)).resolves.toEqual({ reason: 'outside_library' });
  });
});
