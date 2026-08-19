---
title: Reproducible Image Builds — web slice
service: web
last_updated: 2026-08-19
status: Implemented
---

# PLAN: Reproducible Image Builds — `web` (`web/plan.md`)

## Scope

REQ-10 / D3: take the upload endpoint out of the browser bundle.

`importFileModal.tsx:95` passes `endpoint: process.env.NEXT_PUBLIC_UPLOAD_URL` to `tus.Upload`.
Next inlines `NEXT_PUBLIC_*` **at build time**, and this feature's whole point is an image built on
a machine that knows nothing about the deployment — so that value would be baked in as `undefined`
and every upload would go nowhere. The URL must be read on the server, at request time, and handed
to the component.

The natural seam already exists: the modal already `await`s a server action
(`createUploadTicketAction`) immediately before constructing the upload, on line 78. The endpoint
rides along with the ticket. **Do not add a second server action, a route handler, or a context
provider** for one string.

Explicitly **not** this slice: the compose `environment:` rename from `NEXT_PUBLIC_UPLOAD_URL` to
`PUBLIC_UPLOAD_URL` (`../infra/plan.md`), the `.dockerignore`, the `Dockerfile`, and anything about
`next build` itself — `016-web-build-errors` already left `bin/npm web run build` exiting 0 and this
slice must keep it there.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/uploads.ts` | Modified | `UploadTicket` gains `endpoint: string`; the action reads `process.env.PUBLIC_UPLOAD_URL` and throws in Spanish when it is unset. |
| `services/web/src/components/import/importFileModal.tsx` | Modified | `endpoint: ticket.endpoint` instead of `process.env.NEXT_PUBLIC_UPLOAD_URL`. |

## Existing code to reuse

- **`services/web/src/actions/uploads.ts`** — the `'use server'` action that already runs on the
  Next server, already calls `fetchGraphQL`, and already throws Spanish `Error`s the modal catches
  and shows (`"Error al generar el permiso de subida"`). Extend its return value; do not create a
  neighbour.
- **`importFileModal.tsx`'s existing `try/catch` around `createUploadTicketAction`** (lines 76–83) —
  it already sets `status: "error"` and renders `err.message`. A missing `PUBLIC_UPLOAD_URL` surfaces
  through that same path with no new UI, no new state and no new branch.
- **The GraphQL call stays exactly as it is.** `CREATE_UPLOAD_TICKET_MUTATION`, its `$movieId`/
  `$episodeId` variables and the named-argument construction below it are untouched. The endpoint is
  local knowledge of `web`'s server, not something `api` returns.

## Steps

1. In `actions/uploads.ts`, add `endpoint: string` to the `UploadTicket` interface. Note in a
   comment that the field is filled by `web`'s server, not by the mutation — the interface currently
   reads as a mirror of the GraphQL type and someone will otherwise go looking for it in
   `schema.gql`.
2. In `createUploadTicketAction`, after the existing error handling, read
   `process.env.PUBLIC_UPLOAD_URL`. If it is missing or empty, `throw new Error(...)` with a Spanish
   message naming the variable — user-facing copy is Spanish (Article VI's exception), and naming
   the variable is what turns a dead progress bar into a fixable one.
3. Return `{ ...data.createUploadTicket, endpoint }`.
4. In `importFileModal.tsx`, replace line 95's `endpoint: process.env.NEXT_PUBLIC_UPLOAD_URL` with
   `endpoint: ticket.endpoint`. Keep the surrounding comment about `movieId` metadata (it documents
   the naming debt in root `CLAUDE.md` and is still true).
5. `grep -rn "NEXT_PUBLIC" services/web/src` must come back **empty**. Any remaining hit is another
   build-time inlining this feature has to remove or explicitly leave with a reason.

## Contract obligations

`../spec.md` § *GraphQL Contract Delta* is **None**, and this slice is the one most likely to break
that by accident. What it consumes is unchanged:

```graphql
mutation CreateUploadTicket($movieId: Int, $episodeId: Int) {
  createUploadTicket(movieId: $movieId, episodeId: $episodeId) { token expiresAt }
}
```

Exactly one of the two arguments is supplied, by name, and both error conditions the action already
handles (`errors[]` from the api — including the auth redirect via `redirectIfUnauthenticated` — and
a `null` payload) stay handled. `endpoint` is **not** requested from `api` and must not be added to
that selection set. There is no codegen: adding a field `api` does not expose fails at runtime, in
the one flow that moves multi-gigabyte files.

The name `PUBLIC_UPLOAD_URL` is owed to this slice by `../infra/plan.md`, which sets it in the
container's `environment:`. It is the same name `.env.example` already uses on the host.

## Tests

**None owed** — `web` has no test runner (its `package.json` scripts are `dev`/`build`/`start`/
`lint`/`format`), and this feature is not the place to introduce one.

The failure this change defends against is genuinely silent, though, which is why the guard is a
throw rather than a fallback: `new tus.Upload(file, { endpoint: undefined })` does not complain, so
the user gets a progress bar for an upload that will never arrive. Article IX's concern is answered
in the code path itself — fail loudly, in Spanish, before the upload is constructed — and verified
by AC-8 against a container built without the URL.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/npm web run lint
```

0 errors, build exits 0, lint clean. Then, manually: open the file-upload modal on a film in the
running dev stack and upload a small file end to end — it must still reach `api`, proving the
endpoint now arrives from the server action.
