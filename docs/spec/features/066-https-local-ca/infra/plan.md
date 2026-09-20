---
title: HTTPS Through Traefik With a Local Certificate Authority — infra slice
service: infra
last_updated: 2026-09-19
status: Approved
---

# PLAN: HTTPS Through Traefik With a Local Certificate Authority — `infra` (`infra/plan.md`)

## Scope

`infra` owns everything that makes HTTPS exist: the `USE_HTTPS` variable, the `certs` one-shot
service that creates the CA and leaf and writes Traefik's dynamic config, `traefik`'s conditional
file provider, passing `USE_HTTPS` into `api`, the installer question in `install.sh` and
`bin/install`, and `bin/dev`/`bin/prod` starting `certs`. Read `../plan.md` § Approach first — the
reasons for the named volume, the file-provider routers and the entrypoint wrapper are there and
are not repeated here.

**Not yours:** `api`'s CORS and `environmentInfo` (the `api` slice), anything under
`services/web/` (the `web` slice). `.gitignore` is a repo-root file outside the agent's listed
territory — it is a one-line `[orch]` task, not yours; stop and report if it has not happened.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.yaml` | Modified | New `certs` service; `traefik` entrypoint wrapper, `/tls` mount, `USE_HTTPS` env, `depends_on: certs`; `api` gets `USE_HTTPS`; new named volume `traefik_tls` |
| `.env.example` | Modified | `USE_HTTPS=false` beside `USE_TRAEFIK`/`DOMAIN`, with its comment; `COMPOSE_PROFILES` comment mentions `https` |
| `install.sh` | Modified | HTTPS question inside the Traefik branch; `COMPOSE_PROFILES`, `PUBLIC_UPLOAD_URL`, final URL and CA handoff |
| `bin/install` | Modified | Same question; `PUBLIC_UPLOAD_URL` scheme |
| `bin/dev`, `bin/prod` | Modified | Add `certs` to `SERVICES` when `USE_TRAEFIK=true` and `USE_HTTPS=true` |

## Existing code to reuse

- **`backup` in `docker-compose.yaml`** — the exact shape for `certs`: `image: mariadb:12.3.2`
  (same image, already pulled, has `openssl` 3.0.13), `restart: "no"`, `command: [/bin/bash, -c,
  |…]`, `set -euo pipefail`, `$$` escaping for shell variables inside compose. `api`'s
  `depends_on: backup: condition: service_completed_successfully` is the gating pattern `traefik`
  copies.
- **`traefik`'s `profiles: [traefik]`** and its comment — `certs` uses `profiles: [https]` the same
  way, and `bin/dev`/`bin/prod` naming it explicitly starts it regardless, exactly as they already do
  for `traefik`.
- **`set_env_var`** in both installers — the only way either writes `.env`.
- **The Traefik-branch `case` in `install.sh`/`bin/install`** — the HTTPS question nests inside its
  `[yY]*)` arm; the port-mode arm is untouched (REQ-2).

## Steps

1. **`docker-compose.yaml` — `certs` service.** `image: mariadb:12.3.2`, `profiles: [https]`,
   `restart: "no"`, `entrypoint: ["/bin/bash", "-c"]` (or `command:` as `backup` does), no ports,
   no labels, on `perceptor-net` is unnecessary (no network use — omit `networks:` or use
   `network_mode: none`). Environment: `DOMAIN`, `PUID`, `PGID`. Volumes: `./certs:/certs` and
   `traefik_tls:/tls`. Runs as root (see `../plan.md`). Script, in order:
   - `[ -n "$DOMAIN" ]` or fail.
   - `umask 077`. If `/certs/ca.key` and `/certs/ca.crt` both exist, verify the CA's
     `nameConstraints` (`openssl x509 -noout -ext nameConstraints`) permits exactly `DNS:$DOMAIN`;
     if not, print to stderr — naming `./certs`, saying `DOMAIN` changed outside what the existing
     CA may sign, to delete `./certs` and re-trust the new `ca.crt` on every device — and `exit 1`
     (NFR-3, AC-7). If only one of the two exists, fail the same loud way rather than guessing.
   - If neither exists: generate RSA 2048 `ca.key`; self-signed `ca.crt`, 3650 days, subject
     `CN=Perceptor local CA (${DOMAIN})`, extensions `basicConstraints=critical,CA:TRUE,pathlen:0`,
     `keyUsage=critical,keyCertSign,cRLSign`, `subjectKeyIdentifier=hash`,
     `nameConstraints=critical,permitted;DNS:${DOMAIN}`. Set a flag that the CA is new.
   - Leaf in `/tls`: reissue when `/tls/cert.pem` is missing, when `openssl x509 -checkend 2592000`
     fails, or when its `subjectAltName` is not exactly `DNS:${DOMAIN}, DNS:*.${DOMAIN}`, or when it
     does not verify against the current `ca.crt` (`openssl verify -CAfile`). Issue: RSA 2048 key,
     CSR `CN=${DOMAIN}`, signed by the CA for 800 days with `subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN}`,
     `basicConstraints=critical,CA:FALSE`, `keyUsage=critical,digitalSignature,keyEncipherment`,
     `extendedKeyUsage=serverAuth`, `authorityKeyIdentifier=keyid`. Write key and cert to temp names
     then `mv`, so `traefik`'s watcher never reads a half-written pair.
   - Always rewrite `/tls/dynamic.yml` (cheap, and it keeps the host rules in sync with `DOMAIN`):
     `tls.stores.default.defaultCertificate` and `tls.certificates` → `/tls/cert.pem`/`/tls/key.pem`;
     `http.routers.{web,api,torrent,indexer}-secure` with `entryPoints: [websecure]`,
     ``rule: Host(`${DOMAIN}`)`` / ``Host(`api.${DOMAIN}`)`` / …, `service: web@docker` / `api@docker` /
     `torrent@docker` / `indexer@docker`, `tls: {}`. The `@docker` names are the services the
     existing `traefik.http.services.<name>.loadbalancer.server.port` labels declare — do not rename
     them and do not add labels to those four services (`../plan.md` § Risks, row 2).
   - `chown -R "$PUID:$PGID" /certs`, `chmod 700 /certs`, `chmod 600 /certs/ca.key`,
     `chmod 644 /certs/ca.crt`. `/tls` stays root-owned — only `traefik` (root) reads it.
   - If the CA is new, print the REQ-7 handoff: that `certs/ca.crt` next to `docker-compose.yaml` is
     the file to install as a trusted root certificate on every device that will open Perceptor over
     HTTPS, and that HTTP keeps working on devices that have not.
2. **`docker-compose.yaml` — `traefik`.** Add `environment: - USE_HTTPS=${USE_HTTPS:-false}`,
   volume `traefik_tls:/tls:ro`, `depends_on: certs: {condition: service_completed_successfully,
   required: false}`. Replace the implicit entrypoint with a `sh -c` wrapper that keeps every
   existing `--…` flag and, only when `$USE_HTTPS` is `true`, appends
   `--providers.file.directory=/tls --providers.file.watch=true`, then `exec traefik "$@"`. Keep the
   existing flags in `command:` if the wrapper passes `"$@"` through; either way `docker compose
   config` must show the same flags as today when `USE_HTTPS` is unset. Keep ports and labels as
   they are; `:443` is already published.
3. **`docker-compose.yaml` — `api`.** Add `- USE_HTTPS=${USE_HTTPS:-false}` next to `USE_TRAEFIK`,
   under the same "read only by environmentInfo" comment (update the comment to mention CORS is not
   gated by it). `web` gets nothing (`../plan.md` § Contract Freeze).
4. **`docker-compose.yaml` — `volumes:`.** Add `traefik_tls:`.
5. **`.env.example`.** `USE_HTTPS=false` right after `DOMAIN`, commented: only in effect with
   `USE_TRAEFIK=true`; generates a local CA in `./certs` that must be trusted on each device; needs
   `https` in `COMPOSE_PROFILES`; HTTP keeps working. Update the `COMPOSE_PROFILES` comment to name
   the `https` profile. Also update the `PUBLIC_UPLOAD_URL` comment: with Traefik its scheme is
   swapped per request to match the page, so either `http://` or `https://api.${DOMAIN}/uploads`
   works.
6. **`install.sh`.** Inside the Traefik `[yY]*)` arm, after the domain: `read -rp "Serve HTTPS with
   a local certificate authority? [y/N] " </dev/tty`. Yes → `set_env_var USE_HTTPS true`,
   `set_env_var COMPOSE_PROFILES traefik,https`; no → `USE_HTTPS false`, `COMPOSE_PROFILES traefik`.
   The existing `PUBLIC_UPLOAD_URL` derivation further down uses `https://api.${domain}/uploads`
   when `USE_HTTPS=true`. The closing summary prints `https://${DOMAIN}` (and still mentions
   `http://${DOMAIN}`) and, when HTTPS is on, the absolute path `$(pwd)/certs/ca.crt` with the
   instruction to trust it on every device (REQ-7, AC-1). An upgrade run with an existing `.env`
   asks nothing new — NFR-5.
7. **`bin/install`.** Same question in the same place, `set_env_var USE_HTTPS`, and
   `PUBLIC_UPLOAD_URL` with the matching scheme. It does not set `COMPOSE_PROFILES` today (`bin/dev`
   names services explicitly) — keep it that way.
8. **`bin/dev`, `bin/prod`.** Inside the existing `USE_TRAEFIK=true` branch, if `USE_HTTPS=true`
   also prepend `certs` to `SERVICES`. Update the header comment.

## Contract obligations

`infra` consumes no GraphQL. Its obligations to the other slices:

- `api` must see `USE_HTTPS` in its container environment, literal `true`/`false` — `api` compares
  against the string `'true'`.
- `web` must **not** receive `USE_HTTPS`.
- The four Docker-provider service names (`web`, `api`, `torrent`, `indexer`) stay exactly as they
  are; `dynamic.yml` references them.

## Tests

No test runner exists for `infra` (plain bash and YAML); the gate is running it against the live
stack. The failure here that would be silent is a stale or mismatched leaf being served — covered by
AC-6/AC-7 and the domain-change check in `../plan.md` § Verification, which you run and paste.

## Done when

```bash
docker compose -f docker-compose.yaml config -q
docker compose -f docker-compose.yaml config | grep -A15 '^  traefik:'   # same flags as master when USE_HTTPS unset
bin/dev -d && docker compose ps -a certs traefik                            # certs exited 0, traefik running
docker compose logs certs
```

plus the certificate-step commands, AC-6, AC-7 and AC-10 blocks in `../plan.md` § Verification, with
their real output pasted into the report.

## Amendment — CA download (spec 0.4.0, REQ-11)

9. `docker-compose.yaml`: new named volume `ca_public`. `certs` mounts it at `/ca-public` and, at the end of
   its script (after the `chmod`s, every run), does `cp /certs/ca.crt /ca-public/ca.crt && chmod 644
   /ca-public/ca.crt`. `web` mounts `ca_public:/ca:ro`. Nothing else is added to `web` (no `USE_HTTPS`, no
   `./certs`). Done when: `docker compose config` shows `web` with exactly that one new mount and no
   `./certs`; after `bin/dev -d`, `docker compose exec web ls /ca` lists only `ca.crt`, and
   `docker compose exec web ls /certs /tls` fails.
