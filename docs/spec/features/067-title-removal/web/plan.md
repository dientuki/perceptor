---
title: Title Removal — web slice
service: web
last_updated: 2026-09-20
status: Approved
---

# PLAN: Title Removal — `web` (`web/plan.md`)

## Scope

`web` owns the button, the confirmation dialog, the two server actions, the post-removal redirect
and the message catalogs. Its one real requirement is REQ-7: the dialog must tell the user, before
they confirm, which of the two irreversible things is about to happen — and that is read from
`otherOwners`, which `api` exposes on `Movie` and `Show` for exactly this.

`web` does **not** decide which removal happens. It renders a warning from `otherOwners` and reports
the outcome from the `TitleRemoval` the mutation returns; those two can legitimately disagree if
another user registers the same title in between, and when they do the mutation is right. Do not add
a re-check, a poll or a lock — `../plan.md`'s risk table settles this.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/media/RemoveTitleModal.tsx` | New | The shared confirmation dialog for both media types. |
| `services/web/src/components/movies/Movie.tsx` | Modified | Remove button beside the existing file/magnet buttons; wires the modal through `useModal`. |
| `services/web/src/components/shows/Show.tsx` | Modified | The same button for a series. |
| `services/web/src/actions/movies.ts` | Modified | `removeMovieAction`; `otherOwners` added to `GET_MOVIE_QUERY` and the `Movie` interface. |
| `services/web/src/actions/shows.ts` | Modified | `removeShowAction`; `otherOwners` added to the show detail query and its type. |
| `services/web/messages/en.json` | Modified | Dialog copy + `errors.movie.not_found` / `errors.show.not_available` (REQ-13). |
| `services/web/messages/es.json` | Modified | The same keys, Rioplatense register. |

## Existing code to reuse

- `services/web/src/components/downloads/DeleteDownloadModal.tsx` — the template for the whole
  dialog: `Modal` + `useModal`, error rendered inside the dialog via the shared `ERROR_CLASS`,
  `useEffect` clearing the error on every open so a cancel-then-reopen shows nothing stale,
  `isPending` on the confirm button, `variant="danger"`, and a conditional extra paragraph. Copy the
  shape; do not invent a second confirmation pattern.
- `services/web/src/hooks/useModal.ts` — already used twice in `Movie.tsx` for the file and magnet
  modals. The remove modal is a third instance, not a new mechanism.
- `services/web/src/actions/downloads.ts:213` — `deleteDownloadAction` is the exact action shape:
  `fetchGraphQL` → `redirectIfUnauthenticated(errors)` → `toActionError(errors[0])` →
  `{ success: true }`. The two new actions return the `TitleRemoval` payload alongside success
  instead of a bare boolean.
- `services/web/src/lib/graphql-error.ts` — `toActionError`/`translateGraphQLError` already resolve
  the locale and the `extensions.i18n` params (fixed under `059`). All four refusals travel this
  path; none needs special handling in the component beyond being displayed.
- `services/web/src/components/ui/button/Button.tsx` with `variant="danger"`, and `Trash2` from
  `lucide-react` — both already used by `DeleteDownloadModal`.
- `next/navigation`'s `useRouter().push(...)` for REQ-11, with `revalidatePath` in the action so the
  listing the user lands on is not served from cache with the removed title still in it — the
  pattern `services/web/src/actions/users.ts:84` already uses.

## Steps

1. Add `otherOwners` to the detail queries and the `Movie`/`Show` types in
   `actions/movies.ts`/`actions/shows.ts`. **Only the detail queries** — not `getMovies`,
   `getShows`, the billboard or the calendar; it is a per-row count and belongs nowhere near a
   listing (`../plan.md` § Contract Freeze).
2. Add `removeMovieAction(id)` / `removeShowAction(id)` following `deleteDownloadAction`, returning
   `{ success: true; deleted: boolean; remainingOwners: number }` or `{ error }`. Each calls
   `revalidatePath` for its listing (`/movies` and, for a short, `/shorts`; `/shows`) before
   returning.
3. Build `RemoveTitleModal.tsx`, taking the title's name, its `otherOwners`, whether it has a
   library file, and the action to call. Copy branches on `otherOwners > 0`:
   - `> 0` → "se quita de tu biblioteca", the title stays in Perceptor for the others.
   - `0` → "se elimina de Perceptor", with the in-flight downloads and encodes cancelled.
   - plus, when the title has a file in the library, one extra line saying the file itself stays
     (REQ-6/REQ-7) — the same conditional-paragraph shape `DeleteDownloadModal` uses for
     `status === "ENCODING"`.
4. Wire the button into `Movie.tsx` in the existing `flex flex-wrap gap-3` row next to the file and
   magnet buttons, and into `Show.tsx` in its equivalent.
5. On success, close the modal and `router.push` to `/movies`, `/shorts` (when `isShort`) or
   `/shows`. On error, keep the modal open with the message; leave the confirm button enabled so a
   `torrent_client_rejected` can be retried once the container is back (NFR-2 guarantees nothing
   was removed), and disabled-after-terminal is **not** required — do not add state to distinguish
   them beyond what the copy needs.
6. Add every new key to **both** `en.json` and `es.json`, including the two REQ-13 keys that exist
   in neither today: `errors.movie.not_found` (takes an `{id}` param) and
   `errors.show.not_available` (no params). Run `check-messages.mjs`.

## Contract obligations

`web` consumes, from `../spec.md` § GraphQL Contract Delta: `otherOwners: Int!` on `Movie` and
`Show`, and `removeMovie(id: Int!)` / `removeShow(id: Int!)` returning
`TitleRemoval { deleted, remainingOwners }`. There is no codegen — every field name here is retyped
by hand and a typo fails only at runtime.

All four error conditions must be handled, not just the happy path:

| Key | What `web` does |
| :-- | :-- | 
| `error.movie.not_found` / `error.show.not_available` | Show the translated message in the dialog. Terminal — the title is already gone or was never the caller's. Needs the new catalog entries (REQ-13) or it renders in English. |
| `error.media.type_disabled` | Show the translated message in the dialog. Terminal. |
| `error.download.torrent_client_rejected` | Show the translated message; the removal did **not** happen and nothing was touched, so the user may confirm again. |
| `error.auth.unauthenticated` | Handled upstream by `redirectIfUnauthenticated` in the action, as every other action does. |

A successful `{ deleted: false }` is **not** an error and must not be rendered as one: it is REQ-3
working, and the user should see that the title was removed from their library.

## Tests

`web` has no test suite (`services/web/CLAUDE.md`). Nothing in this slice is owed one, and none is
added. What would otherwise be silent here — the dialog promising the wrong outcome — is covered by
AC-15 and AC-17 in the manual pass, and by the `otherOwners` semantics being asserted on the `api`
side. The catalog completeness that REQ-13 turns on is checked mechanically by
`scripts/check-messages.mjs`, which is why it is in the Done-when block rather than left to review.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Typecheck 0 errors, build exits 0, and the message check reports no `en`/`es` drift at the new key
count.
