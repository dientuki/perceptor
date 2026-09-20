---
title: HTTPS Through Traefik With a Local Certificate Authority — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-09-20
status: Approved
---

# PLAN: HTTPS Through Traefik With a Local Certificate Authority (`plan.md`)

## Approach

Everything HTTPS-specific is produced by **one new one-shot compose service, `certs`**, modelled on
the existing `backup` service in `docker-compose.yaml` (`restart: "no"`, inline `bash -c` script,
`set -euo pipefail`, a dependant gated on `service_completed_successfully`). It runs on the same
`mariadb:12.3.2` image `backup` already pulls — that image ships `openssl` 3.0 (verified:
`/usr/bin/openssl`, OpenSSL 3.0.13), so no new image is pulled and nothing is needed on the host
(NFR-1). The script lives inline in `docker-compose.yaml` because that file is the only thing
`install.sh` downloads (NFR-6); a script file beside it would not reach an end user.

`certs` does three things, idempotently, on every stack start:

1. **CA** — in the host directory `./certs` (bind-mounted into `certs` only): create `ca.key` +
   `ca.crt` if absent, never touch them if present (REQ-3). The CA carries
   `basicConstraints=critical,CA:TRUE,pathlen:0`, `keyUsage=critical,keyCertSign,cRLSign` and
   `nameConstraints=critical,permitted;DNS:${DOMAIN}` (NFR-3 — a DNS constraint of `perceptor.local`
   admits that name and every subdomain, RFC 5280 §4.2.1.10). If an existing CA's constraint does
   not admit the current `DOMAIN`, exit non-zero with the NFR-3 message.
2. **Leaf** — in a named volume `traefik_tls`: (re)issue `cert.pem`/`key.pem` when missing, when
   `openssl x509 -checkend` says it expires within 30 days, or when its SAN is not exactly
   `DNS:${DOMAIN}, DNS:*.${DOMAIN}` (REQ-4). Lifetime 800 days (< 825, NFR-4), `extendedKeyUsage=
   serverAuth`, RSA 2048.
3. **Traefik dynamic config** — write `traefik_tls`'s `dynamic.yml`: the leaf as the default
   certificate, plus four routers on the `websecure` entrypoint with `tls: {}`, one per host, each
   pointing at the service the Docker provider already defines (`web@docker`, `api@docker`,
   `torrent@docker`, `indexer@docker` — the names set by the existing
   `traefik.http.services.<name>.loadbalancer…` labels).

**Why the HTTPS routers live in the file provider and not in Docker labels.** Compose labels cannot
be conditional. A `web-secure` router label on every service would route 443 to the app even with
HTTPS off (served with Traefik's self-signed default), changing today's 443 behaviour and breaking
NFR-5/AC-10. Generating the routers alongside the certificate means *HTTPS off ⇒ no HTTPS router
exists at all*, and the existing `http` labels stay byte-for-byte unchanged (REQ-6).

**Why the leaf is in a named volume and the CA on the host.** NFR-2: `traefik` must never see
`ca.key`, and `traefik` runs in HTTP-only mode too, so it cannot bind-mount a host path that might
not exist (Docker would create it as an empty root-owned directory — a new file on disk, NFR-5).
The named volume is created empty and harmlessly; `./certs` is only ever mounted by `certs`, which
only runs when HTTPS is on.

**Gating.** `certs` sits behind `profiles: [https]`. `traefik` gets
`depends_on: certs: {condition: service_completed_successfully, required: false}` (Compose ≥ 2.20;
the dev host runs 5.5.1) — required when the profile is on, ignored when off. Because a stale
`dynamic.yml` would survive a later switch back to HTTP, `traefik` only loads the file provider when
`USE_HTTPS=true`: its `entrypoint` becomes a short `sh -c` wrapper (the `traefik:v3.7` image is
Alpine, `sh` present — verified) that appends `--providers.file.directory=/tls
--providers.file.watch=true` in that case and `exec`s `traefik`. `watch` is what lets a leaf renewed
by a later `docker compose up -d` take effect without restarting `traefik`.

`certs` runs as root (a fresh `./certs` bind source is created root-owned by the Docker daemon
before the container starts, so a `PUID` user could not write it) and ends by `chown -R
${PUID}:${PGID} /certs`, `chmod 700 /certs`, `chmod 600 /certs/ca.key` — the same "files end up
owned by the host user" outcome `api`/`worker` get through `user:`. It prints the REQ-7 handoff
(host path of `ca.crt`, "install it as a trusted root on every device") only on the run that
created the CA.

**`api`** changes the scheme it derives, not how it derives: `EnvironmentConfig` gains `useHttps`,
read from `USE_HTTPS` in the existing factory, and `EnvironmentService` builds `https://` URLs when
`useTraefik && domain !== null && useHttps`. CORS in `services/api/src/main.ts` adds
`https://${DOMAIN}` to its origin list **unconditionally** — an origin nothing serves is inert, and a
branch here would be a second copy of the "HTTPS in effect" rule (Article X). tus already builds its
`Location` from `X-Forwarded-Proto` (`respectForwardedHeaders: true`,
`services/api/src/uploads/uploads.service.ts`), which Traefik sets, so resumable uploads need no
change.

**`web`** moves the existing, private `isSecureRequest()` out of `services/web/src/actions/auth.ts`
(a `"use server"` file — anything it exports becomes a callable Server Action endpoint, so it cannot
simply be exported there) into a new server-only `src/lib/request-scheme.ts`, and reuses it in
`createUploadTicketAction` to swap `PUBLIC_UPLOAD_URL`'s scheme per request (REQ-9). The Environment
tab gains the HTTPS row, `USE_HTTPS` in the variable list, and a scheme-agnostic comparison
(REQ-9b, REQ-10). `web` does **not** get `USE_HTTPS` in its environment — it has no use for it; the
page's own scheme is the truth REQ-9 cares about.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `EnvironmentInfo.useHttps`; `web`'s query fails validation until the field exists |
| 1 | `infra` | Independent of both code slices; passes `USE_HTTPS` into `api`'s container |
| 1 | `web` | Contract is frozen, so it can be written in parallel; only its *live* check needs step 1 `api` |
| 1 | `orch` | Add `certs/` to the root `.gitignore` (NFR-2) — outside every agent's territory, must land before anyone runs `certs` in a checkout |
| 2 | `docs` (orch) | `docs/spec/graphql-contract.md`, root `CLAUDE.md` (Environment + Topology), `services/api/CLAUDE.md` `environment/` paragraph (allowlist is now seven names) |
| 3 | verify | Needs all three slices on one running stack |

All three step-1 slices run **in parallel**: the contract delta is one additive field, frozen now.
Until `infra` lands, `api` reads `USE_HTTPS` as unset ⇒ `false`, which is NFR-5's behaviour, so
nothing breaks mid-flight.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`useHttps` reports HTTPS in effect, not the raw `USE_HTTPS`.** With `USE_TRAEFIK=false` and
  `USE_HTTPS=true`, `api` returns `false`. Returning the raw variable looks more "honest" from inside
  `api` and would make `web` show "HTTPS enabled" on an installation that serves no HTTPS at all.
- **No `useHttps`-driven nullability change.** URLs are still `null` exactly when
  `useTraefik && domain !== null` is false; HTTPS only flips the scheme of non-null ones.
- **`web` must not start reading `USE_HTTPS`.** The upload scheme follows the request, not the
  setting (REQ-9); a `web`-side copy of the flag would be a second source that can disagree with
  `api`'s — the exact bug class `055` exists to surface.
- **The CA is never regenerated by `certs`.** On an NFR-3 mismatch the tempting fix is "just make a
  new CA"; that silently invalidates every device's trust. Fail and tell the operator.

If any of this has to change: stop, amend `spec.md`, re-approve, re-brief `infra`, `api` and `web`.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Stale `dynamic.yml` after turning HTTPS off | 443 keeps serving the app with a cert whose CA the operator may have removed; no error | `traefik` loads the file provider only when `USE_HTTPS=true` (entrypoint wrapper) |
| HTTPS router labels added to services | 443 serves the app with Traefik's self-signed cert on installs that never opted in; AC-10 silently broken | Routers live only in `dynamic.yml`; `infra/plan.md` forbids touching the four services' labels |
| Leaf not re-validated against `DOMAIN` | Change `DOMAIN`, old leaf keeps being served, every browser shows a name mismatch; `certs` exits 0 | SAN equality check is one of the three reissue triggers; AC-7 plus a domain change *within* the constraint in the manual pass |
| Name constraint written wrong (e.g. `.perceptor.local` only) | Leaf for the bare `DOMAIN` rejected by the browser with a cryptic error, subdomains fine | AC-5 inspects the CA's `nameConstraints`; manual pass opens the bare `https://DOMAIN` |
| `ca.key` readable or leaked | Anyone with it can mint certs trusted by every device — limited to `DOMAIN` by NFR-3, still silent | `chmod 600`, only `certs` mounts `./certs`, `certs/` in `.gitignore`, AC-1 checks the mode |
| Upload scheme swap uses the wrong signal | HTTP page gets an `https://` endpoint (fails only on devices without the CA) or vice versa (mixed content) — looks like a flaky upload | Same `isSecureRequest()` the login cookie already relies on, moved not duplicated; AC-4 and AC-4b cover both directions |
| tus `Location` behind TLS | `POST` succeeds over HTTPS, `PATCH` goes to `http://…` and is blocked as mixed content | Already handled by `respectForwardedHeaders: true`; AC-4 exercises a real upload over HTTPS |
| Env allowlist creep | A second new variable slips into `environmentInfo` unnoticed | `environment.service.spec.ts`'s allowlist test updated to exactly the new key set |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- environment
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
docker compose -f docker-compose.yaml config -q
git status --short services/api/prisma        # empty — no migration
```

Certificate step, with `USE_TRAEFIK=true`, `USE_HTTPS=true`, `DOMAIN=perceptor.local` in `.env`:

```bash
bin/dev -d
docker compose logs certs                       # AC-1: prints ./certs/ca.crt path + trust instruction on first run
stat -c '%a %U' certs/ca.key                    # 600 <host user>
openssl x509 -in certs/ca.crt -noout -ext nameConstraints                      # AC-5 (any host openssl, or via `docker compose run --rm --no-deps --entrypoint openssl certs …`)
docker compose run --rm --no-deps --entrypoint openssl certs x509 -in /tls/cert.pem -noout -ext subjectAltName -enddate
curl -sI http://perceptor.local | head -1       # AC-3: 200, no 3xx
curl -sI --cacert certs/ca.crt https://api.perceptor.local/graphql | head -1   # AC-2 without a browser
```

AC-6 (delete only the leaf): `sha256sum certs/ca.*`, then
`docker compose run --rm --no-deps --entrypoint rm certs -f /tls/cert.pem /tls/key.pem`, then
`bin/dev -d`, then the same `sha256sum` (unchanged) and the `curl --cacert` above (still 200).

AC-7: set `DOMAIN=perceptor.home`, `bin/dev -d` — `docker compose logs certs` names `./certs` and
says to delete it and re-trust; `traefik` is not started; `sha256sum certs/ca.*` unchanged.
Restore the domain afterwards.

AC-10: on a checkout whose `.env` has no `USE_HTTPS`, `bin/dev -d` — `ls certs` fails (no directory),
`curl -skI https://perceptor.local` returns Traefik's `404` exactly as on `master`.

Manual pass: trust `certs/ca.crt` in the OS/Chrome store of one PC (AC-2: no warning on the four
hosts, "Install app" offered); upload a file over `https://` (AC-4, console clean) and, from a
second browser profile without the CA, over `http://` (AC-4b — network tab shows
`http://api.perceptor.local/uploads`); Settings → Environment as admin (AC-9, including both
`PUBLIC_UPLOAD_URL` edits); a device without the CA over `https://` shows the certificate error
while `http://` works (AC-8).

## Amendment — CA download (spec 0.4.0, REQ-11)

`certs` also copies only `ca.crt` into a second named volume, `ca_public`. It is mounted read-only into
`web` at `/ca`, and `web` serves it at `/ca.crt` (public in `proxy.ts`, `404` when the file is absent, which
is every installation without HTTPS — the volume exists but stays empty, so NFR-5 holds). A named volume
rather than a bind of `./certs/ca.crt`: Docker creates a missing bind-mount source as a *directory*, which
would break installations that never enabled HTTPS. Not `traefik_tls`: it also holds the leaf's private key.
No GraphQL change. Order: `infra` (volume + copy + `web` mount) and `web` (route, link, messages) are
independent; the live check runs after both.
