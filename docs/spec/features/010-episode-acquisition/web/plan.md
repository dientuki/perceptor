---
title: Per-Episode Acquisition (Search, Magnet, File) — web slice
service: web
last_updated: 2026-08-13
status: Implemented
---

# PLAN: Per-Episode Acquisition — `web` (`web/plan.md`)

> Before writing any Next.js code, read `services/web/AGENTS.md`: this is Next 16 and its APIs
> differ from what you likely remember. The relevant guide is in `node_modules/next/dist/docs/`.

## Scope

This slice makes the three per-episode buttons in the season accordion real: a search modal with a
prefilled query and a scrolling result body, a magnet modal, and a resumable file-upload modal —
each targeting the episode rather than a film. It also repairs the ported components those modals
are built from, which today either fail to compile or, worse, compile and send an episode id to a
film mutation.

It does **not** own any `api` change. The mutations it calls are frozen in `../spec.md`; if one is
wrong, stop and report rather than working around it. It does **not** touch
`importFolderModal.tsx` or `ImportMagnetSeasonModal.tsx` — season-level import is out of scope and
those two files are kept exactly as they are, including their 4 typecheck errors.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | Delete the placeholder `Episode` type (its comment says it is a stand-in until the API exposes episodes — the API does now). Add the discriminated union target type. |
| `src/actions/shows.ts` | Modified | Add `addTorrentToEpisodeAction` and `addMagnetToEpisodeAction`. `Episode` is already exported from here — it becomes the single `Episode` type in the service. |
| `src/actions/uploads.ts` | Modified | `createUploadTicketAction` takes a target, not a bare id; the mutation document gains `$episodeId` and both args become nullable. |
| `src/components/search/SearchTorrentModal.tsx` | Modified | Drop the `@prisma/client` import (Article II); retype against the union; keep it as the modal shell. |
| `src/components/search/SearchTorrent.tsx` | Modified | Remove the `mediaType !== MEDIA_TYPE.MOVIE` early return; branch to the episode mutation; make the result body scroll under a fixed header; replace `window.confirm` with the in-modal two-step confirm. |
| `src/components/import/importMagnetModal.tsx` | Modified | Dispatch on the union target; call the episode mutation for an episode. |
| `src/components/import/importFileModal.tsx` | Modified | Dispatch on the union target; send `episodeId` in the tus metadata for an episode. |
| `src/components/shows/SeasonAccordion.tsx` | Modified | Wire the three buttons; hoist the modal state so `EpisodeRow` can reach the handlers; accept `showTitle`. |
| `src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Pass `showTitle` down to each `SeasonAccordion`. |

## Existing code to reuse

- **`src/components/import/importMagnetModal.tsx`'s conflict flow** — `CONFLICT_MESSAGE`, the
  `needsConfirm` state, the button relabelling to "Reemplazar". This is the house pattern for the
  replace confirmation and `services/web/CLAUDE.md` names it the reference. `SearchTorrent.tsx`
  currently uses `window.confirm` instead, which that same document forbids ("Errors render inline,
  never through `alert()` or `window.confirm()`") — this feature is where that gets corrected, since
  the episode conflict string is new and both matchers have to change anyway.
- **`src/actions/media-server.ts`** — the canonical server-action shape (`'use server'` first line,
  `const NAME_MUTATION` in SCREAMING_SNAKE, the shape as `fetchGraphQL<T>`'s type parameter, errors
  from `errors[0].message` with a Spanish fallback). Copy it for the two new actions; do not invent
  a variant.
- **`src/hooks/useModal`** and **`src/components/ui/modal`** — already used by
  `src/components/movies/Movie.tsx` for exactly this pattern (two modals, one component). `Movie.tsx`
  is the working reference for how a detail view opens import modals; `SeasonAccordion` does the same
  thing with a third modal and a per-row active item.
- **`src/actions/shows.ts`'s existing `Episode` type** — the real one, added by `009-show-detail`.
  Everything must converge on it. `src/types/media.ts`'s `Episode` is a stub with only
  `id`/`episodeNumber`, and two types with the same name are how `SearchTorrent.tsx` and
  `SeasonAccordion.tsx` ended up disagreeing about what an episode is.
- **`SearchTorrent.tsx`'s existing query builder** (lines 39-54) — already produces
  `<Title> S04E01`, zero-padded, with the show title cleaned of punctuation. REQ-1 is already
  implemented; it just needs `showTitle` actually reaching it. Do not rewrite it.

## Steps

1. **Converge the `Episode` type.** Delete the placeholder from `src/types/media.ts`; import
   `Episode` from `@/actions/shows` everywhere it was used.
2. **Introduce the target union** in `src/types/media.ts`, replacing the
   `item: Movie | Episode` + `mediaType: MediaType` prop pair that every one of these components
   currently takes:

   ```ts
   export type AcquisitionTarget =
     | { kind: "movie"; movie: Movie }
     | { kind: "episode"; episode: Episode; showTitle: string; seasonNumber: number };
   ```

   This is the point of the step, not a stylistic preference: today the two props can disagree, and
   an episode paired with `MEDIA_TYPE.MOVIE` is exactly how an episode id reaches a `movieId`
   argument with no compile error (`../spec.md` § NFR-5). The union makes that unrepresentable.
   `showTitle` and `seasonNumber` stop being optional stragglers and become part of what an episode
   target *is* — which is also what fixes the `showTitle` that `SeasonAccordion` references today
   without ever receiving.
3. **Two new actions in `src/actions/shows.ts`**, mirroring `importMagnetAction`'s shape, returning
   `{ id, status }` from the `Episode` the mutations return. Handle the documented errors, not just
   the happy path — there is no codegen, so an unhandled condition compiles fine and fails in front
   of the user (see `docs/spec/graphql-contract.md`).
4. **`createUploadTicketAction` takes a target.** Both GraphQL arguments are now nullable, so pass
   them **by name** and send exactly one. Passing a bare positional id here is the specific way a
   film upload would silently start minting tickets for `undefined` (`../plan.md` § Risks).
5. **`SearchTorrentModal.tsx`**: drop `@prisma/client`, retype against the union, derive the heading
   text from it. `grep -rn "@prisma/client" services/web/src` must come back empty afterwards —
   this file is the last violation in the service.
6. **`SearchTorrent.tsx`**:
   - Remove `if (mediaType !== MEDIA_TYPE.MOVIE) return;` and branch on the target's `kind`.
   - Replace `window.confirm` with the `needsConfirm` two-step from `importMagnetModal.tsx`. The
     substring it matches must catch the episode wording too — the film string is `Esta película ya
     tiene…` and the episode string is `Este episodio ya tiene…`, so match on the shared
     `ya tiene una descarga en curso`, which `CONFLICT_MESSAGE` already does. Do not match the
     full sentence.
   - **REQ-3, the scrolling body.** The results wrapper `<div>` sits inside a modal that is already
     `flex flex-col` with `max-h-[calc(100vh-2rem)]`, and `SearchTorrent`'s own root is already
     `flex-1 flex flex-col min-h-0 overflow-hidden` — the plumbing is there and unused. The wrapper
     needs `flex-1 min-h-0` and the scroll must live on `<tbody>`, not on the wrapper, or the header
     scrolls away with the rows. Each `<tr>` is already a CSS grid with fixed column widths, so
     `thead`/`tbody` can become block-level scroll containers without the columns drifting apart —
     check that alignment visually at several widths, because that is what breaks first.
7. **`importMagnetModal.tsx`** and **`importFileModal.tsx`**: dispatch on `target.kind`. For the
   file modal, the tus metadata carries `episodeId` for an episode and `movieId` for a film —
   `movieId` keeps its name and meaning (`../spec.md` § NFR-1). Delete the now-false comment at
   `importFileModal.tsx:96-97` that says the API cannot resolve episodes.
8. **`SeasonAccordion.tsx`**: hold `activeEpisode` plus the three `useModal()` triples in the
   accordion, and pass the open handlers into `EpisodeRow` as props. The uncommitted draft of this
   file calls `openSearchModal` from inside `EpisodeRow`, a sibling component that cannot see the
   accordion's scope — that is the cause of 3 of its 7 current typecheck errors, and passing handlers
   down is the fix, not moving state into the row. The handlers must set `activeEpisode` **before**
   opening, or every modal early-returns `null` on a null item. Accept `showTitle` as a prop.
9. **`shows/[id]/page.tsx`**: pass `show.title` into each `SeasonAccordion`.

## Contract obligations

`web` is a consumer, and there is no codegen — every type below is a hand copy that nothing checks.
The delta in `../spec.md` is read-only.

Consumed operations:

```graphql
addTorrentToEpisode(episodeId: Int!, infoHash: String!, urls: [String!]!, releaseTitle: String, force: Boolean = false): Episode!
addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!
createUploadTicket(movieId: Int, episodeId: Int): UploadTicket!
```

Every error condition, and what this service does with it:

| Message from `api` | What `web` does |
| :-- | :-- |
| `El episodio <id> no existe` | Render inline in the modal. Do **not** try to distinguish "missing" from "not yours" — the API deliberately does not. |
| `Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.` | Two-step in-modal confirm; resubmit with `force: true`. Never `window.confirm`. |
| `Ese magnet ya está asociado a «<title>»` | Render inline. No retry — `force` does not resolve this one. |
| `No parece un magnet link` / `El magnet no tiene un infoHash válido` / `Magnet de BitTorrent v2, todavía no soportado` | Render inline in the magnet modal; clear on the next keystroke, as the film modal already does. |
| `qBittorrent rechazó el torrent (<status>)` | Render inline. Nothing was written server-side, so no refresh. |
| `Indicá exactamente uno de movieId o episodeId` | Should be unreachable once the union lands — it means `web` built a malformed call. Surface it rather than swallowing it. |
| `El permiso de subida no corresponde a este episodio` | Surface in the upload modal; the ticket is not spent, so retrying is safe. |
| `No autenticado` / session errors | Existing `redirectIfUnauthenticated` path in the actions. These are Server Actions, not a Server Component render, so this is the correct helper — **not** `redirectToClearSession` (see `services/web/CLAUDE.md`, the two are chosen by caller context, not resemblance). |

After a successful mutation, `router.refresh()` re-fetches `show(id)` and the episode row picks up
its new `status`. No new field on `Episode` is needed or available for progress display.

## Tests

**None, deliberately.** This service has no test file, no runner and no `test` script, and
`services/web/CLAUDE.md` is explicit that introducing a test toolchain here is its own decision
deserving its own spec — doing it as a side effect of this feature is out of scope.

The silent failure this slice is most exposed to — an episode id reaching a film mutation — is
defended structurally instead, by the discriminated union in step 2 (the illegal call stops being
expressible) and, on the other side of the boundary, by `episodes.service.spec.ts` in the `api`
slice. That is the mitigation Article IX asks for here; a test that could only re-assert what the
type system now enforces would add ceremony, not safety.

The gate is the typecheck, Biome on the touched files, and actually opening `/shows/<id>`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
grep -rn "@prisma/client" services/web/src
bin/cli web npx --no biome check src/components/shows src/components/search src/components/import src/actions/shows.ts
```

`tsc` reports **exactly 11 errors across 4 files** — `ResultsForm.tsx` (5), `SearchForm.tsx` (2),
`ImportMagnetSeasonModal.tsx` (2), `importFolderModal.tsx` (2) — down from the 12 committed today
because `SearchTorrentModal.tsx`'s `@prisma/client` import is gone. None in a file this slice
touched. The `grep` returns nothing.

Biome across the whole repo is not a usable gate (~1598 pre-existing errors); judge only the files
this slice touched, and report the count before and after so it is clear nothing was added.

Then open `/shows/<id>` and walk the manual pass in `../plan.md` § Verification, steps 1 through 6.
A green typecheck on this screen has never meant it works — three of the files listed above compiled
cleanly while sending an episode id to a film mutation.
