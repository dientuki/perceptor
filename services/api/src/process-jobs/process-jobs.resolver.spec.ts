import { UnauthorizedException } from '@nestjs/common';
import { ProcessJobsResolver } from './process-jobs.resolver';
import { ProcessJobsService } from './process-jobs.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { AuthPrincipal } from '@/auth/auth.types';

// This suite exists because otherwise encodeWorkerStarted's user-rejection
// would be untestable anywhere else: @AllowService() only widens access to
// service principals, it does not narrow it away from users (spec.md,
// GraphQL Contract Delta), so the whole safety argument for this
// no-argument, trust-the-caller mutation rests on the explicit
// `principal.type !== 'service'` check inside the resolver body. If that
// check regressed, any signed-in user could reset a running encode's row
// and burn its recovery allowance, and nothing else in the stack would ever
// notice or log an error.
describe('ProcessJobsResolver.encodeWorkerStarted', () => {
  const userPrincipal: AuthPrincipal = { type: 'user', id: 'u1', username: 'alice', jti: 'session-1' };
  const servicePrincipal: AuthPrincipal = { type: 'service', name: 'worker' };

  const buildResolver = () => {
    const processJobsService = {
      reconcileOrphanedEncodes: jest.fn(),
    } as unknown as ProcessJobsService;

    const resolver = new ProcessJobsResolver(processJobsService);

    return { resolver, processJobsService };
  };

  it('refuses a user principal with error.auth.unauthenticated and never touches ProcessJob rows', async () => {
    const { resolver, processJobsService } = buildResolver();

    let caught: unknown;
    try {
      await resolver.encodeWorkerStarted(userPrincipal);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(caught).toMatchObject({ response: { i18n: { key: ERROR_KEYS.AUTH_UNAUTHENTICATED } } });
    expect(processJobsService.reconcileOrphanedEncodes).not.toHaveBeenCalled();
  });

  it('delegates to the service and returns its count for a service principal', async () => {
    const { resolver, processJobsService } = buildResolver();
    (processJobsService.reconcileOrphanedEncodes as jest.Mock).mockResolvedValue(3);

    const result = await resolver.encodeWorkerStarted(servicePrincipal);

    expect(processJobsService.reconcileOrphanedEncodes).toHaveBeenCalledWith();
    expect(result).toBe(3);
  });
});
