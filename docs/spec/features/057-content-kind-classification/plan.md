---
title: Content kind classification (live action / anime / CGI) — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Content kind classification (live action / anime / CGI) (`plan.md`)

## Approach

The feature is `056-shorts-runtime-classification` again, one field over: a flag on a title, derived
from TMDB at registration, correctable by hand from the title's own detail page, consumed by the
worker through `EncodeJobDetails`. Wherever `056` already built a seam, this feature reuses it
rather than building a parallel one.

**The rule is one pure function, not a method on two twins.** `MoviesService` and `ShowsService` are
deliberate structural twins (`006-media-search` § Out of Scope) and stay so: each keeps its own
fetch-and-cache path. But the classification rule itself — genre id `16`, then keyword `278823`
before `210024`/`6513` — is neither service's business twice. It goes in one plain exported
function, `services/api/src/media/content-kind.ts`, with no Nest module and no injection, following
`src/pipeline-status/pipeline-status.ts`'s precedent exactly. Both services call it with the raw
catalog facts they hold; only the *fetching* is duplicated, and only because the cache keys and the
Prisma models already are.

**One TMDB details call per registration, shared with `056`.** `MoviesService.deriveIsShort()`
already tops a warm cache entry up with a `TmdbClient.details()` call to get `runtime`
(`056` REQ-6). Genres are resolved from the same response, so the two derivations must not each
issue their own request: the film path resolves the catalog entry once, tops it up once if
*either* `runtime` or `genreIds` is missing, caches once, and then derives both flags from the
result. This is the single most important reuse in the feature — two independent top-ups would
double every cold registration's TMDB cost and pass every test.

**Search results carry genres for free.** TMDB's `search/movie`, `search/tv`, both popular lists and
`search/multi` already return `genre_ids` on every row; the existing mappers simply drop it.
Threading it into the cached `MediaSearchResult` shape (`clients/types.ts`) means a registration off
a warm cache entry usually needs no genre fetch at all, and costs no request anywhere — this is
mapping a field already on the wire, not a new call (NFR-1). Keywords have no such free ride: they
are a second endpoint, fetched only for a title whose genres say animated, and cached back into the
same entry (`keywordIds`) so a repeat registration inside the TTL does not re-ask.

**The keywords endpoint answers under two different keys.** `/movie/{id}/keywords` returns
`{ keywords: [...] }`; `/tv/{id}/keywords` returns `{ results: [...] }`. That asymmetry is TMDB's,
and it is absorbed once inside `TmdbClient` — the new `keywords(type, id)` method returns
`number[]`, and nothing above the client ever sees which key it came from.

**The worker gets a string and narrows it itself.** `worker` retypes the GraphQL schema by hand and
already crosses plain `String!` for `kind`/`sourceKind`, so `contentKind` arrives as a string.
`src/encode/content-kind.ts` (a new small pure module, the pattern
`src/metadata/container-tags.ts` established) declares the worker-local union and one
`normalizeContentKind(raw)` that maps an unknown or missing value to `LIVE_ACTION` and logs it
(NFR-4). `EncodeInput` then carries the narrowed union, so `src/ffmpeg/params.ts` switches over
three exhaustive cases and cannot be handed a string nobody validated.

**`getVideoParams` gets three branches, not a boolean with an extra `if`.** Today the animated half
is an `else` whose comment already calls it "params cgi". `ANIME` and `CGI` produce identical
arguments in this feature by requirement (REQ-11 — the author intends to diverge them
experimentally), so the implementation must keep them as two separately editable cases without
duplicating the five call sites that assemble `-c:v libsvtav1 -crf … -svtav1-params …`. That is the
`ffmpeg` agent's standing governance rule (`.claude/agents/ffmpeg.md` § Governance), not a new one.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the Prisma enum, the migration, the `registerEnumType` and the whole contract delta. Nothing else can compile against `contentKind` until `schema.gql` has it. |
| 2a | `web` | Cannot select a field the schema does not have, and its two new mutations do not exist until step 1 lands. |
| 2b | `worker` (`worker` agent) | The payload seam: `EncodeJobDetails`/`EncodeInput`/`content-kind.ts`/`encode.job.ts`. Independent of `web`. |
| 3 | `worker` (`ffmpeg` agent) | `src/ffmpeg/params.ts`, `buildCommand.spec.ts`, `params.spec.ts` and the `ffmpeg/*.json` corpus. Must come after 2b, because it consumes the narrowed union `content-kind.ts` declares. |

**2a and 2b genuinely run in parallel** — they share no file and the contract between them is frozen
by step 1. **Step 3 is a different agent from step 2b**: `services/worker/src/ffmpeg/` and
`services/worker/ffmpeg/` belong to the `ffmpeg` agent (`.claude/agents/ffmpeg.md`), and the
`worker` agent must stop and report rather than edit them. `worker/plan.md` marks which steps belong
to which agent; `/tasks` must preserve that split.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will want to change and must not:

- **`ANIME` and `CGI` produce the same FFmpeg arguments.** From inside `params.ts` this reads as
  duplicated code Article X should collapse, and collapsing it is wrong: REQ-11 exists so the two
  can be tuned against each other. Keep them two cases; share the *assembly*, not the *decision*.
- **`contentKind` is not nullable and has no "unknown" value.** A title whose style could not be
  established is `LIVE_ACTION` (NFR-2), which is also the column default. A fourth enum value for
  "undetermined" would have to be handled by every consumer and would make the worker's degradation
  path unreachable-but-still-required.
- **`EncodeJobDetails.contentKind` is resolved per call, not frozen onto the `ProcessJob` row.**
  Same stance `048` REQ-13 took for `outputRoot`: no lock, no snapshot, no re-read of a job already
  handed out. Do not add a column to `ProcessJob` for it.
- **No `contentKind` on `MediaSearchResult`.** Not as a `@Field`, not in the enrichment. A search
  result says nothing about animation style — this is `056` NFR-1's rule, and a badge is explicitly
  out of scope.

If the delta turns out wrong: stop, amend `spec.md`, re-approve, re-brief `api`, `web` and `worker`.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

One migration, generated with `bin/npm api run prisma:migrate` after the schema edit.

1. `enum ContentKind { LIVE_ACTION ANIME CGI }` added to `prisma/schema.prisma`.
2. `Movie.isLiveAction` and `Show.isLiveAction` **dropped**; `Movie.contentKind`/`Show.contentKind`
   added as `ContentKind @default(LIVE_ACTION)`, non-null.
3. **No backfill.** Every existing row holds the `true` default of a column no code has ever
   written, so converting it would be ceremony. Existing rows land on `LIVE_ACTION` and are
   corrected from the detail-page control (`spec.md` § Data Model Changes, NFR-5) — the author's
   explicit decision. Verify with
   `bin/mysql -e 'select contentKind, count(*) from movies group by contentKind'`.

Reversibility: Prisma writes no down-migration. Rolling back means restoring the database from the
dump the `backup` service writes (`./backups`) — the old boolean's values are not recoverable from
the new column, which is acceptable precisely because they carried no information.

Generated artifacts to expect in the diff: a modified `schema.prisma`, exactly one new directory
under `prisma/migrations/`, and a regenerated `src/schema.gql` (Article IV — never hand-edited).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Two TMDB details calls per cold film registration (`056`'s runtime top-up plus a new genre top-up) | Nothing fails; TMDB cost silently doubles and rate-limiting appears under load | One shared top-up in `MoviesService`, asserted by a spec that counts `tmdb.details` calls for a cache entry missing both fields (`api/plan.md` § Tests) |
| The keywords response key differs between `/movie` and `/tv` | The series path reads `keywords` off a body that only has `results`, gets `undefined`, and every animated series classifies as `CGI` via REQ-5's fallback — indistinguishable from a legitimate "no keywords" answer | The asymmetry is absorbed in `TmdbClient.keywords()` with a case per type, and pinned by a client spec feeding it both body shapes |
| `enrichWithOwnership` leaking `contentKind` into the shared Redis entry | A per-title flag served to every user and every installation for 24h, with no error anywhere — the ordering trap `movies.service.spec.ts` already guards for `inLibrary`/`isShort` | `contentKind` is never added to the enriched search shape at all (§ Contract Freeze); the existing cache-before-enrich specs stay green and a new case asserts the derived flag is absent from the cached payload |
| Rewriting the corpus' expected `-svtav1-params` strings | `LIVE_ACTION` legitimately gains `aq-mode=2`/`sharpness=0`/`film-grain=0`, so every fixture's expectation changes — a wrong new string is indistinguishable from a right one, and the 2 known pre-existing `src/ffmpeg/` failures can be masked by editing expectations | The `ffmpeg` agent reports `bin/npm worker test`'s failure list before and after its change and must account for each difference; the two known failures (`ffmpeg/2.json`'s stale track title, `buildCommand.spec.ts`'s CRF mismatch) are named in `worker/plan.md` so "still exactly those two" is checkable |
| A consumer left selecting `isLiveAction` | GraphQL rejects the whole operation at runtime — the film detail page or every encode job stops working, with nothing failing at compile time (NFR-6) | AC-11's repository-wide grep is a `[verify]` task, run after all three slices land, not a reviewer's memory |
| The worker silently defaulting a real value to `LIVE_ACTION` | An anime encodes with live-action parameters and nobody notices until someone watches it | `normalizeContentKind` logs every fallback, the `[encode] <id>:` line prints the resolved kind, and a spec asserts the fallback path logs rather than throwing |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select contentKind, count(*) from movies group by contentKind'
bin/mysql -e 'select contentKind, count(*) from shows group by contentKind'
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
grep -rn "isLiveAction" services/api/src services/web/src services/worker/src services/api/prisma/schema.prisma services/worker/ffmpeg docs/spec/graphql-contract.md
```

The last command must print nothing (AC-11). Historic SQL under `prisma/migrations/` still names the
dropped column and is left alone.

Then the manual pass, against a running `bin/dev`:

1. Register a live-action film and an animated one (one anime-tagged, one `3d-animation`-tagged) and
   a series of each kind from `/search`; check each row's `contentKind` with `bin/mysql` (AC-1..AC-5).
2. Open each title's detail page: the control shows the derived value; change it, reload, it holds
   (AC-8). Change it on a series and confirm `processJob(id)` for one of its episodes reports the new
   kind.
3. Blank `movie_db_api_key` in Settings, then register a title whose catalog entry is already cached
   — it still registers, as `CGI` if its cached genres say animated, `LIVE_ACTION` if no genres are
   known (AC-6).
4. Run one real encode of an `ANIME` title with `compression_enabled` on and read the stored
   `ProcessJob.ffmpegCommand` for `scm=2:...:sharpness=2` (AC-8); run one with compression off and
   confirm the file is moved untouched (REQ-12).
5. Sign in as a second user and call `setShowContentKind` for a series only the first user owns —
   `Recurso no disponible para este usuario`, stored value unchanged (AC-7).
