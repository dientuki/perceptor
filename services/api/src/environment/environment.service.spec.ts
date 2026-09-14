import { Test, TestingModule } from '@nestjs/testing';
import { EnvironmentService } from './environment.service';
import { ENVIRONMENT_CONFIG, EnvironmentConfig } from './environment.types';

// This suite defends against two failures that would otherwise surface as no
// error anywhere, only a broken uploader far downstream:
//
// 1. A fabricated host in port mode. With `useTraefik: false` (or a null
//    domain even in Traefik mode), nothing in this service may guess a host
//    for `endpoints[].url`/`expectedUploadEndpoint` — a stray `?? 'localhost'`
//    or `?? domain` would make the panel confidently recommend
//    `http://api.null/uploads` or a `localhost` URL that only works for the
//    admin's own browser (../plan.md § Risks, row 1 / NFR-1).
// 2. A leaked secret. `environmentInfo` is an admin-only read over process
//    env; the only thing standing between it and a wholesale `process.env`
//    dump is this service returning exactly the allowlisted keys. A
//    convenient extra field (a `databaseUrl`, a raw port-0 instead of null)
//    would be invisible on an admin-only screen with no test to catch it.
describe('EnvironmentService', () => {
  async function build(config: EnvironmentConfig): Promise<EnvironmentService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService, { provide: ENVIRONMENT_CONFIG, useValue: config }],
    }).compile();
    return module.get<EnvironmentService>(EnvironmentService);
  }

  describe('port mode (useTraefik: false)', () => {
    it('never derives a URL for any endpoint, even with a domain set', async () => {
      const service = await build({
        useTraefik: false,
        domain: 'perceptor.local',
        ports: { web: 3000, api: 4000, torrent: 8080, indexer: 9696 },
      });

      const info = service.getInfo();

      expect(info.endpoints.every((e) => e.url === null)).toBe(true);
      expect(info.expectedUploadEndpoint).toBeNull();
    });

    it('still reports the domain and ports as-is', async () => {
      const service = await build({
        useTraefik: false,
        domain: 'perceptor.local',
        ports: { web: 3000, api: 4000, torrent: 8080, indexer: 9696 },
      });

      const info = service.getInfo();

      expect(info.domain).toBe('perceptor.local');
      expect(info.endpoints.find((e) => e.id === 'web')?.port).toBe(3000);
    });
  });

  describe('the allowlist (AC-8)', () => {
    it('returns exactly the contract keys at the top level and per endpoint', async () => {
      const service = await build({
        useTraefik: true,
        domain: 'perceptor.local',
        ports: { web: 3000, api: 4000, torrent: 8080, indexer: 9696 },
      });

      const info = service.getInfo() as unknown as Record<string, unknown>;

      expect(Object.keys(info).sort()).toEqual(
        ['domain', 'endpoints', 'expectedUploadEndpoint', 'useTraefik'].sort(),
      );

      for (const endpoint of info.endpoints as Record<string, unknown>[]) {
        expect(Object.keys(endpoint).sort()).toEqual(['id', 'port', 'url'].sort());
      }
    });
  });

  describe('Traefik mode (useTraefik: true, domain set)', () => {
    it('derives all four URLs and expectedUploadEndpoint from the domain', async () => {
      const service = await build({
        useTraefik: true,
        domain: 'perceptor.local',
        ports: { web: 3000, api: 4000, torrent: 8080, indexer: 9696 },
      });

      const info = service.getInfo();

      expect(info.endpoints).toEqual([
        { id: 'web', port: 3000, url: 'http://perceptor.local' },
        { id: 'api', port: 4000, url: 'http://api.perceptor.local' },
        { id: 'torrent', port: 8080, url: 'http://torrent.perceptor.local' },
        { id: 'indexer', port: 9696, url: 'http://indexer.perceptor.local' },
      ]);
      expect(info.expectedUploadEndpoint).toBe('http://api.perceptor.local/uploads');
    });

    it('still yields null URLs when the domain is null — never http://api.null/uploads', async () => {
      const service = await build({
        useTraefik: true,
        domain: null,
        ports: { web: 3000, api: 4000, torrent: 8080, indexer: 9696 },
      });

      const info = service.getInfo();

      expect(info.endpoints.every((e) => e.url === null)).toBe(true);
      expect(info.expectedUploadEndpoint).toBeNull();
      // The specific bug this guards against: a null domain interpolated
      // straight into the template string rather than short-circuited.
      expect(JSON.stringify(info)).not.toContain('null.local');
      expect(JSON.stringify(info)).not.toContain('.null');
    });
  });

  describe('ports', () => {
    it('reads an unset port as null, not 0', async () => {
      const service = await build({
        useTraefik: true,
        domain: 'perceptor.local',
        ports: { web: 3000, api: 4000, torrent: null, indexer: 9696 },
      });

      const info = service.getInfo();

      expect(info.endpoints.find((e) => e.id === 'torrent')?.port).toBeNull();
    });
  });
});
