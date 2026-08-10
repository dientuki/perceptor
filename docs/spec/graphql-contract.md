---
title: The GraphQL Contract
spec_version: 1.0.0
author: Juan Farias
created_at: 2026-08-09
last_updated: 2026-08-09
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

### The one non-GraphQL route

`POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`) is the project's only REST
endpoint, and the exception is closed (Constitution, Article II). The browser talks to `api`
directly, bypassing `web`, because a resumable multi-gigabyte tus upload fits neither a GraphQL
mutation nor a Next Server Action (1 MB body limit by default).

`onUploadFinish` closes its own loop — creates the `MediaSource`, updates the `Movie`, enqueues
`bull:process` — inside the request that receives the last chunk, so there is no window in which a
file exists but is unregistered.

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

- **`services/web/src/lib/graphql-client.ts` logs every request.** Two `console.log` calls dump the
  URL and the full request object — headers included, and the auth cookie
  (`CONFIG.authTtoken`) rides in those headers. This runs on the server, so it lands in the `web`
  container's logs rather than the browser, but it is still a credential in a log file. Left as-is
  here only because removing it is unrelated to this document; it should not survive long.

- **`CONFIG.authTtoken`** (`services/web/src/lib/config.ts`) has a typo in the name, and the typo
  is load-bearing — it is referenced across the auth flow. Renaming it is a mechanical change
  nobody has done yet.
