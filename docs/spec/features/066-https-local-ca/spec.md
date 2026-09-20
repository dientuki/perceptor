---
title: HTTPS Through Traefik With a Local Certificate Authority
spec_version: 0.4.0
author: Juan "Dientuki" Farias
created_at: 2026-09-19
last_updated: 2026-09-20
status: Approved
services: [infra, api, web]
---

# SPEC: HTTPS Through Traefik With a Local Certificate Authority (`spec.md`)

## Context & Goal

`web` ships a PWA manifest (`services/web/src/app/manifest.json`), but an installation reached by
domain is served over plain HTTP only: `traefik` binds `:443` (`docker-compose.yaml`, entrypoint
`websecure`) yet every router label on `web`, `api`, `torrent` and `indexer` names only the `web`
entrypoint, so nothing is routed on 443. Chrome labels every page "Not secure", and — more to the
point — refuses to treat the site as installable, because a PWA needs a secure context and a
certificate the browser actually trusts. Clicking through a certificate warning does not count.
`localhost` is the only exception, which is why port mode (`USE_TRAEFIK=false`) on the host itself
does not have this problem and every other device does.

A Perceptor installation has no public domain (`perceptor.local` in `/etc/hosts` is the documented
shape), so Let's Encrypt is not available: it must reach the domain from the internet. Traefik's
built-in self-signed certificate is trusted by nothing and fixes neither symptom. The least-effort
path that actually works is a **local certificate authority owned by the installation**: Perceptor
generates a CA once, issues from it a certificate covering `DOMAIN` and `*.DOMAIN`, and Traefik serves
that certificate on 443. The operator installs the CA's public certificate once on each device they
use (PC, phone); from then on every Perceptor host is trusted, the leaf certificate can be renewed
without touching any device again, and the web app installs as a PWA with no warning.

HTTP on port 80 keeps working alongside HTTPS — a device that has not trusted the CA yet still
reaches the app. The opt-in is one more question in both installers (`install.sh`, `bin/install`),
asked only once Traefik and a domain have been chosen. Beyond `infra`, two services are touched
because they bake the `http://` scheme in today: `api`'s CORS allowlist (`services/api/src/main.ts`,
the origins the tus upload accepts) and `api`'s `environmentInfo` query
(`services/api/src/environment/`, `055-environment-panel`), whose derived URLs `web`'s Environment
tab renders and compares against `PUBLIC_UPLOAD_URL`. No pipeline stage in the root `CLAUDE.md`
changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Opt-in setting)**: HTTPS must be controlled by a single new `.env` variable,
      `USE_HTTPS` (`true`/`false`, default `false`, present in `.env.example`). It is in effect only
      when `USE_TRAEFIK=true` and `DOMAIN` is set; with Traefik off it has no effect anywhere.
- [ ] **REQ-2 (Installer question)**: `install.sh` and `bin/install` must, immediately after the
      Traefik + domain questions and only when Traefik was chosen, ask whether to serve HTTPS
      (default no), write `USE_HTTPS` accordingly, and derive `PUBLIC_UPLOAD_URL` per REQ-9. Port
      mode asks nothing new.
- [ ] **REQ-3 (Local CA)**: With HTTPS in effect, the stack must ensure — before `traefik` serves any
      request — that a CA certificate and private key exist in a certificate directory on the host
      next to `docker-compose.yaml`. If absent, they are generated; if present, they are reused
      unchanged. The CA is never regenerated automatically.
- [ ] **REQ-4 (Leaf certificate)**: In the same step, a server certificate signed by that CA and
      covering exactly `DOMAIN` and `*.DOMAIN` (so `DOMAIN`, `api.DOMAIN`, `torrent.DOMAIN`,
      `indexer.DOMAIN`) must exist and be valid. It is (re)issued when missing, when it expires
      within 30 days, or when its names do not match the current `DOMAIN`. Reissuing it never
      requires any device to re-trust anything.
- [ ] **REQ-5 (HTTPS routing)**: With HTTPS in effect, `https://DOMAIN`, `https://api.DOMAIN`,
      `https://torrent.DOMAIN` and `https://indexer.DOMAIN` must each serve the same service their
      `http://` counterpart serves today, presenting the REQ-4 certificate.
- [ ] **REQ-6 (HTTP kept)**: Port 80 must keep serving all four hosts over plain HTTP exactly as
      today, with no redirect to HTTPS.
- [ ] **REQ-7 (CA handoff)**: When the installer enables HTTPS, and whenever the CA is first
      generated, the operator must be told the host path of the CA's public certificate file and
      that it has to be installed as a trusted root on every device that will use Perceptor. The
      web app also offers the file for download (REQ-11).
- [ ] **REQ-11 (CA download)**: With HTTPS in effect, `web` serves the CA's public certificate at
      `/ca.crt` on every host and scheme that serves `web` (so a device that has not trusted the CA
      can fetch it over plain `http://DOMAIN/ca.crt`). The route needs no login — a new device has no
      session, and the file is public by design. It answers with a certificate content type and a
      download filename, and `404` when HTTPS is not in effect. `web`'s Environment tab links to it
      when HTTPS is enabled. Only the certificate is ever exposed to `web`: the CA key and the leaf
      key stay unreachable from it (NFR-2).
- [ ] **REQ-8 (CORS)**: `api` must accept cross-origin requests (the tus upload) from
      `https://DOMAIN` as well as the origins it accepts today, when HTTPS is in effect.
- [ ] **REQ-9 (Upload endpoint scheme)**: The upload endpoint handed to the browser must use the
      same scheme as the page that requested it: a page loaded over HTTPS uploads over HTTPS (a
      browser blocks an `http://` upload from an `https://` page as mixed content), and a page loaded
      over HTTP uploads over HTTP (so a device that has not trusted the CA can still upload). `web`
      derives it per request from `PUBLIC_UPLOAD_URL` by replacing only the scheme — host, port and
      path are kept verbatim — using the same request-scheme detection the login cookie already uses
      (`Origin`, falling back to `x-forwarded-proto`; `isSecureRequest` in
      `services/web/src/actions/auth.ts`). In port mode every page is HTTP, so the value is used
      unchanged. The installers write `PUBLIC_UPLOAD_URL` as `https://api.DOMAIN/uploads` when HTTPS
      is enabled and `http://api.DOMAIN/uploads` otherwise, but either scheme works.
- [ ] **REQ-9b (Scheme-agnostic consistency check)**: Because the stored scheme no longer decides
      the scheme actually used, `web`'s Environment tab must compare `PUBLIC_UPLOAD_URL` with
      `expectedUploadEndpoint` ignoring the scheme — an `http://api.DOMAIN/uploads` value with HTTPS
      in effect reads consistent, while a wrong host or path still reads inconsistent. The rest of
      the comparison stays exact, as in `055` (no trailing-slash or case normalization).
- [ ] **REQ-10 (Environment panel)**: `environmentInfo` must report whether HTTPS is in effect, and
      its derived URLs (`endpoints[].url`, `expectedUploadEndpoint`) must use `https://` when it is
      and `http://` otherwise. `web`'s Environment tab must show the HTTPS state beside the routing
      mode and list `USE_HTTPS` among the variables that change it.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Docker only)**: Generating and renewing the CA and the leaf certificate must need
      nothing on the host beyond Docker — `install.sh`'s end user has no `openssl`, no `mkcert`.
- [ ] **NFR-2 (Key secrecy)**: The CA private key is the one secret here that can impersonate
      *other* sites on every device that trusts the CA. It must be written with owner-only
      permissions, never be mounted into any container other than the one step that signs with it (a copy of the
      *public* certificate alone is what `web` gets, REQ-11),
      never be served over any port, and the certificate directory must be git-ignored.
- [ ] **NFR-3 (Blast radius)**: The CA must carry an X.509 name constraint limiting it to `DOMAIN`
      and its subdomains, so a leaked key cannot be used to impersonate any other site to a device
      that trusts it. Consequence, stated as behaviour: when `DOMAIN` changes to a name outside the
      existing CA's constraint, the certificate step must fail loudly — naming the certificate
      directory and telling the operator to delete it and re-trust the new CA — rather than
      silently issuing a certificate no device will accept, or silently replacing the CA.
- [ ] **NFR-4 (Validity limits)**: The leaf certificate's lifetime must not exceed 825 days (the
      maximum iOS/macOS accept even from a user-installed root); REQ-4's renewal is what keeps it
      valid indefinitely, and it runs on every stack start without operator action.
- [ ] **NFR-5 (Backward compatibility)**: An existing `.env` without `USE_HTTPS` must behave
      exactly as today — no certificate generated, no new file on disk, no change to what 80/443
      serve, and `environmentInfo.useHttps` reads `false`.
- [ ] **NFR-6 (Single compose file)**: `docker-compose.yaml` must remain the one file
      `install.sh` downloads (`049`); HTTPS may not require an extra compose file on the end user's
      machine.
- [ ] **NFR-7 (Env allowlist)**: `055-environment-panel`'s NFR-2 fixes `environmentInfo`'s
      environment-variable allowlist at six names. This feature grows it by exactly one,
      `USE_HTTPS`, and no other.

## GraphQL Contract Delta

```graphql
type EnvironmentInfo {
  useTraefik: Boolean!
  useHttps: Boolean!
  domain: String
  endpoints: [EnvironmentEndpoint!]!
  expectedUploadEndpoint: String
}
```

One new field. `useHttps` is `true` exactly when `USE_HTTPS=true`, `USE_TRAEFIK=true` and `DOMAIN`
is set — it reports HTTPS *in effect*, not the raw variable, so it is never `true` in port mode.

Two existing fields change value, not type: `endpoints[].url` and `expectedUploadEndpoint` are
`https://…` when `useHttps` is `true` and `http://…` otherwise. Their nullability rule from `055` is
unchanged — both still `null` together whenever `useTraefik && domain !== null` is false.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Non-admin calls `environmentInfo` | `ForbiddenException` (existing `AdminGuard`, unchanged) | unchanged from `055` |

No new error condition: the query reads process environment only and cannot fail on it. `web`'s
handling of the existing error is unchanged.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: A fresh `install.sh` run answering yes to Traefik (domain `perceptor.local`) and yes
      to HTTPS prints the host path of the CA certificate plus the instruction to trust it on each
      device; `.env` contains `USE_HTTPS=true` and `PUBLIC_UPLOAD_URL=https://api.perceptor.local/uploads`; the
      host certificate directory contains the CA certificate and the CA key (mode `600`) and nothing
      else; the leaf certificate and its key live only where `traefik` reads them (see `plan.md`).
- [ ] **AC-2**: On a PC that has trusted that CA, opening `https://perceptor.local` in Chrome shows
      no certificate warning and no "Not secure" label, and Chrome offers "Install app".
      `https://api.perceptor.local`, `https://torrent.perceptor.local` and
      `https://indexer.perceptor.local` open with no warning either.
- [ ] **AC-3**: On the same installation, `http://perceptor.local` still loads the app with no
      redirect (`curl -sI http://perceptor.local` shows no `3xx` to `https://`).
- [ ] **AC-4**: Logged in over `https://perceptor.local`, uploading a file from a film's detail page
      completes, and the browser console shows no mixed-content or CORS error.
- [ ] **AC-4b**: On a device that has *not* trusted the CA, logged in over `http://perceptor.local`,
      the same upload completes, and the browser's network tab shows it went to
      `http://api.perceptor.local/uploads` even though `PUBLIC_UPLOAD_URL` is `https://…`.
- [ ] **AC-5**: `openssl x509 -noout -ext subjectAltName,nameConstraints` on the leaf and the CA shows
      the leaf covers `perceptor.local` and `*.perceptor.local`, and the CA is constrained to
      `perceptor.local`.
- [ ] **AC-6**: Deleting only the leaf certificate (the exact command is in `plan.md` §
      Verification) and restarting the stack reissues it; the CA files'
      checksums are unchanged, and the PC from AC-2 still loads `https://perceptor.local` with no
      warning.
- [ ] **AC-7 (failure)**: Changing `DOMAIN` to `perceptor.home` with the existing certificate
      directory in place and restarting: the certificate step fails, its log names the certificate
      directory and says to delete it and re-trust the CA, `traefik` does not serve a certificate
      for `perceptor.home`, and the CA files are untouched.
- [ ] **AC-8 (failure)**: On a device that has *not* trusted the CA, `https://perceptor.local`
      shows the browser's certificate error (expected — nothing is silently trusted), while
      `http://perceptor.local` still works.
- [ ] **AC-9**: Settings → Environment, as admin, with HTTPS in effect: shows HTTPS enabled, every
      endpoint URL starts with `https://`, `USE_HTTPS` appears in the list of variables, and the
      upload-endpoint badge reads consistent. Editing `PUBLIC_UPLOAD_URL` to
      `http://api.perceptor.local/uploads` and recreating `web` keeps it consistent; editing it to
      `https://api.perceptor.lan/uploads` turns it inconsistent (failure path of REQ-9b).
- [ ] **AC-11**: With HTTPS in effect, `curl -s http://perceptor.local/ca.crt` (no cookie) returns
      the same bytes as `certs/ca.crt`, with a certificate content type, and Settings → Environment
      shows a download link to it. `web` cannot read `ca.key` or the leaf key (no such file in its
      container). On an installation without `USE_HTTPS`, `/ca.crt` answers `404` (failure path).
- [ ] **AC-10**: An existing installation whose `.env` has no `USE_HTTPS`, after pulling this version
      and `docker compose up -d`: no certificate directory is created, `curl -skI
      https://perceptor.local` behaves as before this feature, and the Environment tab shows HTTPS
      disabled.

## Out of Scope

- **Let's Encrypt / ACME.** Needs a public domain reachable from the internet (HTTP-01) or a DNS
  provider API token (DNS-01); neither exists in the installation shape this project documents. A
  later feature can add it as a second certificate source beside the local CA.
- **HTTPS in port mode (`USE_TRAEFIK=false`).** Only the host itself reaches that mode by
  `localhost`, which browsers already treat as a secure context. Anything else needs a name to put in
  a certificate, which is what Traefik mode is for.
- **Redirecting HTTP to HTTPS, HSTS.** Explicitly declined: HTTP stays available for devices that
  have not trusted the CA. HSTS would make that impossible once a browser saw it.
- **Per-platform trust instructions in the app.** The download (REQ-11) is offered; how to install a
  root certificate on each OS is documentation, not product.
- **Sharing a session across schemes.** A login over HTTPS sets a `Secure` cookie
  (`services/web/src/actions/auth.ts`), which the browser never sends over HTTP; the same user on
  `http://` appears logged out and logs in again. Expected, not a bug.
- **Rotating or revoking the CA.** Done by hand: delete the certificate directory, restart, re-trust
  on every device. Automating it would mean re-touching every device anyway.
- **Traefik's dashboard, the traefik healthcheck, and TLS for internal traffic** (`web`→`api`,
  `worker`→`api`, the qBittorrent AutoRun hook). All stay on `perceptor-net` over plain HTTP; TLS is
  terminated at Traefik.
