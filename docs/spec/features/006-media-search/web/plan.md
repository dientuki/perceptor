---
title: Media Search and Registration, Parameterized by Media Type — web slice
service: web
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Media Search and Registration, Parameterized by Media Type — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is **read-only**.

`services/web/AGENTS.md` applies: this is Next 16, not the Next in your training data. Read the
relevant guide under `node_modules/next/dist/docs/` before writing anything that touches Server
Components, Server Actions or the App Router.

## Scope

`web` moves the existing search screen onto the new generalized operations and points a second
route at it. Concretely: a new `src/actions/media.ts` calling `searchMedia`/`addMedia`, the removal
of `searchMovies`/`addMovie` from `src/actions/movies.ts`, the `movieId` → `mediaId` rename in the
hand-written result type and the one component that reads it, and making `SearchContainer`'s copy
and its post-add action follow the media type instead of saying "película" on a series screen.

`web` does **not** touch the database, does not add a `/shows` list or a `/shows/[id]` detail
screen, and does not repair the four untracked copied files under `src/app/(dashboard)/shows/` and
`src/components/Shows/` — all Out of Scope in `../spec.md`, all deliberately left as they are. Only
`src/app/(dashboard)/shows/add/page.tsx` is in scope out of that group.

This slice runs **after** `api` has landed. Until then `/movies/add` is broken and that is expected
(see `../plan.md` § Order of Work) — do not add a fallback to the old operations.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`). In particular `services/worker/` reads `MediaSource.movieId` and must not
be touched by any part of this slice.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/search.ts` | Modified | `movieId: number \| null` → `mediaId: number \| null`, comment updated |
| `services/web/src/actions/media.ts` | New | `searchMedia(query, type)` and `addMedia(tmdbId, type)` |
| `services/web/src/actions/movies.ts` | Modified | `searchMovies`, `addMovie`, `SEARCH_MOVIES_QUERY`, `ADD_MOVIE_MUTATION` and their now-unused imports removed. `getMovies` / `getMovieById` / `Movie` stay |
| `services/web/src/components/search/SearchContainer.tsx` | Modified | `searchAction` takes `type`; copy follows type; reads `mediaId`; post-add action is a link only for films |
| `services/web/src/app/(dashboard)/movies/add/page.tsx` | Modified | Passes the two new actions |
| `services/web/src/app/(dashboard)/shows/add/page.tsx` | Modified | `MEDIA_TYPE.SHOW`, the new actions, breadcrumb `Shows Add` |

Nothing else. `SearchInput.tsx`, `MediaList.tsx` and `MediaCard.tsx` already branch on media type
correctly and need no change — check before editing, not after.

## Existing code to reuse

- **`src/actions/media-server.ts`** — the canonical server-action shape (`'use server'` on line 1,
  a module-level `SCREAMING_SNAKE` document const, the response type as `fetchGraphQL<T>`'s type
  parameter, `errors[0]?.message` with a Spanish fallback). `src/actions/media.ts` copies it; it
  does not invent a variant.
- **`src/lib/auth-session.ts`** — `redirectIfUnauthenticated`, the **await**ed variant. Both new
  actions are invoked from a Client Component event handler, i.e. in a Server Action context where
  cookie mutation is legal — that is what `searchMovies`/`addMovie` already use today, and it is
  the right one here. `redirectToClearSession` is for read functions a Server Component `await`s
  during render (`getMovieById`); the two are **not** interchangeable (`services/web/CLAUDE.md`).
- **`src/components/search/SearchInput.tsx`** — already renders
  `Buscar ${type === MEDIA_TYPE.SHOW ? "serie" : "película"}...` from the `type` prop it is already
  given. The placeholder half of REQ-15 is done; only `SearchContainer`'s own two strings are wrong.
- **`src/components/media/MediaList.tsx` / `MediaCard.tsx`** — already type-aware
  (`MediaList`'s default empty message, `MediaCard`'s `/shows/:id` vs `/movies/:id` link) and used
  with `showLink={false}` here, so the card link never fires on this screen.
- **`src/types/media.ts`** — `MEDIA_TYPE` / `MediaType` already exist and already hold
  `"movie"`/`"show"`, the same literals `api` puts on the wire. Nothing to add.
- **`SearchContainer`'s `addAction: (id: number, type: MediaType) => Promise<string>`** (line 14) —
  this prop has taken a `type` since the MVP and `addMovie` has accepted and ignored it. It is the
  seam this feature finally uses; do not redesign it.

## Steps

1. **`src/types/search.ts`.** Rename the field to `mediaId` and reword the comment: the id of the
   registered row in whatever table `type` names, `null` when nobody has registered it. Leave
   `inLibrary`'s comment as the ownership test — the two answer different questions and neither
   replaces the other.

2. **`src/actions/media.ts`** (new), two functions, both `throw`ing after
   `await redirectIfUnauthenticated(errors)`:

   ```ts
   export async function searchMedia(query: string, type: MediaType): Promise<MediaSearchResult[]>
   export async function addMedia(tmdbId: number, type: MediaType): Promise<string>
   ```

   `searchMedia` keeps the existing short-circuit on a blank query (`if (!query.trim()) return []`)
   so the round trip is skipped client-side too, and selects exactly the fields in the delta —
   `id title releaseDate posterUrl originalLanguage overview type mediaId inLibrary`. `addMedia`
   selects `{ id type }` from `MediaRef` and returns `String(data.addMedia.id)`: ids are `string` in
   this service even where the GraphQL argument is `Int!` (`services/web/CLAUDE.md`), which is why
   `addAction` is typed `Promise<string>`.

   The Spanish fallbacks stay generic here — `Error al buscar` / `Error al agregar` — because these
   two functions serve both media types. The per-type wording that reaches the user comes either
   from `api` (which owns `No encontramos la serie en el catálogo`) or from `SearchContainer` in
   step 3.

3. **`src/components/search/SearchContainer.tsx`.**
   - **Widen `searchAction` to `(query: string, type: MediaType) => Promise<MediaSearchResult[]>`**,
     matching `addAction`, and pass `type` from `handleSearch`. This is not cosmetic symmetry:
     `/movies/add` is a Server Component, and a Server Component **cannot** pass an inline arrow
     like `(q) => searchMedia(q, MEDIA_TYPE.MOVIE)` to a Client Component — only a real Server
     Action is serializable across that boundary. Wrapping it would fail at runtime with
     "Functions cannot be passed directly to Client Components". The pages pass `searchMedia` and
     `addMedia` **by reference**, and the container supplies the `type` it already holds.
   - Read `item.mediaId` where it read `item.movieId` (line 89) and rename the `addedMovieIds` state
     to `addedMediaIds` — it is keyed by TMDB id and holds registered-row ids for both types now.
   - The add-error string (line 60) follows the type:
     `No se pudo agregar la ${type === MEDIA_TYPE.SHOW ? "serie" : "película"}. Intentá de nuevo.`
     Same for the pre-search empty state (line 82): `Buscá una serie para empezar` /
     `Buscá una película para empezar`. Inline, never `alert()`.
   - **The owned branch splits by type** (REQ-16, AC-8). Films keep exactly what they have today:
     an `Ir` `<Link>` to `/movies/<mediaId>`, same classes. Series render a non-interactive
     `Agregada` badge with **no `href`** — this feature ships no `/shows/[id]`, so a link would go
     to a page that does not exist (and whose untracked copy does not compile). Keep the visual
     weight comparable to the `Ir` button so the card does not look broken.
   - The ownership test does not change and must not be "simplified":
     `item.inLibrary || addedMediaIds[item.id] !== undefined`. Never `mediaId !== null` — a series
     another user registered is still addable by this caller (`../plan.md` § Contract Freeze).

4. **`src/actions/movies.ts`.** Delete `searchMovies`, `addMovie`, `SEARCH_MOVIES_QUERY` and
   `ADD_MOVIE_MUTATION`, plus the `MediaType` / `MediaSearchResult` imports that become unused.
   `getMovies`, `getMovieById`, `GET_MOVIE_QUERY` and the `Movie` interface stay — they back
   `/movies` and `/movies/[id]`, which are film screens and stay film screens.

5. **The two pages.** `/movies/add` imports `{ searchMedia, addMedia }` from `@/actions/media` and
   passes them by reference with `type={MEDIA_TYPE.MOVIE}`. `/shows/add` — currently a byte-identical
   copy of the movies page — becomes the same with `type={MEDIA_TYPE.SHOW}` and its breadcrumb
   corrected from `Movies Add` to `Shows Add`. The TailAdmin boilerplate `metadata` on both is
   template noise, out of scope, and stays as it is.

**The one thing to be careful with in this whole slice**: `movieId` appears 21 times under
`services/web/src` and only **three** of them are this feature's (`types/search.ts:12`,
`SearchContainer.tsx:89`, and the `movieId` field selected in `actions/movies.ts`'s deleted query).
Every other hit is a different thing that shares the name — the `addTorrentToMovie` /
`addMagnetToMovie` / `createUploadTicket` mutation arguments, the tus upload metadata key in
`importFileModal.tsx`, and local variables in `SearchTorrent.tsx`. A project-wide find-and-replace
breaks the download pipeline with no error at all (`../spec.md` NFR-1b). Rename by meaning, one
site at a time.

## Contract obligations

`web` consumes, so it owes correct handling of every condition in `../spec.md` § Errors — there is
no codegen, and a consumer that implements only the happy path compiles, lints, and is wrong
(`docs/spec/graphql-contract.md`).

Consumed shapes, exactly as frozen:

```graphql
searchMedia(query: String!, type: String!): [MediaSearchResult!]!   # mediaId: Int, inLibrary: Boolean!
addMedia(tmdbId: Int!, type: String!): MediaRef!                    # { id: Int!, type: String! }
```

Error handling `web` owes:

| What `api` sends | What `web` must do |
| :-- | :-- | 
| `[]` for a blank query | render the pre-search empty state; no error |
| `Tipo de medio no soportado: <type>` | cannot happen from these screens (both pass a `MediaType`), but surface `errors[0].message` rather than swallowing it |
| TMDB down / no API key, on `searchMedia` | leave the results list untouched and render the inline search error |
| `No encontramos la serie/película en el catálogo`, on `addMedia` | re-enable that card's button (the `finally` that clears `addingId` already does this) and render the inline add error |
| A registered series whose hydration failed | invisible here — the mutation succeeded, so the card shows `Agregada`. `web` does not surface hydration state; there is no field for it in the delta |

`addMedia` returns `MediaRef`, not a `Movie` — that is deliberate and is not a regression to work
around; see `../plan.md` § Contract Freeze. The delta is read-only: if it is wrong, stop and report.

## Tests

**None, and that is the correct outcome here** — `services/web` has no test file, no test runner and
no `test` script, and `services/web/CLAUDE.md` is explicit that introducing a test toolchain is its
own decision needing its own spec. Do **not** add Vitest or Playwright as a side effect of this
feature.

The consequence is stated rather than hidden: the `mediaId` rename is the single riskiest change in
the whole feature (`../spec.md` NFR-1) and nothing in this service can catch it. Its gate is step 4
of `../plan.md` § Manual pass — search a film already in the library and confirm it renders `Ir`
**on the first render**, from `inLibrary` alone, before anything is added in that session. A missed
rename shows up there as `Ir` linking to `/movies/undefined`, and nowhere else.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

```bash
bin/npm web run lint
```

```bash
grep -rn "searchMovies\|addMovie" services/web/src
```

```bash
grep -rn "movieId" services/web/src
```

Expected: the typecheck reports **12 errors across 5 files**, exactly the pre-existing set listed in
`services/web/CLAUDE.md` (`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`,
`SearchTorrentModal.tsx`, `SearchForm.tsx`, `ResultsForm.tsx`) — report the count before and after;
any other number means this slice added an error or touched a file it was not scoped to. Biome
reports nothing new on the six files above. The third grep returns **nothing**. The fourth still
returns the mutation arguments in `actions/imports.ts`, `actions/indexer.ts` and `actions/uploads.ts`,
the tus metadata key in `importFileModal.tsx`, and the local variables in `SearchTorrent.tsx` — and
no longer returns anything from `types/search.ts` or `SearchContainer.tsx` (AC-13).

`bin/npm web run build` is **not** a gate: `app/(dashboard)/shows/page.tsx` is an untracked copy
importing a module that does not exist and is Out of Scope, so the build fails on it both before and
after this feature.
