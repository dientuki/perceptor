---
title: Environment Panel — api slice
service: api
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Environment Panel — `api` (`api/plan.md`)

## Scope

Expose one admin-only read query, `environmentInfo`, reporting how this installation is reachable as
**this container** has it loaded: the routing mode, the domain, the four published ports, and the URLs
derivable from them. Nothing is persisted, no Prisma model changes, no migration.

Explicitly **not** this slice: the Settings tab and every string a user reads (`web`), the compose
passthrough that puts three of these variables in this container (`infra`), and `PUBLIC_UPLOAD_URL` —
this service does not have it, must not be given it, and does not compare against it. `api` publishes
`expectedUploadEndpoint`; `web` owns the comparison. See `../plan.md` § Contract Freeze.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/environment/environment.types.ts` | New | `EnvironmentConfig` type + `ENVIRONMENT_CONFIG` injection token |
| `src/environment/environment.module.ts` | New | Factory reading `process.env` into the token; declares service + resolver |
| `src/environment/environment.service.ts` | New | Derives the payload from injected config — the whole derivation, pure |
| `src/environment/environment.resolver.ts` | New | `@Query environmentInfo`, `@UseGuards(AdminGuard)` per method |
| `src/environment/entities/environment-info.entity.ts` | New | `EnvironmentInfo` + `EnvironmentEndpoint` `@ObjectType`s |
| `src/environment/environment.service.spec.ts` | New | The two silent failures below |
| `src/app.module.ts` | Modified | `imports: [… EnvironmentModule]` |
| `src/schema.gql` | Regenerated | Article IV artifact — never hand-edited |

## Existing code to reuse

- **`src/media-roots/media-roots.module.ts` — copy this structure.** It builds its config from
  `process.env` in a module-level factory behind an injection token (`MEDIA_ROOTS`) rather than reading
  the environment inside the service, and its comment states the reason: so the spec can inject a
  fixture without mutating `process.env`. This slice needs exactly that property (see § Tests), so
  `ENVIRONMENT_CONFIG` mirrors `MEDIA_ROOTS` one-for-one: `{ provide: ENVIRONMENT_CONFIG, useFactory:
  buildEnvironmentConfig }`.
- **`src/media-roots/media-roots.resolver.ts`** — the shape of a tiny read-only resolver over
  `.env`-declared infrastructure, including the `description:` on the `@Query`. Follow it, with one
  addition it does not have: the guard below.
- **`src/ffprobe-logs/ffprobe-logs.resolver.ts`** — the **per-method** `@UseGuards(AdminGuard)` split.
  Use this, not `UsersResolver`'s class-level form. There is only one method here so the distinction
  looks academic; it is not — class-level is the habit that later breaks the first `@AllowService()` or
  `@Public()` method someone adds to the same resolver, and `settings.resolver.ts`'s own comment
  documents that trap.
- **`src/media-roots/entities/media-root.entity.ts`** — the entity shape (`@ObjectType`, `@Field(() =>
  ID)` for a string id, a comment on each non-obvious nullable). **Do not copy its `label` field**: see
  Contract obligations.
- **`src/i18n/error-keys.ts`'s `AUTH_ADMIN_REQUIRED`** — already the key `AdminGuard` throws. No new
  error key is added by this slice.

## Steps

1. `environment.types.ts`: `ENVIRONMENT_CONFIG` symbol/string token plus an `EnvironmentConfig` type
   holding the raw, already-parsed inputs — `useTraefik: boolean`, `domain: string | null`, and the
   four ports as `number | null` keyed by endpoint id. Parsing (string → boolean, string → int,
   empty → `null`) belongs to the factory in step 2, so the service never sees a raw string.
2. `environment.module.ts`: `buildEnvironmentConfig()` reads exactly `USE_TRAEFIK`, `DOMAIN`,
   `WEB_PORT`, `PORT`, `QBITTORRENT_WEBUI_PORT`, `INDEXER_PORT` — **this list is the allowlist of
   NFR-2**. `useTraefik` is `process.env.USE_TRAEFIK === 'true'`; an unset or empty `DOMAIN` becomes
   `null`, never `''`; a port that is unset or not a finite integer becomes `null`. `api`'s own
   published port comes from `PORT` (see `../infra/plan.md` step 3 for why there is no `API_PORT`).
3. `entities/environment-info.entity.ts`: `EnvironmentEndpoint { id: ID!, port: Int, url: String }`
   and `EnvironmentInfo { useTraefik: Boolean!, domain: String, endpoints: [EnvironmentEndpoint!]!,
   expectedUploadEndpoint: String }`, matching `../spec.md` exactly.
4. `environment.service.ts`: one method returning `EnvironmentInfo` from the injected config.
   - `endpoints` is always four entries, ids `web`, `api`, `torrent`, `indexer`, **in that order** —
     the order is part of the contract and `web` renders the list as given.
   - `url` is `http://<domain>` for `web` and `http://<id>.<domain>` for the other three, **only** when
     `useTraefik && domain !== null`. Otherwise `null`.
   - `expectedUploadEndpoint` is `http://api.<domain>/uploads` under the same condition, else `null`.
   - No fallback host. Not `localhost`, not the container hostname, not the request's `Host` header.
     `null` is the specified answer and the reason is in `../plan.md` § Risks — read that row before
     writing this method.
5. `environment.resolver.ts`: `@Query(() => EnvironmentInfo, { name: 'environmentInfo', description:
   … })` with `@UseGuards(AdminGuard)` on the method.
6. Register `EnvironmentModule` in `src/app.module.ts`. It is a leaf module: it imports nothing
   (`AdminGuard` needs `PrismaService`, which comes from the effectively-global `PrismaModule`).
7. Boot once so Article IV regenerates `src/schema.gql`, and confirm the generated SDL matches
   `../spec.md`'s delta verbatim. A difference is either a decorator bug or a stale spec — resolve it
   before closing, never by editing `schema.gql`.

## Contract obligations

`api` owes the exact shape in `../spec.md` § GraphQL Contract Delta. Read it there; it is read-only.
Three obligations that are easy to get wrong from inside this service:

- **No `label` on `EnvironmentEndpoint`.** `MediaRoot`, the neighbour this module otherwise copies, has
  one — and it is a hardcoded Spanish string predating `018-ui-i18n`. Adding a label here would put
  user-facing copy back into a service that produces English-plus-a-key and nothing else. `web` maps
  `id` → catalog.
- **`null` is a real, specified value** for `endpoints[].port`, `endpoints[].url`, `domain` and
  `expectedUploadEndpoint`. Every one of them is nullable on purpose; none may be coerced to `''`, `0`
  or a guessed host to make the field non-null.
- **`domain` is returned in both modes**, including when `useTraefik` is `false`. It is not filtered by
  mode here — `web` labels it as not in effect.

Errors: the only failure path is a non-administrator or a service principal, both already covered by
`AdminGuard` throwing `error.auth.admin_required`. No new key, no new exception, nothing for this
slice to add.

## Tests

`src/environment/environment.service.spec.ts` — owed under Article IX, because both failures it
defends against produce **no error anywhere**. Open the file with the one-paragraph header naming that
class of failure, and write both cases fault-injection style: each must be verified to fail when the
rule it covers is removed.

- **A fabricated host in port mode.** With `useTraefik: false`, every `endpoints[].url` and
  `expectedUploadEndpoint` must be `null`. A `?? 'localhost'` added to the derivation makes this suite
  fail; without the suite it makes the panel confidently recommend a value that breaks uploads for
  every device that is not the host (`../plan.md` § Risks, row 1).
- **The allowlist (AC-8).** The returned object's keys — top level and per endpoint — are exactly the
  contract's. This is the test that fails the day someone adds a convenient `databaseUrl` or returns
  `process.env` wholesale, which is otherwise invisible on an admin-only screen.
- Also cover, in the same suite since they are one-liners off the same fixtures: Traefik mode derives
  all four URLs and `expectedUploadEndpoint` correctly from a domain; a `null` domain with
  `useTraefik: true` still yields `null` URLs (a half-configured install must not produce
  `http://api.null/uploads`); an unset port reads `null`, not `0`.

**`environment.resolver.ts` is owed no test of its own** beyond the guard placement. `AdminGuard` is
already covered where it lives, and the resolver is a one-line delegation. The one thing worth an
assertion — that the guard is on the method — follows `ffprobe-logs.resolver.spec.ts`'s technique of
reading the metadata Nest actually resolves; add it there only if it costs a handful of lines, since
unlike the `ffprobe-logs` case there is no `@AllowService()` method on this resolver whose rejection
would be swallowed, so a misplaced guard here fails loudly on the first non-admin call rather than
silently.

`environment.module.ts`'s factory is not unit-tested: it reads `process.env`, which is exactly the
thing the token exists to keep out of the tests. Its correctness is proven by the `docker compose
config` check in `../infra/plan.md` and by the manual pass in `../plan.md` § Verification.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
```

0 typecheck errors; the suite green with the new cases (baseline was **471** tests across **43**
suites — report the new numbers rather than citing that one); and `git status --short
services/api/prisma` **empty** — this feature has no migration, so a new migration directory there is a
defect, not progress.
