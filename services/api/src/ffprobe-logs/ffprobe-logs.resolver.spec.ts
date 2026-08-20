import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ALLOW_SERVICE_KEY } from '@/auth/decorators/allow-service.decorator';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { FfprobeLogsResolver } from './ffprobe-logs.resolver';

// This suite exists because otherwise a guard miswiring on this resolver
// fails with no error anywhere: AdminGuard reaching recordFfprobe would
// reject the worker's SERVICE_TOKEN, and the worker swallows that rejection
// by design (NFR-1) — the table would just silently stay empty forever.
// The inverse is just as dangerous: @AllowService() leaking onto a read
// would let the worker's machine credential read or delete admin-only rows.
// Asserting this by calling the resolver would not catch it — a mock guard
// context would happily let either credential through — so this reads the
// metadata Nest actually attaches to each method instead.
//
// `requiresAdmin` reads *both* the class/constructor target and the method
// target, because Nest's `GuardsConsumer` resolves guards from both when a
// request actually runs (`getAllAndOverride`-style merge). A helper reading
// method metadata only would report `false` for `recordFfprobe` even if
// `@UseGuards(AdminGuard)` were copied onto the class — exactly the mistake
// `plan.md` § Risks warns about (an implementer copying `UsersResolver`'s
// class-level placement) — and the one test meant to catch that would pass
// right through it. Do not "simplify" this back to method-only.
describe('FfprobeLogsResolver guard wiring', () => {
  const allowsService = (methodName: keyof FfprobeLogsResolver) =>
    Reflect.getMetadata(ALLOW_SERVICE_KEY, FfprobeLogsResolver.prototype[methodName]) === true;

  const requiresAdmin = (methodName: keyof FfprobeLogsResolver) => {
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, FfprobeLogsResolver) ?? [];
    const methodGuards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, FfprobeLogsResolver.prototype[methodName]) ?? [];
    return classGuards.includes(AdminGuard) || methodGuards.includes(AdminGuard);
  };

  it('marks recordFfprobe as service-reachable and not admin-guarded', () => {
    expect(allowsService('recordFfprobe')).toBe(true);
    expect(requiresAdmin('recordFfprobe')).toBe(false);
  });

  it('guards ffprobeLogs with AdminGuard and not @AllowService()', () => {
    expect(requiresAdmin('ffprobeLogs')).toBe(true);
    expect(allowsService('ffprobeLogs')).toBe(false);
  });

  it('guards ffprobeLog with AdminGuard and not @AllowService()', () => {
    expect(requiresAdmin('ffprobeLog')).toBe(true);
    expect(allowsService('ffprobeLog')).toBe(false);
  });

  it('guards deleteFfprobeLog with AdminGuard and not @AllowService()', () => {
    expect(requiresAdmin('deleteFfprobeLog')).toBe(true);
    expect(allowsService('deleteFfprobeLog')).toBe(false);
  });
});
