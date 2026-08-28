---
title: Worker Language Variant Selection
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-28
last_updated: 2026-08-28
status: Implemented
services: [worker]
---

# SPEC: Worker Language Variant Selection (`spec.md`)

## Context & Goal

`030-language-regional-variants` gave the regional preference a home — `es-419` and `es-ES` are rows
in the `languages` catalog, a user picks one in Settings or on a title's detail page, and the merged
set of chosen tags already reaches the encode job as `EncodeJobDetails.allowedLanguageTags`. That
spec deliberately stopped at the wire: it declared `NFR-4 (Worker Untouched)` and left the harder
half — what the FFmpeg rules should actually do with the preference — to a follow-up. This is that
follow-up, and it is the whole feature: nothing outside `services/worker/` changes.

Today the worker never reads the new field. `buildFfmpegCommand`
(`services/worker/src/ffmpeg/buildCommand.ts`) passes `allowedLanguagesIso3` to both `getAudioParams`
and `getSubtitleParams` in `services/worker/src/ffmpeg/params.ts`, and inside those two functions the
only trace of a regional variant is `LATIN_AMERICAN_MARKERS` — a hard-coded title heuristic that
prefers the Latin American Spanish track for *every* user, whether they asked for it or not, and
prefers it in exactly the same way for audio and for subtitles. A user who chose European Spanish
gets the Latin American track; a user who chose nothing gets a regional guess nobody made. The
markers themselves are not the problem — `ffprobe` reports `tags.language` as `spa` for both variants
and the track title is genuinely the only signal in the file — the problem is that the heuristic
answers a question the user has now been given a way to answer.

Once this ships, the title heuristic stops being a default and becomes the matcher between what the
user asked for and what the release contains. The governing principle throughout is the one the user
stated when scoping this work: **it is easier to remove a track afterwards than to add one that was
never there.** So when the release marks its Spanish tracks and one of the marks is what the user
asked for, the encode keeps exactly that; when the release marks nothing, or marks only variants
nobody asked for, the encode keeps every Spanish track and the user prunes by hand after the fact.
This changes no pipeline stage's status in the root `CLAUDE.md` — the transcode stage keeps working
for films and series — and it adds no GraphQL surface.

Strictly, Article VII does not compel a spec here: this touches one service, no schema and no
contract. It exists because `030` promised it, because the rules below are the kind of decision that
must be written down before an implementer meets a release with three Spanish tracks at 3am, and
because the `services/worker/ffmpeg/` case corpus is the durable form those rules take.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Read The Tags)**: The worker must read `EncodeJobDetails.allowedLanguageTags` from the
      encode job payload and carry it through to the audio and subtitle rule functions, alongside the
      `allowedLanguagesIso3` list it already receives. The tags list never replaces the ISO-639-2/B
      list — that list is what matches `ffprobe`'s `tags.language`, and it stays the language filter.

- [x] **REQ-2 (Requested Variants Per Language)**: For each allowed language the worker must know
      which regional variants of it the user asked for — the set of tags in `allowedLanguageTags`
      that carry a region subtag and belong to that ISO-639-2/B code. Today that set is non-empty
      only for `spa` (`es-419`, `es-ES`); the rule must be expressed over "a language with requested
      variants", not over Spanish as a special case, so a future `pt-BR`/`pt-PT` seed pair needs no
      new rule.

- [x] **REQ-3 (Detected Variant)**: The worker must classify a stream as one of its language's
      variants or as *undetected*, from the track title alone. `es-419` keeps today's
      `LATIN_AMERICAN_MARKERS`; `es-ES` uses the Castilian vocabulary the rule document already
      records under L1 in `.claude/agents/ffmpeg.md` (`españa`, `spain`, `castellano`, `EU`,
      `es-ES`) — real spellings from a real file, not invented here. A stream whose title matches no
      marker is undetected and is never assumed to be either variant. Detection itself is
      **unconditional**: it runs whether or not the user requested a variant, because the track title
      written to the output depends on it (REQ-12, REQ-18) and the library must read the same for the
      same track regardless of who triggered the encode. What the request gates is *selection*
      (REQ-4, REQ-6), never labelling.

- [x] **REQ-4 (Variant Beats Quality)**: When a language has requested variants and at least one
      stream is detected as one of them, the encode must keep only streams detected as a *requested*
      variant. A stream detected as a variant the user did not ask for, and an undetected stream of
      that language, are both dropped. This outranks every quality ordering: a requested Latin
      American stereo track wins over a European Spanish 5.1 track, and over an unmarked 5.1 track.

- [x] **REQ-5 (Keep Everything On No Match)**: When a language has requested variants but **no**
      stream of that language is detected as one of them, the encode must keep every surviving stream
      of that language — undetected ones and non-requested-variant ones alike, for both audio and
      subtitles. This is the "easier to remove than to add" case: the user validates manually once
      the encode finishes.

- [x] **REQ-6 (No Variant Requested, No Regional Preference)**: When a language has no requested
      variants, the worker must apply no regional preference at all. The Latin American title
      heuristic that runs unconditionally today must stop running in this case: audio falls back to
      the existing quality ordering alone, subtitles keep everything that survives the other rules.
      The base row `es` is not selectable in the picker (`030`, REQ-3), so the only way `spa` reaches
      the worker without a requested variant is a title whose TMDB `originalLanguage` is `"es"`,
      whose original-language tag is the base `es` — exactly the case that must not be guessed at.

- [x] **REQ-7 (Original Language Audio Still Mandatory)**: The original language remains the one
      mandatory audio track, and its absence remains a hard failure raising
      `ERROR_ENCODE_NO_ORIGINAL_AUDIO`, unchanged. Variant narrowing must never be the reason the
      original language disappears: narrowing selects *within* a language and can never empty one
      (REQ-4 only applies when a match exists, REQ-5 keeps everything otherwise).

- [x] **REQ-8 (At Least One Audio Track)**: Every encode must ship at least one audio track. REQ-7
      already guarantees it for a file that gets encoded at all: the original language survives or
      the job fails.

- [x] **REQ-9 (One Audio Per Requested Variant)**: The unit of audio selection becomes the variant,
      not the language. For a language with requested variants and at least one detected match, the
      encode keeps the highest-quality stream *per requested variant that has a match* — a user who
      chose both Spanish variants and a release that ships both gets two Spanish audio tracks. For a
      language with no requested variants, the existing one-best-per-language rule is unchanged.

- [x] **REQ-10 (Audio Quality Ordering Unchanged)**: Within a variant — or within a language with no
      requested variants — the existing ordering decides: source codec priority, then channel count,
      then bitrate. Nothing about it changes.

- [x] **REQ-11 (Commentary Still Dropped)**: The commentary/description/SDH audio blacklist is
      unchanged and is applied before any variant reasoning, so a director's commentary track can
      never be the thing a variant match selects.

- [x] **REQ-12 (Audio Titles Name Their Language)**: Every kept audio track's `title` metadata must
      name its language, resolved through the **same** table the subtitle titles already use — the L2
      table in `.claude/agents/ffmpeg.md`, which for a Spanish track resolves to the detected variant.
      `English Surround 5.1 (Opus)`, `Latino Surround 5.1 (Opus)`, `Español (España) Stereo (Opus)`,
      `Español Stereo (Opus)`. This replaces today's language-less `Surround 5.1 (Opus)`, and it is
      not only for the variant case: one table, two callers, so a language never reads one way in a
      subtitle and another way in an audio track. The `language` metadata stays the ISO-639-2 code
      from the source; the name lives in the title, because `spa` is all a player reads off the
      former. A language the table does not cover keeps today's subtitle-side fallback and is a
      question for the user, never a guess (`.claude/agents/ffmpeg.md` § L2).

- [x] **REQ-13 (Subtitles Stay Optional)**: An encode with no subtitle track at all remains a
      success. Nothing in this feature makes a missing subtitle — in any language, including the
      original — a failure.

- [x] **REQ-14 (Original Language Subtitle Kept)**: If a text subtitle in the original language is
      present in the file and survives the format and emptiness rules, it must be kept. It is never
      dropped by variant narrowing, for the same reason as REQ-7.

- [x] **REQ-15 (Subtitles Keep Every Match)**: Subtitles are not narrowed to one per language or one
      per variant. For a language with requested variants and at least one match, every stream
      detected as a requested variant is kept (REQ-4); with no match, every surviving stream of that
      language is kept (REQ-5); with no requested variants, every surviving stream is kept.

- [x] **REQ-16 (Text Subtitles Only, Empty Dropped)**: Unchanged. Only `subrip`/`mov_text`/`tx3g`
      survive, and a stream whose cue payload is below the existing thresholds is dropped before any
      variant reasoning.

- [x] **REQ-17 (SDH Dropped Only When There Is An Alternative)**: Unchanged from today. A subtitle
      identified as hearing-impaired — by disposition or by title marker — is dropped when another
      subtitle of the same language survives, and kept when it is the only one. Ordering matters:
      the SDH rule is applied **before** variant narrowing, so an SDH track never becomes the
      variant match that discards a plain one.

- [x] **REQ-18 (Subtitle Titles Name The Variant)**: A Spanish subtitle detected as Latin American
      keeps the title `Latino`; one detected as European reads `Español (España)` — a new row in the
      L2 table, which today collapses Castilian into the plain `Español`; an undetected one keeps
      `Español`. Every other language keeps today's behaviour. The resolver becomes shared with
      REQ-12 rather than duplicated.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Worker Only)**: No file outside `services/worker/` changes. No Prisma migration, no
      decorator change, no `schema.gql` diff, no `web` change. `git status services/api services/web`
      is clean when this feature closes.

- [x] **NFR-2 (Missing Field Degrades Quietly And Safely)**: `allowedLanguageTags` is retyped by hand
      on the worker side with no compiler across the seam. If it arrives `undefined` or empty, the
      worker must behave as "no variant requested" (REQ-6) and log that it did, rather than throw or
      silently drop a language. Every encode must still complete.

- [x] **NFR-3 (Every Rule Is Pinned By A Test)**: Every rule above that changes observable output must
      be pinned, because this is the class of failure the `src/ffmpeg/` suites were written to defend
      against (Constitution, Article IX): FFmpeg exits 0, the `ProcessJob` reports `COMPLETED`, and
      the file lands in the library with the wrong Spanish track and no error in any log. Where the
      pin lives is decided by `.claude/agents/ffmpeg.md`, not by this spec: a rule a **real** file
      demonstrates belongs in the `services/worker/ffmpeg/` corpus as verbatim `ffprobe` output plus
      the exact expected command, and a rule with no real file behind it belongs in
      `src/ffmpeg/params.spec.ts` as a synthetic stream. Manufacturing an `ffprobe` payload into the
      corpus is forbidden there and this feature does not do it.

- [x] **NFR-6 (The Corpus Holds One Case, And It Is Authored By The User)**: The corpus is being
      rebuilt from real usage — the user adds a JSON when a file comes out wrong — and today it holds
      exactly one case, `services/worker/ffmpeg/1.json`, which is the one case that must pass. This
      feature adds **no** corpus case of its own and invents no probe. `1.json`'s expected argument
      array is authored by the user and is read as the requirement: it pins the audio title of
      REQ-12, the `Latino` subtitle title of REQ-18, the SDH drop of REQ-17, and — through the
      `allowedLanguageTags: ["en", "es-419"]` on its `input` — the requested-variant selection of
      REQ-4. It fails against today's code, which is the intended starting state (`.claude/agents/ffmpeg.md`:
      the case comes first, red, and the rule second). Everything the single case cannot reach is a
      synthetic case in `params.spec.ts`.

- [x] **NFR-4 (No Second Pass Over The File)**: Variant detection reads the `ffprobe` metadata the
      worker already has. It must not open the file again, run a second `ffprobe`, or inspect the
      release name.

- [x] **NFR-5 (Encode Cost Of The Fallback Is Accepted)**: REQ-5 can make an encode transcode several
      Spanish audio tracks to Opus where today it transcodes one. That cost is accepted deliberately:
      a re-download is more expensive than a redundant audio track, and the user prunes afterwards.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** It adds no type, field, argument or
error, and changes none. It begins *consuming* `EncodeJobDetails.allowedLanguageTags`, which
`030-language-regional-variants` already froze, shipped and documented in
`docs/spec/graphql-contract.md` § "The encode payload carries the allowed languages". That document's
closing sentence — "The worker does not read `allowedLanguageTags` yet; teaching it to is explicitly
out of scope … and left to a follow-up spec" — is what this feature makes stale, and updating that
one paragraph is the only documentation change it owes.

What it does inherit is the hand-retyping hazard the contract names. `EncodeJobDetails` exists twice
on the worker side — `services/worker/src/jobs/encode.job.ts` (the GraphQL query and its result type)
and `services/worker/src/encode/types.ts` (`EncodeInput`, the subset the driver receives) — with no
codegen across either seam. Missing either one makes the field arrive `undefined`, which under NFR-2
is a silent reversion to today's behaviour rather than an error, so the query string, both types and
the pass-through are one indivisible change.

One thing the payload does **not** carry is the association between a tag and the ISO-639-2/B code it
resolves to: `api` sends two flat lists, and only `api` holds the `languages` table that links them.
The worker therefore resolves `es-419` and `es-ES` to `spa` from a worker-local table, in the same
spirit and for the same reason as `services/worker/src/ffmpeg/iso639.ts` — worker-local knowledge
about how a code appears in a file, not a second copy of the contract. Extending the payload to carry
`{ tag, iso3 }` pairs would remove that duplication and is the right move the day a third language
grows variants; it is out of scope here because it would turn a worker-only change into a
cross-service one for two rows of a table (Article X).

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| No audio track in the original language survives filtering | `KeyedError`, key `error.encode.noOriginalAudio`, params `{ iso3 }`, reported through the existing `encodeFailed` path — unchanged by this feature | today's message, unchanged |
| A requested variant matches no stream in the release | **not an error** — REQ-5 keeps every stream of that language and the encode succeeds | none |
| A requested language has no track at all | **not an error** — today's warning log, unchanged | none |
| No subtitle survives the rules | **not an error** — today's log line, unchanged | none |

## Data Model Changes

None.

## Acceptance Criteria

Each criterion below is an automated test unless it names a command, and all of them are reached by
`bin/npm worker test`. Per NFR-3 and NFR-6 there is exactly one corpus case,
`services/worker/ffmpeg/1.json`, authored by the user; **AC-0 is that case** and every other
criterion is a synthetic-stream case in `src/ffmpeg/params.spec.ts`.

- [x] **AC-0**: `bin/npm worker test -- src/ffmpeg/cases.spec.ts` runs `1.json` and matches its
      expected argument array exactly — including `-metadata:s:a:0 title=English Surround 5.1 (Opus)`
      (REQ-12), `-metadata:s:s:1 title=Latino` on stream 12 with stream 13 unmapped (REQ-4, REQ-18),
      and the SDH English subtitle on stream 3 unmapped while stream 2 is kept (REQ-17). This case
      fails against today's code on the audio title and passes only once the feature is complete.

- [x] **AC-1**: Given `allowedLanguageTags` containing `es-419` and a file with a Latin-American-marked
      Spanish stereo track and an unmarked Spanish 5.1 track, the built command maps the stereo track
      and does **not** map the 5.1 one.

- [x] **AC-2**: Given `allowedLanguageTags` containing `es-419` and a file with a Latin-American-marked
      stereo track and a `Castellano` 5.1 track, the command maps only the Latin American one.

- [x] **AC-3**: Given `allowedLanguageTags` containing both `es-419` and `es-ES` and a file carrying
      one marked track of each, the command maps **both**, and their `-metadata:s:a:N title=` values
      are `Latino …` and `Español (España) …` respectively (REQ-12).

- [x] **AC-3b**: REQ-12 is not a Spanish rule and not a variant rule. An audio track in a language
      with no variants resolves through the same shared table as the subtitles — `English …` for an
      English track (pinned on a real file by AC-0) — and a language the table does not cover falls
      back to its ISO-639-2 code exactly as the subtitle side does today, never to a language-less
      title. Filling the table for such a language is a question for the user, not a guess
      (`.claude/agents/ffmpeg.md` § L2); no case in this feature brings one.

- [x] **AC-4**: Given `allowedLanguageTags` containing `es-ES` and a file whose only Spanish tracks
      are one unmarked 5.1 and one Latin-American-marked stereo, the command maps **both** Spanish
      tracks — the requested variant matched nothing, so nothing is thrown away (REQ-5).

- [x] **AC-5**: Given `allowedLanguagesIso3` containing `spa` and `allowedLanguageTags` containing
      only `es` (a Spanish-original title, no variant chosen), and a file with a Latin-American-marked
      stereo track and an unmarked 5.1 track, the command maps the **5.1** track — quality decides,
      the latino heuristic does not run (REQ-6). This is the case that fails against today's code.

- [x] **AC-6** *(failure path)*: Given `originalLanguageIso3: "jpn"`, `allowedLanguageTags` containing
      `es-419`, and a file whose only audio tracks are Spanish, `buildFfmpegCommand` throws a
      `KeyedError` with key `error.encode.noOriginalAudio` — variant narrowing did not create, hide or
      change this failure.

- [x] **AC-7** *(failure path)*: Given a payload whose `allowedLanguageTags` is absent, the command is
      built without throwing and is byte-for-byte the command today's code produces for the same file
      with the latino heuristic removed — i.e. the no-variant-requested path of REQ-6 (NFR-2).

- [x] **AC-8**: Given `allowedLanguageTags` containing `es-419` and a file with a Latin-American-marked
      *commentary* track and an unmarked Spanish 5.1 track, the commentary track is not mapped and the
      5.1 track is (REQ-11 runs before REQ-4, so the fallback of REQ-5 applies to what is left).

- [x] **AC-9**: Given `allowedLanguageTags` containing `es-ES` and a file with a `Castellano` SRT and a
      `Latino` SRT, the command maps only the `Castellano` one, titled `Español (España)`.

- [x] **AC-10**: Given `allowedLanguageTags` containing `es-419` and a file whose Spanish subtitles are
      one `Latino SDH` and one plain `Latino`, only the plain one is mapped — the SDH rule runs first
      and the variant match is decided on what remains (REQ-17).

- [x] **AC-11**: Given `allowedLanguageTags` containing `es-419` and a file whose *only* Spanish
      subtitle is a `Latino SDH` track, that track **is** mapped (REQ-17, the no-alternative case).

- [x] **AC-12**: Given a file with an original-language English text subtitle and a requested `es-ES`
      that matches nothing, the English subtitle is mapped and the Spanish handling follows REQ-5 —
      the original language is never collateral damage of variant narrowing (REQ-14).

- [x] **AC-13**: A file with no subtitle stream at all still builds a valid command and the encode
      succeeds (REQ-13).

- [x] **AC-14**: `bin/npm worker run test` passes, and `git status services/api services/web` is clean
      (NFR-1).

## Out of Scope

- **Separate preferences for audio and subtitles.** One merged set of tags governs both, exactly as
  `030` decided. The rules differ between the two resources — audio narrows to one per variant,
  subtitles keep every match — but the *preference* they read is the same one.

- **Extending the encode payload with `{ tag, iso3 }` pairs.** The worker resolves the two Spanish
  variant tags to `spa` locally. Moving that mapping onto the wire is a cross-service change for two
  table rows; it becomes worth doing when a third language is given variants.

- **Variants for any language other than Spanish.** The rules are written to be generic over "a
  language with requested variants", but `es-419`/`es-ES` are the only variant rows seeded, so they
  are the only ones with markers and the only ones in the case corpus.

- **Detecting a variant from anything but the track title.** No release-name parsing, no audio
  fingerprinting, no second `ffprobe`. When the file says nothing, REQ-5 is the answer.

- **Telling the user what the encode actually kept.** `030`'s REQ-12 stands: a preference is a
  request, not a promise, and this feature adds no report, warning or GraphQL surface about a variant
  the release could not satisfy. The user inspects the finished file.

- **Removing a variant track after the fact.** Manual pruning is the accepted workflow for REQ-5's
  fallback; no UI or mutation for it is proposed here.

- **Changing the quality ordering, the CRF rules, the remux detection or the video path.** Untouched.
