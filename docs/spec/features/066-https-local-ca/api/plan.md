---
title: HTTPS Through Traefik With a Local Certificate Authority — api slice
service: api
last_updated: 2026-09-19
status: Approved
---

# PLAN: HTTPS Through Traefik With a Local Certificate Authority — `api` (`api/plan.md`)

## Scope

`api` reports whether HTTPS is in effect through `environmentInfo` and derives its URLs with the
right scheme (REQ-10), and accepts the `https://DOMAIN` origin for CORS (REQ-8). No schema, no
migration, no new module.

**Not yours:** `USE_HTTPS` reaching this container's environment (`infra` adds it to
`docker-compose.yaml`), certificates, Traefik, installers, and everything in `web`. The tus upload
itself needs no change — see § Existing code to reuse.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/environment/environment.types.ts` | Modified | `EnvironmentConfig.useHttps: boolean` |
| `services/api/src/environment/environment.module.ts` | Modified | Factory reads `USE_HTTPS === 'true'`; allowlist comment says seven names |
| `services/api/src/environment/environment.service.ts` | Modified | `useHttps` in effect; scheme for `buildUrl` and `expectedUploadEndpoint` |
| `services/api/src/environment/entities/environment-info.entity.ts` | Modified | `@Field() useHttps: boolean` |
| `services/api/src/environment/environment.service.spec.ts` | Modified | New cases, allowlist key set updated |
| `services/api/src/main.ts` | Modified | `https://${process.env.DOMAIN}` added to the CORS origin list |
| `services/api/src/schema.gql` | Regenerated | Exactly the one field from `../spec.md` — never hand-edited (Article IV) |

## Existing code to reuse

- **`environment/`'s factory-behind-a-token shape** (`ENVIRONMENT_CONFIG`): the only place
  `process.env` is read. `useHttps` is parsed there exactly as `useTraefik` is
  (`process.env.USE_HTTPS === 'true'`); the service never reads `process.env`.
- **`canDeriveUrls`** in `EnvironmentService.getInfo()` — the existing condition. HTTPS in effect is
  `canDeriveUrls && this.config.useHttps`; nullability stays tied to `canDeriveUrls` alone.
- **`buildUrl(id, domain)`** — keep it, parameterise the scheme instead of adding a second builder.
  `expectedUploadEndpoint` uses the same scheme.
- **`uploads.service.ts`'s `respectForwardedHeaders: true`** — tus already builds `Location` from
  `X-Forwarded-Proto`, which Traefik sets on the HTTPS entrypoint. Do not touch the uploads module.

## Steps

1. `environment.types.ts`: add `useHttps: boolean` to `EnvironmentConfig`.
2. `environment.module.ts`: `useHttps: process.env.USE_HTTPS === 'true'`; update the allowlist
   comment from six names to seven (`USE_HTTPS` is the only addition — `../spec.md` NFR-7).
3. `environment-info.entity.ts`: `@Field() useHttps: boolean;` placed after `useTraefik` (field
   order in `schema.gql` then matches the SDL in `../spec.md`).
4. `environment.service.ts`: compute `useHttps = canDeriveUrls && this.config.useHttps`, return it,
   and pass the scheme (`https` when `useHttps`, else `http`) into `buildUrl` and the
   `expectedUploadEndpoint` template.
5. `main.ts`: origin list becomes `http://${DOMAIN}`, `https://${DOMAIN}`,
   `http://localhost:${WEB_PORT}` — unconditional (`../plan.md` § Approach explains why no branch).
6. Boot the dev stack so `schema.gql` regenerates; confirm its diff is exactly `useHttps: Boolean!`
   on `EnvironmentInfo`.

## Contract obligations

Exposes exactly `../spec.md` § GraphQL Contract Delta: `EnvironmentInfo.useHttps: Boolean!`, true
only when `USE_HTTPS=true` **and** `USE_TRAEFIK=true` **and** `DOMAIN` non-empty. `endpoints[].url`
and `expectedUploadEndpoint` switch to `https://` under that same condition and keep `055`'s
nullability rule unchanged. No new error; `AdminGuard` unchanged. Read-only — stop and report if it
looks wrong.

## Tests

`environment.service.spec.ts` is owed new cases; it already opens with the Article IX header and
its two failure classes (fabricated host, leaked secret) still apply. Extend the header by one
sentence naming the new silent failure: **a raw-flag `useHttps`** — reporting `true`, or emitting
`https://` URLs, on an installation that serves no HTTPS, which would make the Environment tab
recommend an upload endpoint that cannot connect. Cases:

- `useTraefik: true`, `useHttps: true`, domain set → `useHttps: true`, all four endpoint URLs and
  `expectedUploadEndpoint` start with `https://`.
- `useTraefik: true`, `useHttps: false` → `useHttps: false`, URLs `http://` (existing expectations
  keep passing with the fixture's new field set to `false`).
- `useTraefik: false`, `useHttps: true` → `useHttps: false`, URLs `null`.
- `useTraefik: true`, `useHttps: true`, `domain: null` → `useHttps: false`, URLs `null`.
- The allowlist test's expected key set gains exactly `useHttps`.

`main.ts`'s CORS list is not owed a test: it is a literal, and a wrong entry fails loudly in the
browser console (AC-4).

## Done when

```bash
bin/cli api npx --no tsc --noEmit            # 0 errors
bin/npm api test -- environment              # all pass, new cases included
bin/npm api test                             # no regressions
git diff services/api/src/schema.gql         # exactly one added line: useHttps: Boolean!
git status --short services/api/prisma       # empty
```
