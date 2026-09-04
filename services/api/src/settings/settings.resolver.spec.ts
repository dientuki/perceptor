import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { IS_PUBLIC_KEY } from '@/auth/decorators/public.decorator';
import { SettingsResolver } from './settings.resolver';
import { SettingsService } from './settings.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import { SchedulerService } from '@/scheduler/scheduler.service';

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

// This suite exists because otherwise flipping `movies_enabled`/
// `shows_enabled` off would leave that media type's scheduled task armed and
// firing on its old cron until the next process restart, behind a UI that
// correctly reports the task as unavailable — no error, no log line
// anywhere (045-media-type-availability, api/plan.md § Steps 10).
describe('SettingsResolver updateSettings re-arm guard', () => {
  const buildResolver = (before: Record<string, string>) => {
    const settingsService = {
      getMap: jest.fn().mockResolvedValue(before),
      updateMany: jest.fn().mockResolvedValue([]),
    } as unknown as SettingsService;
    const qbittorrentClient = {
      setSavePath: jest.fn(),
    } as unknown as QbittorrentClient;
    const mediaRootsService = {
      resolveFromRoot: jest.fn(),
    } as unknown as MediaRootsService;
    const mediaServerIndex = {
      rebuild: jest.fn(),
    } as unknown as MediaServerIndexService;
    const schedulerService = {
      arm: jest.fn().mockResolvedValue(undefined),
    } as unknown as SchedulerService;

    const resolver = new SettingsResolver(
      settingsService,
      qbittorrentClient,
      mediaRootsService,
      mediaServerIndex,
      schedulerService,
    );

    return { resolver, schedulerService };
  };

  it('calls arm() when a submission changes only movies_enabled', async () => {
    const { resolver, schedulerService } = buildResolver({
      movies_enabled: 'true',
    });

    await resolver.updateSettings([{ key: 'movies_enabled', value: 'false' }]);

    expect(schedulerService.arm).toHaveBeenCalledTimes(1);
  });

  it('calls arm() when a submission changes only shows_enabled', async () => {
    const { resolver, schedulerService } = buildResolver({
      shows_enabled: 'true',
    });

    await resolver.updateSettings([{ key: 'shows_enabled', value: 'false' }]);

    expect(schedulerService.arm).toHaveBeenCalledTimes(1);
  });

  it('does not call arm() when the submission does not change movies_enabled/shows_enabled', async () => {
    const { resolver, schedulerService } = buildResolver({
      movies_enabled: 'true',
      some_other_key: 'x',
    });

    await resolver.updateSettings([{ key: 'some_other_key', value: 'y' }]);

    expect(schedulerService.arm).not.toHaveBeenCalled();
  });
});
