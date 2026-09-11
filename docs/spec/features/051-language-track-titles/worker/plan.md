---
title: Language track titles move to the database — worker slice
service: worker
last_updated: 2026-09-10
status: Implemented
---

# PLAN: Language track titles move to the database — `worker` (`worker/plan.md`)

## Scope

The worker stops owning the table and starts reading it. It fetches the `iso3 → title` map from
`api` once per encode job, threads it down to `trackLanguageTitle`, and deletes the `languageTitles`
literal from `src/ffmpeg/params.ts`.

Nothing else about track titling changes. The regional-variant override in `src/ffmpeg/variants.ts`
stays exactly where it is and keeps winning over the map (REQ-5/REQ-6) — `LANGUAGE_VARIANTS` is
**not** touched, not moved, and not read from `api`. Neither is `normalizeIso3`
(`src/ffmpeg/iso639.ts`), which stays worker-local: `api` publishes the /B form it seeds, and
translating a source's /T tag to /B remains this service's job (REQ-7).

Writes are confined to `services/worker/` and this directory. The `api` slice is adding the query and
the column; if the query is missing or shaped differently than `../spec.md` says, stop and report —
do not adapt.

**Before the first edit**: revert the uncommitted working-tree changes to
`src/ffmpeg/params.ts` and `src/ffmpeg/params.spec.ts`. They add `jpn`/`kor`/`fre` to the very
literal this slice deletes, and leaving them in makes the feature's diff unreadable.

```bash
git checkout -- services/worker/src/ffmpeg/params.ts services/worker/src/ffmpeg/params.spec.ts
```

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/api/track-titles.ts` | New | `fetchTrackTitles(): Promise<Record<string, string>>` — the query, and the list-to-`Record` fold |
| `src/encode/types.ts` | Modified | `EncodeInput` gains `trackTitles: Record<string, string>` |
| `src/jobs/encode.job.ts` | Modified | Calls `fetchTrackTitles()` once per job; passes the result into both driver call sites |
| `src/ffmpeg/params.ts` | Modified | `languageTitles` deleted; `trackLanguageTitle`, `getAudioParams`, `getSubtitleParams` take the map |
| `src/ffmpeg/buildCommand.ts` | Modified | Forwards `details.trackTitles` into both params calls |
| `src/api/track-titles.spec.ts` | New | The fold, and the unreachable-`api` fallback |
| `src/ffmpeg/params.spec.ts` | Modified | Existing title cases pass the map explicitly |
| `src/ffmpeg/buildCommand.spec.ts` | Modified | `EncodeInput` fixtures gain the field |
| `src/ffmpeg/cases.spec.ts` | Modified | Corpus `EncodeInput` gains the field — see Steps |

## Existing code to reuse

- `src/api/graphql-client.ts` — `fetchGraphQL` is the only way this service talks to `api`
  (Article II). It already reads `INTERNAL_GRAPHQL_URL`/`SERVICE_TOKEN` and already throws
  `ApiUnreachableError` on a transport failure, which is the class this slice catches for REQ-9.
  Do not add a second client, a retry, or a timeout.
- `src/encode/types.ts` — `EncodeInput` is the established seam for "data the job resolved that the
  ffmpeg argument builders need". `containerTitle` and `sourceTag` were added there by
  `046-encode-metadata-tags` for exactly this reason; `trackTitles` follows them, and follows them
  through the same two call sites in `encode.job.ts` (the `passthrough` branch and the `encode`
  branch — **both**, or a compression-disabled install silently loses its titles).
- `src/ffmpeg/variants.ts` — `detectVariant`/`variantTitle` already run first inside
  `trackLanguageTitle`. That ordering is the whole of REQ-5; leave it untouched.
- `src/ffmpeg/iso639.ts` — `normalizeIso3` stays the lookup key exactly as today.
- `src/api/deliver-report.ts` — the precedent for *not* retrying: only `ApiUnreachableError` is worth
  a retry there, and a cosmetic title is worth none at all. Read it before deciding how much
  machinery this needs; the answer is a `try`/`catch` returning `{}`.

## Steps

1. Revert the two uncommitted files (see Scope).
2. Add `src/api/track-titles.ts`: query `{ trackTitles { iso3 title } }` through `fetchGraphQL`, fold
   the list into a `Record<string, string>`, and return `{}` on any thrown error. Log once, at
   `console.warn`, naming that titles will fall back to ISO codes — the degraded run must be visible
   in the worker log, since nothing downstream will ever complain (REQ-9).
3. Add `trackTitles: Record<string, string>` to `EncodeInput` in `src/encode/types.ts`. Required, not
   optional: an optional field would let a future call site forget it and silently produce ISO codes,
   which is the failure this feature exists to remove. `{}` is the explicit way to say "no titles".
4. In `handleEncode` (`src/jobs/encode.job.ts`), call `fetchTrackTitles()` once, after the
   `processJob` query, and pass the result into the `EncodeInput` literal at **both** the
   `passthrough` and `encode` call sites.
5. In `src/ffmpeg/params.ts`: delete the `languageTitles` literal and its comment; give
   `trackLanguageTitle` a second parameter for the map; give `getAudioParams` and `getSubtitleParams`
   a parameter for it and forward it. Keep the resolution order and the fallback byte-identical —
   variant first, then `map[normalizeIso3(lang)] ?? lang`.
6. In `src/ffmpeg/buildCommand.ts`, forward `details.trackTitles` into both calls.
7. Update the three affected spec files. `cases.spec.ts` builds its `EncodeInput` from the JSON
   corpus, and the corpus asserts real titles (`title=English Surround 5.1 (Opus)` in
   `ffmpeg/1.json`): give it a shared fixture holding the 20 seeded pairs from `../spec.md` REQ-2, so
   the corpus keeps asserting what production actually writes. Read `trackTitles` from the case JSON
   when a case supplies it, falling back to that fixture. The fixture is **test data mirroring what
   `api` returns**, not a reinstated table — it lives under a spec/fixture file, never in
   `src/ffmpeg/params.ts`.
8. Confirm `grep -rn "languageTitles" services/worker/src` returns nothing (AC-3).

New code carries no explanatory comments (Article XI). The legacy comments already in `params.ts`
and `graphql-client.ts` stay as they are unless the line itself is being deleted.

## Contract obligations

Consumed, read-only, from `../spec.md`:

```graphql
query { trackTitles { iso3 title } }
```

- Both fields are non-null and every entry is a real title. There is no "present but null" case to
  handle — a language with no title is simply **absent** from the list, and absence is already the
  `?? lang` branch this code has had since `011`.
- The list is unordered; fold it into a `Record` and never index it positionally.
- Keys arrive as ISO-639-2/**B** (`fre`, `ger`, `chi`, `dut`, `cze`), which is what
  `normalizeIso3` canonicalizes a source's tag to. Do not normalize the keys again on arrival and do
  not add /T aliases to the map — `iso639.ts` already owns that translation on the lookup side.
- `es-419`/`es-ES` will never appear. Their titles come from `variants.ts`, and a track detected as
  either must still title from there (REQ-5).

Failure conditions this consumer owes handling for: **any** error from `fetchGraphQL` — an
`ApiUnreachableError`, a non-2xx, invalid JSON, or a GraphQL error — degrades to an empty map and the
encode proceeds (REQ-9, AC-5). None of them fails the job, and none of them is retried.

## Tests

`src/api/track-titles.spec.ts` — owed under Article IX. Both of its cases fail silently in
production: a fold that drops or mis-keys an entry produces a correctly-completed job whose file
carries the wrong track label, and a thrown error that escapes `fetchTrackTitles` would fail a
two-hour encode over a cosmetic string.

- A list of entries folds into the `Record`, keyed by `iso3`.
- A rejecting `fetchGraphQL` yields `{}` and does not throw.

`src/ffmpeg/params.spec.ts` — extend, do not rewrite. Its existing header already names the class of
failure it defends. Cases owed:

- An injected map titles a `jpn` track `日本語 Stereo (Opus)` (AC-3), proving the map is actually read.
- A source tagged `fra` resolves the `fre` key (AC-4) — the B/T case, which is silent when broken:
  the title falls back to `fra` and nothing complains.
- An empty map titles every track with its bare ISO code (AC-5/AC-6), the REQ-8 fallback.
- A Latin-American-marked Spanish track still titles `Latino` **with `spa → Español` present in the
  map** (AC-7) — the precedence case, which the old test could not express because the table was not
  injectable.

`src/ffmpeg/buildCommand.ts` and `src/encode/types.ts` are owed nothing of their own: the first is
forwarding covered by `buildCommand.spec.ts`'s existing fixtures, and the second is a type.

## Done when

```bash
bin/cli worker npx tsc --noEmit
bin/npm worker run build
bin/npm worker test
```

Typecheck at 0 errors, build exits 0, and the suite green **except** the two pre-existing failures
recorded in the root `CLAUDE.md` under `047-source-deletion` — the stale track-title string in the
`ffmpeg/2.json` corpus and the CRF mismatch in `buildCommand.spec.ts`. Both are in territory this
slice does not own; confirm the count of failures is still exactly two and report if it grew.
