import { SetMetadata } from '@nestjs/common';

export const ALLOW_SERVICE_KEY = 'allowService';

/**
 * Marks a resolver as reachable with a service (machine) credential, not
 * just a user session. Applied per method, never per class — see
 * `JwtAuthGuard` for the enforcement and `docs/spec/graphql-contract.md`
 * for the exact list this is allowed to grow.
 */
export const AllowService = () => SetMetadata(ALLOW_SERVICE_KEY, true);
