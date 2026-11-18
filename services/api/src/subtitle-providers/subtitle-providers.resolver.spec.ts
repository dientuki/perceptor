import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { SubtitleProvidersResolver } from './subtitle-providers.resolver';

// This suite exists because otherwise a provider operation shipped without its
// guard answers any signed-in user with no error anywhere: a regular user
// could add or remove the installation's subtitle accounts. A mock guard
// context would let any credential through, so this reads the metadata Nest
// attaches to each method, the same technique as settings.resolver.spec.ts.
describe('SubtitleProvidersResolver guard wiring', () => {
  it.each([
    'subtitleProviders',
    'saveSubtitleProvider',
    'removeSubtitleProvider',
    'setSubtitleProviderLanguages',
  ] as const)('guards %s with AdminGuard', (method) => {
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, SubtitleProvidersResolver.prototype[method]) ?? [];
    expect(guards).toContain(AdminGuard);
  });
});
