import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '@/auth/guards/admin.guard';
import type { AuthPrincipal } from '@/auth/auth.types';
import { SubtitleEmbedResolver } from './subtitle-embed.resolver';

function guardsOf(method: keyof SubtitleEmbedResolver): unknown[] {
  const handler = Object.getOwnPropertyDescriptor(
    SubtitleEmbedResolver.prototype,
    method,
  )?.value as object;
  return (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [];
}

// This suite exists because the three worker-facing mutations and the details
// query carry @AllowService(), which opens them to the machine credential and
// is easy to widen by accident: if a user principal were accepted, any logged-in
// user could mark someone's embed COMPLETED or read container paths, with no
// error anywhere. The two admin mutations must keep AdminGuard per method for
// the same reason; dropping it leaves a non-administrator able to rewrite a
// library file (Article IX, Spec 101, REQ-3).
describe('SubtitleEmbedResolver', () => {
  const service = {
    started: jest.fn().mockResolvedValue(true),
    completed: jest.fn().mockResolvedValue(true),
    failed: jest.fn().mockResolvedValue(true),
    details: jest.fn().mockResolvedValue({ id: 1 }),
    embedMovie: jest.fn(),
    embedEpisode: jest.fn(),
  };
  const resolver = new SubtitleEmbedResolver(service as never);
  const user: AuthPrincipal = {
    type: 'user',
    id: 'u',
    username: 'u',
    jti: 'j',
  };
  const worker: AuthPrincipal = { type: 'service', name: 'worker' };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      'subtitleEmbedStarted',
      (p: AuthPrincipal) => resolver.subtitleEmbedStarted(1, p),
    ],
    [
      'subtitleEmbedCompleted',
      (p: AuthPrincipal) => resolver.subtitleEmbedCompleted(1, null, p),
    ],
    [
      'subtitleEmbedFailed',
      (p: AuthPrincipal) => resolver.subtitleEmbedFailed(1, 'k', p),
    ],
    [
      'subtitleEmbedDetails',
      (p: AuthPrincipal) => resolver.subtitleEmbedDetails(1, p),
    ],
  ])(
    '%s refuses a user principal and reaches the service for the worker',
    async (_name, call) => {
      expect(() => call(user)).toThrow();
      expect(service.started).not.toHaveBeenCalled();
      expect(service.completed).not.toHaveBeenCalled();
      expect(service.failed).not.toHaveBeenCalled();
      expect(service.details).not.toHaveBeenCalled();

      await expect(call(worker)).resolves.toBeDefined();
    },
  );

  it.each(['embedMovieSubtitles', 'embedEpisodeSubtitles'] as const)(
    '%s is guarded by AdminGuard',
    (method) => {
      expect(guardsOf(method)).toContain(AdminGuard);
    },
  );

  it.each([
    'subtitleEmbedStarted',
    'subtitleEmbedCompleted',
    'subtitleEmbedFailed',
    'subtitleEmbedDetails',
  ] as const)(
    '%s is not behind AdminGuard, since the worker has no user',
    (method) => {
      expect(guardsOf(method)).not.toContain(AdminGuard);
    },
  );
});
