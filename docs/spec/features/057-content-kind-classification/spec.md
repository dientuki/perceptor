---
title: Content kind classification (live action / anime / CGI)
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-14
last_updated: 2026-09-14
status: Implemented
services: [api, web, worker]
---

# SPEC: Content kind classification (live action / anime / CGI) (`spec.md`)

## Context & Goal

The encoder already branches on whether a title is animated, and the branch is fed by a flag nobody
can set. `Movie.isLiveAction` and `Show.isLiveAction` are two `Boolean @default(true)` columns
(`services/api/prisma/schema.prisma`) that no code path in the repository ever writes: registration
leaves them at their default and there is no mutation, no UI and no derivation. They cross the
boundary as `EncodeJobDetails.isLiveAction`, `worker` reads them in
`services/worker/src/jobs/encode.job.ts`, carries them through `EncodeInput`
(`src/encode/types.ts`) into `getVideoParams` (`src/ffmpeg/params.ts`), and there the boolean picks
one of two SVT-AV1 parameter sets — the animated one commented in place as "params cgi". In
practice every title in every installation is live action, so the animated half of that branch is
dead code that has never run.

Two shortcomings meet here. The flag is not settable, and even if it were, two values are not
enough: hand-drawn animation and digital 3D animation want different SVT-AV1 tuning, and the author
intends to keep testing them against each other, so they must be separately addressable even while
their parameter sets happen to coincide. So `isLiveAction` becomes a three-value enum —
`ContentKind { LIVE_ACTION, ANIME, CGI }` — on both `Movie` and `Show`, in the encode payload, and
in the worker's parameter builder. Being an enum is the point: a fourth kind is a migration and a
branch, not a redesign.

The value is derived from TMDB at registration, the same way `056-shorts-runtime-classification`
derives `isShort` from a runtime, and for the same reason: the user is registering a title from a
poster and an overview, and should not be asked to classify its animation style there. A title
whose TMDB genres do not include animation (genre id `16`) is `LIVE_ACTION` and the logic stops —
no second call for the overwhelming majority of registrations. An animated title is disambiguated
by its TMDB keywords ([movie-keywords](https://developer.themoviedb.org/reference/movie-keywords),
[tv-series-keywords](https://developer.themoviedb.org/reference/tv-series-keywords)): keyword
`278823` (`3d-animation`) means `CGI`; `210024` (`anime`) or `6513` (`cartoon`) mean `ANIME`. Since
that detection is a heuristic over metadata strangers wrote, it is an initial value only: a
selector on the film's and the series' own detail page is the authoritative way to set it, exactly
as `setMovieShort` is for shorts.

This touches two rows of the root `CLAUDE.md` pipeline table — **Register title in DB**, which
gains the derivation, and **Transcode**, whose video parameters stop branching on a boolean. The
GraphQL contract loses `isLiveAction` in three places and gains `contentKind` in the same three,
plus two mutations.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Three-valued kind on both models)**: A film and a series must each carry exactly one
      content kind, one of `LIVE_ACTION`, `ANIME` or `CGI`. It is a property of the title, shared by
      every user who has it registered — never a per-user value. `isLiveAction` must be gone from
      both models, from the GraphQL schema and from the worker.
- [x] **REQ-2 (Live action is the default and the terminal case)**: A title registered from TMDB
      whose genres do not include animation (genre id `16`) must be stored as `LIVE_ACTION`, and no
      keyword lookup may be performed for it.
- [x] **REQ-3 (Anime keywords)**: An animated title whose TMDB keywords include `210024` (`anime`)
      or `6513` (`cartoon`), and do **not** include `278823` (`3d-animation`), must be stored as
      `ANIME`.
- [x] **REQ-4 (3D animation wins)**: An animated title whose TMDB keywords include `278823`
      (`3d-animation`) must be stored as `CGI`, whether or not `210024`/`6513` are also present.
      `3d-animation` is checked first.
- [x] **REQ-5 (Animated with no usable keyword is CGI)**: An animated title whose keywords include
      none of the three ids — including the case where the keyword list is empty, or could not be
      retrieved at all — must be stored as `CGI`. Animation is established by the genre; only the
      style is in doubt, and `CGI` is where that doubt lands.
- [x] **REQ-6 (Series classify identically)**: A series must be classified by the same genre-then-
      keywords rule as a film, reading the series' own TMDB genres and keywords. Every episode of a
      series encodes with its series' kind; an episode never carries or derives one of its own.
- [x] **REQ-7 (Derived once, at registration)**: The derivation runs only when a title is first
      written to the database. Registering a title that is already there must leave its stored kind
      exactly as it is — this is `048`'s REQ-6 and `056`'s REQ-7 restated for a third flag.
- [x] **REQ-8 (Manual reclassification, films)**: A film's detail page must let its owner set the
      film's content kind to any of the three values and see the change reflected without a reload.
      The new value is authoritative and is never re-derived afterwards.
- [x] **REQ-9 (Manual reclassification, series)**: A series' detail page must offer the same control
      with the same three values, scoped and refused the same way.
- [x] **REQ-10 (Kind reaches the encoder)**: `EncodeJobDetails` must carry the title's content kind
      in place of `isLiveAction`, resolved at the moment the worker asks for the job's details (from
      the film, or from the episode's series). A title reclassified after a job's details were
      handed out keeps the kind that job received — no job is re-read or restarted.
- [x] **REQ-11 (Three parameter sets, separately addressable)**: The worker's SVT-AV1 video
      parameters must be selected by content kind, in three branches that can be edited
      independently even while two of them produce identical output today:
      | Kind | Parameters |
      | :-- | :-- |
      | `LIVE_ACTION` | `scm=0`, `aq-mode=2`, quantization matrices **off**, `sharpness=0`, `film-grain=0` |
      | `ANIME` | `scm=2`, `aq-mode=2`, `enable-qm=1`, `qm-min=4`, `sharpness=2`, `film-grain=0` |
      | `CGI` | `scm=2`, `aq-mode=2`, `enable-qm=1`, `qm-min=4`, `sharpness=2`, `film-grain=0` |
      Everything already common to both current branches (`keyint`, `scd`, `enable-overlays`,
      `tune`, `input-depth`) stays common and unchanged, in every codec path that builds these
      parameters (H264, 4K HEVC HDR/SDR downscale, VC-1).
- [x] **REQ-12 (Passthrough is unaffected)**: With compression disabled (`032`) the file is still
      renamed and moved without FFmpeg touching it, regardless of content kind. The kind is present
      in the payload of such a job and simply decides nothing.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No TMDB call per search result)**: Classification must add no TMDB request to any
      search, multi-search, popular-list or billboard render. The cost is bounded to the title
      actually being registered: at most one catalog-details request (shared with `056`'s runtime
      resolution for a film, not a second one) plus, only for an animated title, at most one
      keywords request.
- [x] **NFR-2 (A failed classification never fails a registration)**: If TMDB is unreachable,
      rate-limited or answering without the fields, registration must still succeed — as
      `LIVE_ACTION` when the genres could not be established at all, and as `CGI` when the genres
      say animated but the keywords could not be read (REQ-5). The pre-existing failure where the
      catalog knows nothing about the `tmdbId` is unchanged and still surfaces
      `error.movie.not_in_catalog` / `error.show.not_in_catalog`.
- [x] **NFR-3 (Cache holds catalog facts, never the derived kind)**: The raw catalog inputs (a
      title's TMDB genre ids and keyword ids) may be written into that title's existing
      `tmdb:movie:<id>` / `tmdb:show:<id>` Redis entry, under its existing 24h TTL, so a second
      registration of the same title inside the TTL re-derives without new requests. The derived
      `contentKind` must **not** enter that shared entry — same rule `048`/`056` set for `isShort`,
      for the same reason: the cache is shared by every user and every installation, the flag is
      not.
- [x] **NFR-4 (Worker degrades, never fails)**: A payload arriving without a recognisable content
      kind — an older `api`, a dropped field, a value the worker does not know — must encode as
      `LIVE_ACTION` and log which branch it took. An unknown kind is never a reason to fail an
      encode. This mirrors `051`'s degradation stance for track titles.
- [x] **NFR-5 (No retroactive pass)**: Nothing re-classifies titles already in the database. The
      column is replaced without preserving the old boolean (see § Data Model Changes) — every
      existing row lands on the `LIVE_ACTION` default and is corrected, if needed, from its own
      detail page (REQ-8/REQ-9).
- [x] **NFR-6 (Contract, not codegen)**: `web` and `worker` both retype this delta by hand. Removing
      `isLiveAction` while a consumer still selects it is a GraphQL validation error at runtime with
      no compile error anywhere, so every query in `services/web/src/actions/{movies,shows}.ts` and
      `services/worker/src/jobs/encode.job.ts` that names the old field must move in the same
      feature.
- [x] **NFR-7 (Worker corpus moves with the field)**: The `ffmpeg/*.json` case corpus
      (`services/worker/ffmpeg/`) encodes `isLiveAction` in each fixture's `input`. Each fixture and
      the validation in `src/ffmpeg/cases.spec.ts` must move to the enum; a fixture still carrying
      the boolean must fail loudly rather than be silently defaulted.
- [x] **NFR-8 (User-facing copy is catalogued)**: Every new string — the three kind labels and the
      control's label on both detail pages — goes through `services/web/messages/{en,es}.json`
      (`018-ui-i18n`), with no `en`/`es` drift. No new error key is introduced; the refusals below
      reuse existing ones.

## GraphQL Contract Delta

One enum and one field replace one boolean in three types; two mutations are added.

```graphql
enum ContentKind {
  LIVE_ACTION
  ANIME
  CGI
}

type Movie {
  contentKind: ContentKind!
}

type Show {
  contentKind: ContentKind!
}

type EncodeJobDetails {
  contentKind: ContentKind!
}

type Mutation {
  setMovieContentKind(movieId: Int!, contentKind: ContentKind!): Movie!
  setShowContentKind(showId: Int!, contentKind: ContentKind!): Show!
}
```

`Movie.isLiveAction`, `Show.isLiveAction` and `EncodeJobDetails.isLiveAction` are **removed**. The
three types keep every other field exactly as `docs/spec/graphql-contract.md` records it; only the
lines above change.

Both mutations reuse the ownership gate their neighbours use: `setMovieContentKind` runs through
`MoviesService.findOneFromDb`, `setShowContentKind` through the series' equivalent, so a title that
exists but belongs to another user is indistinguishable from one that does not exist (the stance
`008`/`009` set and `048` reused). `contentKind` is a property of the title, not of the ownership
row, so a reclassification is visible to every user who has that title registered.

Neither mutation is granted `@AllowService()`. A `SERVICE_TOKEN` principal is rejected by the global
guard, as it is for `setMovieShort`. The worker's need is served by `processJob(id)`, which already
carries `@AllowService()` and now returns `contentKind` pre-joined.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setMovieContentKind` while movies are disabled (`045`) | `error.media.type_disabled` (403, existing) | `Las películas están deshabilitadas en esta instalación` |
| `setShowContentKind` while series are disabled (`045`) | `error.media.type_disabled` (403, existing) | `Las series están deshabilitadas en esta instalación` |
| `setMovieContentKind` for a film id the caller does not own, or that does not exist | `error.movie.not_found` (404, existing) | `Recurso no disponible para este usuario` |
| `setShowContentKind` for a series id the caller does not own, or that does not exist | `error.show.not_available` (404, existing) | `Recurso no disponible para este usuario` |
| either mutation with no session | `error.auth.unauthenticated` (401, existing) | `No autenticado` |
| either mutation with a value outside the enum | GraphQL argument validation (400) | GraphQL's own message — not a hand-written guard |

What the consumers do with each: `web`'s two server actions return `{ error }` on any refusal, the
detail-page control reverts its displayed value to the stored one and renders the translated
message beside itself (the pattern `Movie.tsx`'s short toggle already uses); nothing retries.
`worker` never calls either mutation and treats an unreadable `contentKind` as `LIVE_ACTION`
(NFR-4).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| — | new enum `ContentKind { LIVE_ACTION, ANIME, CGI }` | — | — |
| `Movie` | `isLiveAction Boolean` **removed** | — | No — see below |
| `Movie` | `contentKind ContentKind` added | non-null, `@default(LIVE_ACTION)` | No |
| `Show` | `isLiveAction Boolean` **removed** | — | No — see below |
| `Show` | `contentKind ContentKind` added | non-null, `@default(LIVE_ACTION)` | No |

**The old boolean is dropped, not converted.** No code has ever written it, so every row in every
existing database holds its `true` default, and the conversion would be a no-op that only looks
careful. Existing rows therefore land on `LIVE_ACTION` and the few loaded during development are
corrected from the detail-page control this feature adds (REQ-8/REQ-9, NFR-5) — an explicit
decision by the author, recorded here because dropping a populated column is not a default any
implementer should assume.

One migration, generated through `bin/npm api run prisma:migrate` (Constitution, Article III).

## Acceptance Criteria

- [x] **AC-1**: Registering a live-action film (e.g. TMDB `27205`, *Inception*) stores
      `contentKind = 'LIVE_ACTION'`, verifiable with
      `bin/mysql -e 'select title, contentKind from movies where tmdbId = 27205'` (columns are
      camelCase — only table names are mapped).
- [x] **AC-2**: Registering an animated film whose TMDB keywords include `210024`/`6513` and not
      `278823` (e.g. a Studio Ghibli title) stores `contentKind = 'ANIME'`.
- [x] **AC-3**: Registering an animated film whose TMDB keywords include `278823` stores
      `contentKind = 'CGI'`, including when `210024` is present on the same title (REQ-4).
- [x] **AC-4**: Registering an animated film TMDB lists no keywords for stores
      `contentKind = 'CGI'` (REQ-5), and the registration returns normally.
- [x] **AC-5**: Registering a series follows AC-1..AC-4 on the `shows` table, and
      `processJob(id)` for one of its episodes returns the series' `contentKind`.
- [x] **AC-6 (failure path)**: With an invalid `movie_db_api_key` — every TMDB request answering
      `401` — registering a title that is already in the Redis catalog cache still succeeds. A title
      whose cached genres say animated stores `CGI`; a title whose genres could not be read at all
      stores `LIVE_ACTION`. No registration returns an error about classification.
- [x] **AC-7 (failure path)**: `setShowContentKind` for a series id owned by another user returns
      `error.show.not_available` and the stored value is unchanged; the same mutation run with
      `shows_enabled` off returns `error.media.type_disabled`; a `contentKind: "MANGA"` argument is
      rejected by GraphQL itself.
- [x] **AC-8**: Changing the kind on a film's detail page and reloading shows the new value; the
      film's next encode's FFmpeg command (the one recorded on the job) carries that kind's
      parameters. Changing it while an encode is already running does not change that encode's
      command (REQ-10).
- [x] **AC-9**: `bin/npm worker test` passes with the migrated `ffmpeg/*.json` corpus, and a fixture
      whose `input` still carries `isLiveAction` fails with a named validation error rather than
      being defaulted (NFR-7).
- [x] **AC-10 (failure path)**: A `processJob` payload whose `contentKind` is absent or unrecognised
      encodes as `LIVE_ACTION`, logs the branch it took, and completes — it does not fail the job
      (NFR-4).
- [x] **AC-11**: `grep -rn "isLiveAction" services/*/src services/api/prisma/schema.prisma services/worker/ffmpeg docs/spec/graphql-contract.md`
      returns nothing. Historic migration SQL under `prisma/migrations/` still names the dropped
      column and is deliberately not rewritten.
- [x] **AC-12**: `bin/npm api run test` and `bin/npm worker test` pass; `bin/npm web run build`
      exits 0; `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.

## Out of Scope

- **CRF per content kind.** `getQuality` in `services/worker/src/ffmpeg/params.ts` takes the flag
  today and ignores it (the anime CRF is commented out). It changes signature with everything else
  and keeps returning exactly the values it returns now. Tuning CRF per kind is its own experiment,
  and the author intends to run it with the three branches already in place.
- **A fourth kind.** Stop-motion, 2D digital, cel animation — the enum exists so any of them is a
  migration plus a branch. None is added here.
- **Settings-level overrides.** No installation-wide default kind, no per-user preference, no
  Settings row for the keyword ids or the genre id. The fine-grained decision is per title, from
  that title's own page.
- **Reclassifying existing titles automatically.** No backfill, no scheduled sweep, no re-derivation
  on a later registration (NFR-5). If a library later needs one, `035-scheduled-tasks` is where it
  would live.
- **Exposing the kind in listings or search.** No badge, no filter, no `movies(contentKind:)`
  argument. The value is visible and editable on a title's detail page and nowhere else — unlike
  `048`'s short badge, nothing in a search result depends on it.
- **Classifying an episode independently of its series.** A series with a live-action episode inside
  an animated run, or the reverse, is not modelled (REQ-6).
