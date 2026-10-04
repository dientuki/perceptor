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
      // Spec 055, REQ-6; Spec 055, NFR-1
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
