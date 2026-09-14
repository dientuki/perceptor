// Injection token: environment.module.ts's factory reads process.env exactly
// once, at module wiring time, rather than environment.service.ts reading it
// directly — mirroring media-roots.types.ts's MEDIA_ROOTS. That lets a future
// spec inject a fixture config instead of mutating process.env, the same
// property media-roots.service.spec.ts relies on.
export const ENVIRONMENT_CONFIG = 'ENVIRONMENT_CONFIG';

// The four routed services, in the exact order the contract fixes
// (endpoints[] renders in this order — see ../plan.md § Steps 4).
export type EnvironmentEndpointId = 'web' | 'api' | 'torrent' | 'indexer';

// Already-parsed inputs: the factory in environment.module.ts owns every
// string -> boolean / string -> int / '' -> null conversion, so this service
// never sees a raw process.env string.
export type EnvironmentConfig = {
  useTraefik: boolean;
  domain: string | null;
  ports: Record<EnvironmentEndpointId, number | null>;
};
