---
title: Manual Magnet Import — web slice
service: web
last_updated: 2026-08-09
status: Implemented
---

# PLAN: Manual Magnet Import — `web` (`web/plan.md`)

## Scope

Make the Magnet button work: a server action that calls the new mutation, and a modal that replaces
the non-compiling skeleton. Includes the confirm-and-replace flow when the movie already has a
download in progress.

Not doing: anything in `services/api/`. The infoHash, the conflict rules and the error strings are
all produced server-side; this slice displays them.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/actions/imports.ts` | New | `importMagnetAction(movieId, magnet, force)` |
| `src/components/import/importMagnetModal.tsx` | New (replaces `ImportMagnetModal.tsx`) | The working modal |
| `src/components/movies/Movie.tsx` | Modified | `MEDIA_TYPE.MOVIE`, drop the wrapper handler |

The rename is lowercase-first, matching its sibling `importFileModal.tsx` **and** the import that
`Movie.tsx` already had. On a case-sensitive filesystem the old name never resolved — that alone
broke the render.

Note the file is untracked, so `git mv` will fail; use plain `mv`.

## Existing code to reuse

- `src/components/import/importFileModal.tsx` — the modal layout, the inline-error convention, and
  the `onClose()` + `router.refresh()` close. Copy its structure; the two modals render side by
  side and diverging their shape for no reason is worse than a little repetition.
- `src/actions/media-server.ts` — the canonical server-action shape.
- `src/components/search/SearchTorrent.tsx` — the confirm-and-retry-with-`force` dance, and the
  `Number((item as Movie).id)` conversion.
- `src/hooks/useModal`, `@/components/ui/modal`, `@/components/ui/button/Button` — all exist.

## Steps

1. `src/actions/imports.ts`: `'use server'`, `ADD_MAGNET_MUTATION` as a module-level constant,
   `fetchGraphQL` with the response shape as the type parameter, `throw` on `errors[0].message`.
2. `mv ImportMagnetModal.tsx importMagnetModal.tsx`, then rewrite it. State: `magnet`, `isPending`,
   `error`, `needsConfirm`. Clear all four on open via `useEffect` on `isOpen`.
3. On submit: `importMagnetAction(Number(item.id), magnet, needsConfirm)`. Success → `onClose()` then
   `router.refresh()`. Failure → show the message inline and set `needsConfirm` when it contains
   `ya tiene una descarga en curso`; the button label becomes **"Reemplazar"** and the next submit
   sends `force: true`.
4. `Movie.tsx`: `mediaType={MEDIA_TYPE.MOVIE}` (the import at the top was already right, only the
   usage was wrong), and call `openMagnetModal` directly like the File button does.

## Contract obligations

Consume `addMagnetToMovie` exactly as `../spec.md` declares it, **including the whole error table**
— every one of those seven conditions reaches this modal as a thrown `Error` with a Spanish message
to render inline. There is no codegen; a happy-path-only consumer compiles and is wrong.

The substring match on `ya tiene una descarga en curso` is the contract, not a heuristic. If the
API's wording changes, this flow breaks silently — that is recorded in `../plan.md` § Contract
Freeze as a thing the `api` slice must not touch.

Keep the props identical to `ImportFileModal` (`item: Movie | Episode | null`, `mediaType`), typed
from `@/actions/movies` and `@/types/media` and **never** `@prisma/client`, even though only
`item.id` is used today.

## Tests

**None**, and that is correct: this service has no test runner (see `services/web/CLAUDE.md`), and
introducing one is not part of this feature. Nothing in this slice fails silently either — every
failure path ends in a visible message.

The verification here is the typecheck, Biome, and actually clicking the button.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

The typecheck error count must **go down** — the old `ImportMagnetModal.tsx` and the wrong
`MediaType` in `Movie.tsx` were contributing several. Then, on `/movies/<id>`: the button opens the
modal, an invalid magnet renders its error inline with no `alert()`, and the movie's state is
unchanged afterwards.
