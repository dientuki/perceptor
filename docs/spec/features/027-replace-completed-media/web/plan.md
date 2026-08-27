---
title: Replace a completed media — web slice
service: web
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Replace a completed media — `web` (`web/plan.md`)

## Scope

`web` owns the consent: the warning that tells the user, before anything happens, that the file
already in the library is going to be replaced, and the confirm control that sends `force: true`.
It owns every string the user reads, in both locales.

It also has to fix the thing that makes today's replacement unreachable. `SearchTorrent.tsx` and
`importMagnetModal.tsx` detect the conflict with `message.includes(t("conflictMarker"))`; `api`
sends English and `es`'s marker is `"ya tiene una descarga en curso"`, so in Spanish the
*Reemplazar* button never appears at all. Substring matching goes, key matching replaces it
(REQ-11), and that means the acquisition server actions must stop flattening the error into a bare
`Error` — the `extensions.i18n.key` is lost at the `throw new Error(await translateGraphQLError(...))`
boundary today.

`web` does not decide when a replacement is legal and does not delete anything. `api` is
authoritative: the client-side `status` read is an affordance that lets the warning appear before
the first round trip, not a permission check.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/graphql-error.ts` | Modified | `toActionError(error)` beside `translateGraphQLError` — returns the translated message **and** the raw key. |
| `services/web/src/types/media.ts` | Modified | `AcquisitionResult`, the discriminated return of the five acquisition actions. |
| `services/web/src/actions/imports.ts` | Modified | `importMagnetAction` returns `AcquisitionResult` instead of throwing. |
| `services/web/src/actions/indexer.ts` | Modified | Same for `addTorrentToMovieAction`. |
| `services/web/src/actions/shows.ts` | Modified | Same for `addTorrentToEpisodeAction` / `addMagnetToEpisodeAction`. |
| `services/web/src/actions/uploads.ts` | Modified | `createUploadTicketAction(target, force)`; `$force` in the mutation; returns a result object. |
| `services/web/src/components/import/ReplaceWarning.tsx` | New | The one warning block, shared by all three entry points. |
| `services/web/src/components/import/importMagnetModal.tsx` | Modified | Renders the warning; sends `force`; branches on key. |
| `services/web/src/components/import/importFileModal.tsx` | Modified | Warning gates the file picker; passes `force` to the ticket. |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | Warning banner; sends `force`; branches on key. |
| `services/web/messages/en.json` | Modified | New `errors.*` and `import.replace.*` keys; `conflictMarker` deleted. |
| `services/web/messages/es.json` | Modified | The same set, Rioplatense register. |

## Existing code to reuse

- `src/lib/graphql-error.ts`'s `translateGraphQLError` — the whole key→catalog→fallback ladder,
  including the `error.` prefix strip and the never-return-a-raw-key rule. `toActionError` wraps it;
  it does not reimplement it.
- `src/types/media.ts`'s `AcquisitionTarget` — already carries the full `Movie` / `Episode`, so
  `target.movie.status` / `target.episode.status` is the `COMPLETED` read. Do not add a `status`
  prop to the modals; do not reintroduce a bare id/type pair (`services/web/CLAUDE.md` § The
  `AcquisitionTarget` union).
- `src/lib/auth-session.ts`'s `redirectIfUnauthenticated` — stays first in every action's error
  branch, before the result object is built. These are Server Actions, so this is the correct one of
  the two helpers; do not swap it for `redirectToClearSession`.
- `src/components/ui/modal` and the existing markup in `importMagnetModal.tsx` — the warning block
  is styled in the same idiom (the existing inline `text-error-500` error paragraph is the closest
  reference). Errors render inline, never through `window.confirm()`
  (`services/web/CLAUDE.md` § Small conventions).
- `messages/{en,es}.json`'s `errors` namespace and `scripts/check-messages.mjs` — the parity gate.

## Steps

1. `src/lib/graphql-error.ts`: add
   `export async function toActionError(error: GraphQLErrorLike): Promise<{ error: string; errorKey?: string }>`
   — `error` is `await translateGraphQLError(error)`, `errorKey` is `error.extensions?.i18n?.key`
   passed through untouched (no prefix strip: the components compare against the full
   `error.movie.already_completed` form). Do not change `translateGraphQLError`.
2. `src/types/media.ts`: add
   ```ts
   export type AcquisitionResult =
     | { success: true; id: number; status: string }
     | { error: string; errorKey?: string };
   ```
   This matches the `{ error?: string } | { success: true }` shape `services/web/CLAUDE.md` already
   documents for write actions. It exists because a `throw` from a Server Action loses
   `extensions.i18n.key` — the message survives, the key does not, which is the whole reason the
   Spanish path is broken today.
3. `src/actions/{imports,indexer,shows}.ts`: change the four acquisition actions to return
   `AcquisitionResult`. Keep `redirectIfUnauthenticated(errors)` as the first thing in the error
   branch, then `return await toActionError(errors[0])`. The `force` parameter and the mutation
   documents are already correct — do not touch the GraphQL strings.
4. `src/actions/uploads.ts`: add `$force: Boolean` to `CREATE_UPLOAD_TICKET_MUTATION` and pass it
   through `createUploadTicketAction(target, force = false)`. Change the return to
   `{ success: true; ticket: UploadTicket } | { error: string; errorKey?: string }` so the
   pre-flight refusal (which is now the *expected* outcome for a `COMPLETED` target) reaches the
   modal as data rather than a thrown error. The two local `throw`s for a missing ticket and an
   unset `PUBLIC_UPLOAD_URL` become the same failure shape.
5. `src/components/import/ReplaceWarning.tsx` (new, client): a presentational block taking the
   target's label and rendering the warning copy plus nothing else — the confirm control stays in
   each caller, because each one already owns a differently-shaped submit (a form button, a
   per-row button, a file input). One component so the sentence that warns about destroying a file
   is written once.
6. `src/components/import/importMagnetModal.tsx`: derive
   `isCompleted = target.kind === "movie" ? target.movie.status === "COMPLETED" : target.episode.status === "COMPLETED"`.
   When true, render `<ReplaceWarning />` above the input from the start and submit with
   `force: true` — the user has read the warning, there is no reason to spend a refused round trip
   first. Replace the `catch`/`includes` block with a check of the returned `errorKey` against the
   three `*_already_completed` and three `*_download_in_progress` keys, setting `needsConfirm` on
   either. Delete `CONFLICT_MESSAGE`.
7. `src/components/import/importFileModal.tsx`: when `isCompleted` and the user has not confirmed
   yet, render `<ReplaceWarning />` **in place of** the file input, with a confirm button that sets
   local `replaceConfirmed` state — the picker only appears afterwards. Pass that state as `force`
   into `createUploadTicketAction`, and handle its new result shape. The refusal now arrives before
   any byte is uploaded (REQ-6), which is the point. `translateUploadError` and the REST envelope
   reader stay exactly as they are — `onUploadFinish`'s mid-upload race still comes back that way.
8. `src/components/search/SearchTorrent.tsx`: render `<ReplaceWarning />` once at the top of the
   results area when `isCompleted`, and pass `force: isCompleted` into `submitTorrent` for the
   first attempt. Rewrite `handleAddTorrent`'s error branch to read `errorKey` from the returned
   result instead of `message.includes(CONFLICT_MESSAGE)`; `handleConfirmReplace` keeps its shape.
   Delete `CONFLICT_MESSAGE`.
9. `messages/en.json` and `messages/es.json`: add, under `errors`, the six keys REQ-11 names —
   `movie.already_completed`, `episode.already_completed`, `season.already_completed`,
   `movie.download_in_progress`, `episode.download_in_progress`, `season.download_in_progress`.
   The last three are **pre-existing keys `api` already emits and neither catalog has**, which is
   why those messages render in English today. Add the `import.replace.*` UI copy the new component
   and the two confirm controls need. **Delete** `search.torrent.conflictMarker` and
   `import.magnet.conflictMarker` from both files — nothing reads them after step 6 and step 8, and
   leaving them invites the substring pattern back.
10. Run `bin/cli web node scripts/check-messages.mjs` and fix any parity drift before typechecking.

## Contract obligations

Read `../spec.md` § GraphQL Contract Delta. It is read-only; if it is wrong, stop and report.

What this slice sends:

```graphql
createUploadTicket(movieId: Int, episodeId: Int, force: Boolean = false): UploadTicket!
```

plus the five existing `add*` mutations, whose signatures do **not** change — only which error they
answer with. There is no codegen: these documents are hand-copies, and a wrong argument name fails
at runtime, not at build.

Every error condition this slice must handle, from `../spec.md` § GraphQL Contract Delta:

| `extensions.i18n.key` | What this slice does |
| :-- | :-- |
| `error.movie.already_completed` / `error.episode.already_completed` / `error.season.already_completed` | Render the replacement warning and offer a confirm control that re-issues the same call with `force: true`. Distinct, stronger copy than the row below — it names the file being destroyed. |
| `error.movie.download_in_progress` / `error.episode.download_in_progress` / `error.season.download_in_progress` | Keep today's retry-with-`force` affordance, now selected by key. Milder copy: there is no finished file at stake. |
| `error.movie.not_found` / `error.episode.not_found` | Surface the message, offer no retry. |
| `error.upload.target_ambiguous` | Surface the message, offer no retry. This is a bug in the caller, not a user error. |
| `error.magnet.*` (`not_a_magnet`, `invalid_infohash`, `v2_unsupported`, `already_attached`) | Unchanged: inline error, no retry, the user edits the magnet. |
| Anything else, or no key at all | `translateGraphQLError`'s existing fallback to the English `message`. Never render the raw key. |

The REST `/uploads` envelope (`{ message, i18n: { key, params? } }`, no `extensions` wrapper) is
unchanged by this feature and `importFileModal.tsx` keeps reading it directly.

## Tests

**None, and this is deliberate.** `services/web` has no test runner and this feature does not
introduce one (`services/web/CLAUDE.md` § Testing). The two failure modes in this slice that would
otherwise be silent are covered elsewhere:

- The key→copy mapping drifting between locales is caught by `scripts/check-messages.mjs`, a plain
  parity script with an exit code, which step 10 runs.
- The key *values* themselves are owned and tested by `api` (`../api/plan.md` § Tests); if `web`
  branches on a key `api` never emits, the branch is dead and the user sees the generic fallback
  message with no confirm control — reachable in the manual pass (`../plan.md` § Verification,
  steps 2 and 7), which is where a locale bug of exactly this shape is meant to be caught.

Do not add a test runner to reach a number.

## Done when

```bash
bin/cli web node scripts/check-messages.mjs
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

Expected: `check-messages` exits 0, 0 typecheck errors, `build` exits 0. Measure the typecheck
before touching anything and report both numbers. `bin/npm web run lint` is **not** a gate here —
`biome check` reports ~1598 pre-existing errors across the template; judge the new and modified
files by running Biome on those paths only.

Two greps must return nothing when this slice is done:

```bash
grep -rn "conflictMarker" services/web/src services/web/messages
grep -rn "message.includes" services/web/src/components
```
