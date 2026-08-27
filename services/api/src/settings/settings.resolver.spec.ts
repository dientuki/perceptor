import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { IS_PUBLIC_KEY } from '@/auth/decorators/public.decorator';
import { SettingsResolver } from './settings.resolver';

// This suite exists because otherwise a guard applied at the wrong level
// fails with no error anywhere except on an anonymous request: a class-level
// `AdminGuard` on this resolver would reach `defaultUiLocale` even though it
// carries `@Public()` (only `JwtAuthGuard` reads that decorator), throwing on
// every logged-out visit to `/login` — exactly the population that has no
// way to report it. Asserting this by calling the resolver would not catch
// it, since a mock guard context would let any credential through; this
// reads the metadata Nest actually attaches to each method instead, the same
// technique `ffprobe-logs.resolver.spec.ts` uses for the same reason.
describe('SettingsResolver guard wiring', () => {
  const isPublic = (methodName: keyof SettingsResolver) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, SettingsResolver.prototype[methodName]) === true;

  const requiresAdmin = (methodName: keyof SettingsResolver) => {
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, SettingsResolver) ?? [];
    const methodGuards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, SettingsResolver.prototype[methodName]) ?? [];
    return classGuards.includes(AdminGuard) || methodGuards.includes(AdminGuard);
  };

  it('guards settings with AdminGuard', () => {
    expect(requiresAdmin('settings')).toBe(true);
  });

  it('guards updateSettings with AdminGuard', () => {
    expect(requiresAdmin('updateSettings')).toBe(true);
  });

  it('leaves defaultUiLocale free of AdminGuard and marks it @Public()', () => {
    expect(requiresAdmin('defaultUiLocale')).toBe(false);
    expect(isPublic('defaultUiLocale')).toBe(true);
  });

  it('does not mark the admin-only operations as @Public()', () => {
    expect(isPublic('settings')).toBe(false);
    expect(isPublic('updateSettings')).toBe(false);
  });
});
