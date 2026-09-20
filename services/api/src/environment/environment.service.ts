import { Inject, Injectable } from '@nestjs/common';
import { EnvironmentInfo, EnvironmentEndpoint } from './entities/environment-info.entity';
import { ENVIRONMENT_CONFIG } from './environment.types';
import type { EnvironmentConfig, EnvironmentEndpointId } from './environment.types';

// The order the contract fixes: web, api, torrent, indexer
// (../plan.md § Steps 4 — web renders the list as given).
const ENDPOINT_IDS: EnvironmentEndpointId[] = ['web', 'api', 'torrent', 'indexer'];

@Injectable()
export class EnvironmentService {
  constructor(@Inject(ENVIRONMENT_CONFIG) private readonly config: EnvironmentConfig) {}

  getInfo(): EnvironmentInfo {
    const { useTraefik, domain } = this.config;
    const canDeriveUrls = useTraefik && domain !== null;

    const useHttps = canDeriveUrls && this.config.useHttps;
    const scheme = useHttps ? 'https' : 'http';

    const endpoints: EnvironmentEndpoint[] = ENDPOINT_IDS.map((id) => ({
      id,
      port: this.config.ports[id],
      url: canDeriveUrls ? this.buildUrl(scheme, id, domain) : null,
    }));

    return {
      useTraefik,
      useHttps,
      domain,
      endpoints,
      // <scheme>://api.<domain>/uploads — what REQ-6 compares the loaded
      // PUBLIC_UPLOAD_URL (web-only) against. No fallback host, ever: null
      // is the specified answer in port mode or with no domain (NFR-1).
      expectedUploadEndpoint: canDeriveUrls ? `${scheme}://api.${domain}/uploads` : null,
    };
  }

  // http://<domain> for web, http://<id>.<domain> for the other three.
  // Only called once canDeriveUrls is already true, so `domain` here is
  // guaranteed non-null.
  private buildUrl(scheme: 'http' | 'https', id: EnvironmentEndpointId, domain: string): string {
    return id === 'web' ? `${scheme}://${domain}` : `${scheme}://${id}.${domain}`;
  }
}
