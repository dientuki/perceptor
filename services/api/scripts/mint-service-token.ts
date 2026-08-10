// Mints the one credential the worker and the qBittorrent AutoRun hook
// authenticate with (REQ-5). Run standalone via `npm run token:service`, not
// through Nest's DI — a machine credential is a one-off artifact, not a
// request-scoped concern, and this script is meant to be pipeable straight
// into `.env` (see bin/install), so its only stdout output is the token
// itself.
//
// Relative import into src/, matching prisma/seeds/index.ts's convention:
// this script runs via bare `ts-node`, with no tsconfig-paths register step,
// so the `@/*` alias used inside src/ is not available here.
import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from '../src/auth/auth.constants';

function main() {
  const jwtService = new JwtService({ secret: getJwtSecret() });

  // No `expiresIn`: a service credential never expires (see auth.types.ts —
  // service principals carry no `jti` and are never subjected to the
  // session check for exactly this reason). No `jti` either — nothing ever
  // revokes it individually; rotating JWT_SECRET is what invalidates it.
  const token = jwtService.sign({ sub: 'service:perceptor', typ: 'service' });

  process.stdout.write(`${token}\n`);
}

main();
