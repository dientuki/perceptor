import { Module } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { EnvironmentResolver } from './environment.resolver';
import { ENVIRONMENT_CONFIG, EnvironmentConfig } from './environment.types';

// Reads process.env exactly here, never inside the service — same reason as
// media-roots.module.ts's buildMediaRoots: so a spec can inject a fixture
// config instead of mutating process.env. This function's env var list is
// the allowlist NFR-2 requires (055-environment-panel) — it must never grow
// beyond these six names.
function buildEnvironmentConfig(): EnvironmentConfig {
  return {
    useTraefik: process.env.USE_TRAEFIK === 'true',
    domain: process.env.DOMAIN || null,
    ports: {
      web: parsePort(process.env.WEB_PORT),
      api: parsePort(process.env.PORT),
      torrent: parsePort(process.env.QBITTORRENT_WEBUI_PORT),
      indexer: parsePort(process.env.INDEXER_PORT),
    },
  };
}

function parsePort(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

@Module({
  providers: [
    EnvironmentResolver,
    EnvironmentService,
    { provide: ENVIRONMENT_CONFIG, useFactory: buildEnvironmentConfig },
  ],
})
export class EnvironmentModule {}
