---
title: The GraphQL Contract
spec_version: 1.2.0
author: Juan Farias
created_at: 2026-08-09
last_updated: 2026-08-11
status: Approved
target_service: api, web, worker
---

# SPEC: The GraphQL Contract (`graphql-contract.md`)

## Context & Goal

GraphQL is the only way `web` and `worker` reach `api` (Constitution, Article II). It is also the
only thing the three services share: they have separate `package.json` files, separate toolchains,
separate containers, and no common package.

That makes the schema the single seam of the whole system — and it is a seam **without a
compiler across it**. `api` generates its schema from decorators; `web` and `worker` retype the
parts they use, by hand, in TypeScript. Nothing checks that the two halves agree.

This document is what an implementer or agent reads before touching that seam. It exists because
the failure mode here is the worst kind: a mismatch compiles cleanly on both sides and fails at
runtime, on a code path that may not run until a torrent finishes an hour later.

## How the schema is produced

`services/api/src/app.module.ts` configures Apollo code-first:

```ts
autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
```

The decorators in each module's `entities/*.entity.ts` and `dto/*.input.ts` are the source of
truth. `services/api/src/schema.gql` is regenerated on every boot and opens with a
generated-file banner. **It is never hand-edited** (Constitution, Article IV) — the next boot
silently reverts the edit, which is exactly the kind of change that looks applied and is not.

To read the current contract:

```bash
bin/cli api cat src/schema.gql
```

## How it is consumed

### Exposed consumers

| Consumer | Client | Errors | Types |
| :-- | :-- | :-- | :-- |
| `web` | `services/web/src/lib/graphql-client.ts` — `fetchGraphQL<T>` | Returned as `{ data, errors }`; **each caller checks** | Hand-written in `src/types/*.ts` and inline |
| `worker` | `services/worker/src/api/graphql-client.ts` — `fetchGraphQL<T>` | **Throws** on `json.errors` | Hand-written in `src/queue/types.ts` and inline |

The two clients differ deliberately, and the reason is written at the top of the worker's:
`web` renders errors to a user, so it must be able to see them; a worker that swallowed an error
would mark the job completed without having written anything.

**Both clients authenticate every call** (`002-auth-login`): `api` requires a credential on every
operation except `login` (`JwtAuthGuard`, registered as `APP_GUARD` in `app.module.ts`). `web`'s
`fetchGraphQL` reads the session cookie via `cookies()` and forwards it as `Authorization: Bearer
<token>`; `worker`'s `fetchGraphQL` forwards `Authorization: Bearer $SERVICE_TOKEN`, a machine
credential distinct from a user session (no `id`, no expiry — see `services/api/CLAUDE.md`'s
`auth/` bullet). A third caller, `services/torrent/commands/on-torrent-completed.sh`, sends the
same `SERVICE_TOKEN` outside either client, straight from `curl`.

**The cookie name is a cross-runtime boundary fact, not just a `web`-internal detail.** `api` reads
it via `AUTH_COOKIE_NAME` in `services/api/src/auth/auth.constants.ts`; `web` writes it via
`CONFIG.authCookie` in `services/web/src/lib/config.ts`. Both currently hold the literal
`"auth_token"`. There is no shared package to enforce this — same seam as the schema itself — so a
change to one without the other silently breaks every browser session while leaving the bearer
carrier (what `web`'s own server actions use) completely unaffected, which makes the failure easy
to miss in testing that only exercises `web`→`api` calls.

### The `web` server-action pattern

Every file in `services/web/src/actions/` follows the same shape. Reproduce it rather than
inventing a variant:

```ts
'use server'

import { fetchGraphQL } from '@/lib/graphql-client';

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients { mediaServerClients { id label } }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{ mediaServerClients: MediaServerOption[] }>(
    MEDIA_SERVER_CLIENTS_QUERY,
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener los media servers soportados');
  }

  return data?.mediaServerClients ?? [];
}
```

- `'use server'` on line 1.
- Document as a module-level `const NAME_QUERY` / `NAME_MUTATION`, SCREAMING_SNAKE.
- The response shape is passed as the `fetchGraphQL<T>` type parameter — **this is the hand-copied
  part**, see the next section.
- Errors: read `errors[0].message`, fall back to a Spanish user-facing string.

Two return conventions coexist, both valid: read functions `throw`; form actions used with
`useActionState` take `(prevState, formData)` and return `{ error?: string } | { success: true }`
(see `updateSettingsAction` in `services/web/src/actions/settings.ts`).

## The gap: no codegen

There is no `@graphql-codegen`, no `graphql` package in `web`, no schema check in CI (there is no
CI). The type parameter on every `fetchGraphQL<T>` call is a human's copy of what `api` returns.

**Consequences an implementer must plan around:**

| Change on `api` | What TypeScript says in `web`/`worker` | What actually happens |
| :-- | :-- | :-- |
| Field renamed | Nothing — the hand-written type still has the old name | Field arrives `undefined` at runtime |
| Field made nullable | Nothing | `null` flows into code that assumed a value |
| Non-null argument added | Nothing | Every call fails with a GraphQL validation error |
| Enum value added | Nothing | Falls through a `switch` with no default |
| New error condition | Nothing | Consumer treats a failure as success |

The last row is the one that matters most, and it is why `spec.md`'s `## GraphQL Contract Delta`
requires an error table and not just SDL. A consumer that implements only the happy path compiles,
lints, and is wrong.

### What to do when the schema changes

1. Write the delta in the feature's `spec.md` **before** implementing (Constitution, Article VIII).
2. On the `api` side, change the decorator and let `schema.gql` regenerate. Confirm the diff
   matches the delta.
3. For each consumer in the feature's `services:` list, grep for the affected operation and update
   the hand-written type **and** the error handling:
   ```bash
   grep -rn "<mutationOrQueryName>" services/web/src services/worker/src
   ```
4. If a consumer is *not* in `services:` but the grep finds a hit there, the spec is wrong. Stop
   and report — do not fix it quietly in a slice that was never scoped for it.

### Additive changes are safe, and are the default

Adding a nullable field or a new mutation breaks no existing consumer. Renaming, removing, or
tightening nullability does. Prefer additive changes; when a breaking change is genuinely right,
it is a requirement in `spec.md`, not a detail in a plan.

## Contracts & Interfaces

### `users` operations are admin-only

Since `003-auth-user-management`, `User` carries `isAdmin: Boolean!` and the five `users`
operations (`users`, `user`, `createUser`, `updateUser`, `removeUser`) require the caller to be an
admin, not just authenticated. `AdminGuard` (`services/api/src/auth/guards/admin.guard.ts`) reads
`isAdmin` fresh from the database on every call — it is deliberately never embedded in the JWT, so
a demoted admin's still-valid session stops working immediately instead of at token expiry. A
non-admin caller gets `No tenés permisos para administrar usuarios` from every one of the five.

No schema shape changed beyond the additive `isAdmin` field — `removeUser` still takes only `id`;
the caller is read server-side via `@CurrentUser()`, not passed as an argument. `createUser` has no
`isAdmin` argument — the `/users` screen can only create ordinary users.

### Users can be disabled (`004-user-disable`)

`User` also carries `isEnabled: Boolean!`, and `UpdateUserInput` gained `isEnabled: Boolean` —
additive, no shape change to `updateUser` itself. `updateUser` now reads its caller via
`@CurrentUser()`, the same way `removeUser` already did — no new GraphQL argument for "who is
asking". `isEnabled` is deliberately not on `CreateUserInput`: a user is always created enabled.

A disabled user's `login` is refused, and disabling revokes every session that user currently
holds (not just their next login attempt) — see `services/api/CLAUDE.md`'s `auth/` bullet for the
per-user Redis SET this uses. `updateUser` refuses two attempts, mirroring `remove()`'s existing
self/last-admin safeguards:

| Condition | Exception | Message |
| :-- | :-- | :-- |
| Correct credentials, account disabled (`login`) | `UnauthorizedException` | `Tu cuenta está deshabilitada` |
| Admin disabling their own account | `BadRequestException` | `No podés deshabilitar tu propio usuario` |
| Admin disabling the last enabled administrator | `BadRequestException` | `No podés deshabilitar al único administrador` |

`Tu cuenta está deshabilitada` is a sixth user-facing string on the login/session boundary that
`002-auth-login`'s `spec.md` froze at five — see that file's dated pointer for why `002` itself was
not reopened.

### `movies` and `addMovie` are scoped to the caller, with unchanged signatures (`005-movie-search`)

A film is a single shared `Movie` row (`tmdbId @unique`, never duplicated) joined to `User` through
`UserMovie` — one movie, many owners, one shared download/encode status. `movies: [Movie!]!` and
`addMovie(tmdbId: Int!): Movie!` kept byte-identical shapes across this change: `movies` now
returns only the films the caller has registered (previously every film in the system), and
`addMovie` now also links the caller to the film in addition to creating/returning it. **Neither
change is visible to a typechecker** — this is exactly the class of risk this document's "gap"
section warns about, and it is why this section exists rather than leaving the semantic shift
implicit in the unchanged SDL. `movie(id)` was deliberately left unscoped: any authenticated user
can still read a single film by internal id, because the catalog itself is shared.

`MediaSearchResult` (returned by `searchMovies`) gained two additive fields: `movieId: Int`
(`Movie.id` if *any* user has registered this film, `null` otherwise) and `inLibrary: Boolean!`
(true only for the calling user). They answer different questions on purpose — collapsing them into
one nullable id would make "registered, but not by me" unrepresentable. **Never treat `movieId !==
null` as an ownership test**; only `inLibrary` means "mine". `searchMovies` computes both **after**
its best-effort write to the shared, 24-hour Redis cache (`tmdb:movie:<tmdbId>`) — that cache key is
read by every user who searches the same film, so enriching before the cache write would leak one
user's ownership into what every other user sees for a day, with no error anywhere. Any future
change to `searchMovies` must preserve that ordering.

`attachTorrentSource` (backing `addTorrentToMovie`/`addMagnetToMovie`) now also requires the
caller's link, refusing an unowned film with the same `NotFoundException('La película <id> no
existe')` it already used for a missing one — deliberately one string, not a second "no es tuya"
message (see `005-movie-search/spec.md` § Errors for why).

### The one non-GraphQL route

`POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`) is the project's only REST
endpoint, and the exception is closed (Constitution, Article II). The browser talks to `api`
directly, bypassing `web`, because a resumable multi-gigabyte tus upload fits neither a GraphQL
mutation nor a Next Server Action (1 MB body limit by default).

`onUploadFinish` closes its own loop — creates the `MediaSource`, updates the `Movie`, enqueues
`bull:process` — inside the request that receives the last chunk, so there is no window in which a
file exists but is unregistered.

Since `002-auth-login`, the route also authenticates — separately from the GraphQL guard, which
never reaches non-GraphQL contexts. A signed-in user mints a short-lived, single-use ticket via the
`createUploadTicket` GraphQL mutation; the browser sends it as `Authorization: Bearer <ticket>` on
the tus `POST`; `onUploadCreate` verifies and spends it. See `services/api/CLAUDE.md`'s `uploads/`
bullet for the mechanism.

### The queue payload is a second, parallel contract

`api` → `worker` also communicates through BullMQ, and that payload is **not** covered by the
GraphQL schema. Both ends declare it, and both files say so in their opening comment:

- `services/api/src/queue/types.ts` — producer
- `services/worker/src/queue/types.ts` — consumer

They must be changed together. Nothing enforces it. A feature touching the queue declares that
payload in its `spec.md` the same way it declares the GraphQL delta.

### What never crosses the boundary

- **Absolute container paths.** Constitution, Article V — `web` sees host paths, `worker` receives
  a resolved `outputRoot`, and `MediaRootsService` owns every translation.
- **Prisma types.** `grep -rn "@prisma/client" services/web/src services/worker/src` must return
  nothing. Enums crossing the boundary are re-declared as GraphQL enums or plain string unions
  (`services/web/src/types/media.ts`).

## Known debt

- **No codegen.** The whole "gap" section above exists because of this. Fixing it means adding
  `@graphql-codegen` against `services/api/src/schema.gql` in both consumers — it touches two
  `package.json` files and both build pipelines, so it is a feature in its own right and a good
  candidate for the first real `/specify`.

Both items formerly logged here — `fetchGraphQL` logging full request bodies (including the
plaintext login password) and the `CONFIG.authTtoken` typo — were fixed by `002-auth-login`
(REQ-2, REQ-7). See `services/web/CLAUDE.md`'s Auth section for the current shape.
