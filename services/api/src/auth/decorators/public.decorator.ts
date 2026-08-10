import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a resolver as reachable without a credential. `JwtAuthGuard` checks
 * this before it does anything else — `login` is the only operation that
 * should ever carry it (REQ-4).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
