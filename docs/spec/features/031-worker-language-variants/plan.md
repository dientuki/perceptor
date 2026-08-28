---
title: Worker Language Variant Selection — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Worker Language Variant Selection (`plan.md`)

## Approach

One service, two agents. The feature is confined to `services/worker/`, but that service has an
internal ownership line the rest of the repository does not: `services/worker/src/ffmpeg/` and
`services/worker/ffmpeg/` belong to the **`ffmpeg` agent** (`.claude/agents/ffmpeg.md`), and
everything else in the service belongs to the **`worker` agent**. This feature straddles that line
exactly once, and the seam is narrow enough to name in a sentence: the `worker` agent carries
`allowedLanguageTags` from the GraphQL payload down to `EncodeInput`; the `ffmpeg` agent reads it off
`EncodeInput` and decides what the rules do with it. Neither touches the other's side.

The `worker` half is four edits along one already-existing path — the query string, the
`EncodeJobDetails` type and the `EncodeInput` type that are both hand-retyped from the contract, and
the object literal in `handleEncode` that builds one from the other. Nothing new is introduced;
`012-post-download-processing` and `023-ffprobe-log` both threaded a field down this exact path.

The `ffmpeg` half extends `src/ffmpeg/params.ts`, and the shape it takes is dictated by that agent's
own governance section rather than invented here. **A predicate gets a name**, so variant detection
does not become an inline `title.includes(...)` chain in two filters: a new
`services/worker/src/ffmpeg/variants.ts` holds the tag vocabulary and three named functions —
resolve which variants of a language were requested, detect a stream's variant, narrow a set of
streams to the requested ones. It sits beside `src/ffmpeg/iso639.ts` and is the same kind of module
for the same reason: worker-local knowledge about how a language appears **in a file**, not a second
copy of the contract. **Audio and subtitles share the mechanism and differ in the criteria**, so both
`getAudioParams` and `getSubtitleParams` call the same narrowing function and then apply their own
rule — audio ranks and takes one per matched variant, subtitles keep everything that matched.

Two alternatives were live and both were rejected in `spec.md` § Out of Scope, restated here because
an implementer will meet them: putting `{ tag, iso3 }` pairs on the wire (cross-service change for
two table rows), and deriving the mapping from the tag string itself (impossible — `es-419` strips to
`es`, and only `api`'s `languages` table knows that is `spa`).

Reused, not rebuilt:

- `services/worker/src/ffmpeg/iso639.ts` — `normalizeIso3` stays the only language comparison, on
  both sides of every match. `variants.ts` does not grow its own normalization.
- `params.ts`'s existing `titleWords`/`titleMarks` — the word-boundary title matcher that already
  exists so `la` is not read out of the middle of a word. Castilian markers go through it unchanged;
  `LATIN_AMERICAN_MARKERS` moves into `variants.ts` rather than being copied.
- `params.ts`'s existing `preferring(streams, isWorse)` — the "drop what is worse, keep everything if
  that would empty the set" helper is precisely REQ-5's shape, and the SDH rule already uses it.
- The `blacklistWords` audio filter, the codec/channels/bitrate sort, `isTextSubtitle`,
  `hasCuePayload`, `isHearingImpaired` — all unchanged, all still applied **before** variant
  reasoning.
- `src/ffmpeg/cases.spec.ts`'s corpus runner and `src/ffmpeg/params.spec.ts`'s synthetic stream
  factories — both already exist; this feature adds cases to them, not a third test mechanism.

## Order of Work

`api` and `web` do not appear. Within `worker`, the payload seam must land before the rules, because
the rules read a field off `EncodeInput` that does not exist until the seam adds it — an `ffmpeg`
slice that goes first does not typecheck.

| Phase | Agent | `worker/plan.md` steps | Why it must come here |
| :-- | :-- | :-- | :-- |
| 1 | `ffmpeg` | 4 | Baseline: run the corpus and the suite untouched, and record the real counts. The agent's own rule — corpus green, *then* change — means the pre-change state has to be observed, not assumed |
| 2 | `worker` | 1–3 | Owns `jobs/encode.job.ts` and `encode/types.ts`. Adds `allowedLanguageTags` to the query, to both hand-retyped types, and to the `EncodeInput` literal, with the `?? []` normalization and the log line |
| 3 | `ffmpeg` | 5–8 | Creates `variants.ts`, threads the new parameter through `buildCommand.ts` into both rule functions, and implements REQ-4/5/6/9/12/17/18 |
| 4 | `ffmpeg` | 9–10 | Tests: the `params.spec.ts` synthetic cases, and `cases.spec.ts` accepting the corpus's new `input` field so `1.json` runs |
| 5 | `orch` | 11 | Documentation: `.claude/agents/ffmpeg.md` § Rules, `services/worker/CLAUDE.md`, and the one stale sentence in `docs/spec/graphql-contract.md` |

**Nothing runs in parallel.** Steps 2 and 3 look independent and are not — step 3 fails to compile
without step 2. Step 4 could in principle overlap step 3, but the `ffmpeg` agent's rule is that a
rule change arrives with the case that proves it, so they are one unit of work with an ordering
inside it (write the failing case, then the rule), not two parallel tracks.

Step 5 is `orch` rather than `ffmpeg` on purpose. `.claude/agents/ffmpeg.md` is that agent's rule
document, and its own § Done when tells it to keep the section current — but its § Scope confines its
writes to the two `ffmpeg` directories, and the file is in neither. The orchestrator makes that edit
from the agent's report. See § Risks.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It is empty by
design: **this feature adds no GraphQL surface and must not.** What is frozen is therefore mostly a
list of things an implementer will be tempted to change and must not:

- **`allowedLanguagesIso3` stays, and stays the language filter.** It looks redundant next to a tag
  list that carries strictly more information. It is not: `ffprobe` reports `spa`, and only this list
  matches that. Narrowing or dropping it breaks every encode, in every language, silently.
- **`allowedLanguageTags` is consumed, never requested differently.** If the rules turn out to need
  the tag→`iso3` association from the server, that is a contract change: stop, amend `spec.md`,
  re-approve. Do not add a field, do not add an argument, and do not have the worker query anything
  else — it has no database and no second endpoint (Constitution, Articles II and III).
- **The original language stays a separate payload field.** `originalLanguageIso3` is not the first
  element of the allow-list and must not be inferred from list position.
- **`ERROR_ENCODE_NO_ORIGINAL_AUDIO` keeps its key, its `iso3` param and its trigger.** Variant
  narrowing must not add a new failure key, and must not widen or narrow this one.
- **The queue payload (`src/queue/types.ts`) does not change.** This feature adds nothing to the job;
  everything it needs is already on the `processJob` query.

## Migrations

None. No Prisma schema change, no seed change, no data touched. `030-language-regional-variants`
already seeded `es-419` and `es-ES` and already ships them on the payload.

Reversibility: reverting this feature is reverting the diff. The payload field it starts reading was
shipping unread before and would go back to being unread; no state anywhere records that this
feature ran, and no encode already produced becomes invalid.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- | :-- |
| The field is added to `EncodeJobDetails` but not to `EncodeInput`, or to both types but not to the query string | Three hand-retyped copies with no compiler across the GraphQL seam. `allowedLanguageTags` arrives `undefined`, NFR-2 reads that as "no variant requested", and every user's regional preference silently stops working — no error, no failed job, the wrong Spanish track in the library | The four edits are one task, not four (worker step 2). `encode.job.spec.ts` asserts the field reaches the `encode()` call. The `console.log` in `handleEncode` prints the tags, so a live encode shows the truth in `docker compose logs -f worker` |
| `api` seeds a variant tag the worker's table does not know (`pt-BR` the day someone adds it) | The tag is silently ignored, the user's preference does nothing, and nothing anywhere reports it | `variants.ts` logs a named warning for a requested tag with a region subtag it cannot resolve, and `params.spec.ts` pins that an unknown tag degrades to "no variant requested" rather than throwing or dropping the language |
| Variant narrowing is applied before the SDH or commentary filters | An SDH or commentary track that happens to carry a Latin American marker becomes the variant match and discards the plain track. FFmpeg exits 0 and the file ships with commentary as its Spanish audio | Ordering is a requirement (REQ-11, REQ-17), and AC-8 and AC-10 are the cases. The narrowing function is called *after* the existing filters in both rule functions, never inside them |
| The Castilian vocabulary matches a substring of an unrelated title (`EU`, `spain`, `LA`) | A track is labelled and selected as a variant nobody marked; the user gets a track they did not ask for while the one they did is dropped by REQ-4 | Detection goes through the existing `titleWords`/`titleMarks` word-boundary matcher, never `String.includes` on the raw title. `params.spec.ts` already has the "does not read `la` out of the middle of a word" case; the Castilian markers get the equivalent |
| `1.json`'s expected argument array is edited to make the suite green | It is the **only** real-file evidence in the corpus and it is authored by the user, not by an implementer. Edited to match the code, it proves whatever the code does — exactly the failure the corpus exists to prevent | NFR-6. The case is red on purpose when work starts (the audio title), and the rule is what must move. An implementer who thinks the case is wrong **stops and reports**; `.claude/agents/ffmpeg.md` is explicit that the user decides, and this file is now the requirement |
| An implementer invents corpus cases to cover the rules the single case cannot reach | Manufactured `ffprobe` payloads look like evidence and are not — they only restate the implementer's own reading of the rule | NFR-3/NFR-6: the corpus grows from real files the user brings as they use the app. Everything else is a synthetic case in `params.spec.ts`, where it is visibly synthetic |
| The REQ-5 fallback is reached on a release with several unmarked Spanish audio tracks | Every one of them is transcoded to Opus; the encode takes longer and the file is bigger than anyone expects, with nothing indicating why | Accepted (NFR-5), and bounded: the fallback only triggers when a variant was requested and **nothing** in the file is marked, which is the case where dropping a track is a coin flip. The log line naming the fallback is what makes it explicable afterwards |
| The refactor and the rule change land in one commit | A green suite proves nothing about which half was right, and a regression cannot be bisected to a rule | `.claude/agents/ffmpeg.md`'s own rule: corpus green → refactor → corpus still green → then the rule. Steps 3 and 4 respect it; `tasks.md` should keep them separable |
| `.claude/agents/ffmpeg.md` § Rules is left describing the old A4/L1/L2 behaviour | The rule document and the code disagree. The next agent to touch a track rule reads the document, "restores" the unconditional Latin American preference, and REQ-6 quietly reverts | Step 5 is its own task with its own owner (`orch`), listed in `tasks.md`, not folded into the implementation report |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker test -- src/ffmpeg/cases.spec.ts
git status --short services/api services/web
```

Expected: typecheck clean; the full suite green with **more** tests than the 93/12 baseline in
`services/worker/CLAUDE.md` (re-measure, do not cite it); the corpus running more than zero cases and
naming each; `git status` on `api` and `web` printing nothing (NFR-1).

The manual pass, which is what proves the payload seam rather than the rules:

1. On a film's detail page choose **Español latinoamericano**, and confirm it stored —
   `bin/mysql -e 'select * from user_movie_languages'`.
2. Trigger an encode for that film with `ENCODE_SAMPLE_SECONDS` set to a few seconds, so the run is
   minutes rather than hours.
3. `docker compose logs -f worker` — the `[encode] <id>:` line must print `allowedLanguageTags`
   containing `es-419` alongside the existing `allowedLanguagesIso3` containing `spa`. An empty or
   absent tag list here is the silent failure in row 1 of § Risks, caught before it reaches a file.
4. `bin/mysql -e 'select ffmpegCommand from process_jobs order by id desc limit 1'` — the command
   must map the Spanish track the rules chose, and its `-metadata:s:a:N title=` must name the variant
   when the source marked one.
5. Repeat once with the film's preference cleared, and confirm the Spanish selection changes to the
   quality-ranked one with no regional preference applied (REQ-6) — this is the behaviour that
   differs from today's code on a real file.
