---
title: Subtitle Variant Detection
spec_version: 0.5.0
author: Juan "Dientuki" Farias
created_at: 2026-11-15
last_updated: 2026-11-15
status: Implemented
services: [api, web, worker]
---

# SPEC: Subtitle Variant Detection (`spec.md`)

## Context & Goal

Spec `110` taught the worker to tell a Spain Spanish audio track (`es-ES`) from a Latin American one
(`es-419`) when the metadata does not say which is which. It transcribes the same windows of both
tracks with whisper.cpp and scores dialect markers in the resulting text: `vosotros`, `vale` and
`a por` count toward Spain, `ustedes`, `carro` and `ahorita` toward Latin America. Subtitle tracks
have exactly the same gap. `031`'s `detectVariant` (`services/worker/src/ffmpeg/variants.ts`) reads
only `tags.title`. Two Spanish text subtitle tracks that are both tagged `spa` and carry the same
title, or none, resolve to no variant. `selectSubtitleStreams`
(`services/worker/src/ffmpeg/params.ts`) then keeps both, and `getSubtitleParams` titles both plain
`Español`. A user who asked for `es-419` subtitles gets the Spain track too, with no way to tell
them apart short of reading them.

For subtitles the check is far cheaper, because the dialogue is already text. `110`'s scoring runs
on Whisper's transcript. A subtitle hands over that text directly, with no transcription, no model
and no CPU budget to speak of. Two places in the pipeline produce Spanish subtitles whose variant
nobody states:

- **The encode (Transcode stage).** `102` already reads the first 900 s of every text track of a
  language that has more than one, in one `ffmpeg` pass that decodes no video or audio. Those are
  exactly the tracks this feature looks at. The same sample carries the same scenes in both
  translations, so two tracks are compared against each other, as `110` compares two dubs. `102`'s
  C2 rule already drops a track that is the same translation as another, so the encode never needs
  a duplicate verdict of its own.
- **The subtitle search (Notify media server stage, `103`/`106`/`107`).** `api` downloads up to
  three ranked OpenSubtitles candidates per missing language and has the worker sync-check each
  (`subtitle-sync`). The first one accepted is embedded, titled with the language's plain track
  title. The search works per `iso3`, so a user who asked for `es-419` can end up with a Spain
  subtitle embedded as `Español`, and OpenSubtitles uploaders often mislabel the variant anyway.
  Here a candidate arrives alone, with no second track to compare against, so it is scored on its
  own with the same markers. A candidate that is clearly the variant the owners did not ask for is
  rejected and the next one is tried, the same way a candidate that fails the sync check is.

The switch is `110`'s existing per-user `audioVariantDetection` preference, widened to cover both
kinds of track. There is still one checkbox in `/preferences`, now worded for audio and subtitles.
It is enabled when the user's audio **or** subtitle languages include one with regional variants.
`api` resolves a subtitle-specific effective opt-in, separate from the audio one. Every decided
track, encoded or downloaded, reads `Latino` or `Español (España)`. This changes the Transcode and
Notify media server stages of the root `CLAUDE.md` pipeline table, plus the `/preferences` screen
and the subtitle search's per-language outcome.

## Requirements

### Functional Requirements

#### Shared

- [ ] **REQ-1 (One preference for both)**: The existing `audioVariantDetection` user preference
      (`110` REQ-1) gates audio variant detection, subtitle variant detection in the encode, and
      the variant check on downloaded subtitles. It keeps its stored column, its GraphQL name and
      its mutation. It stays off by default, is never inferred and has no per-title override. No
      second preference is added.
- [ ] **REQ-2 (Preference control)**: `/preferences` keeps one checkbox. It is **enabled** while
      the user's audio languages **or** subtitle languages include at least one language with
      regional variants (`110` REQ-3, unchanged). Otherwise it is shown disabled with the hint, as
      today. The label, help text and disabled hint are reworded to cover subtitles (copy table
      below). Removing the last such language still keeps the stored value, inert.
- [ ] **REQ-3 (Effective subtitle opt-in)**: For a title, `api` resolves one effective subtitle
      variant opt-in, separate from `110` REQ-4's audio one. It is true when at least one owner of
      the title has the preference on **and** that owner's subtitle languages for the title include
      a language with regional variants. An owner's subtitle languages are their global ones merged
      with their per-title ones, the same merge that feeds `allowedSubtitleLanguageTags`. The encode
      resolves it per job (REQ-4). The subtitle search resolves it per search, when the search
      starts (REQ-12). `110` REQ-4's audio resolution is unchanged and still looks at audio languages
      only.
- [ ] **REQ-4 (Shared marker table)**: Encode detection and the download check score text with the
      **same** per-language dialect markers and weights as `110` REQ-6. There is one table per
      language, shared by audio and subtitles, so tuning it tunes all three. The registry is `110`
      REQ-11's, and Spanish is the only language in it today. Each use keeps its own decision
      threshold (REQ-6, REQ-14), tuned in `plan.md` against the corpus and never assumed equal to
      `110`'s audio margin. Written text carries no transcription errors, and a whole subtitle file
      is far denser in dialogue than five audio windows.
- [ ] **REQ-4b (Markers added to the shared table)**: The shared Spanish table gains these markers,
      so the change applies to `110`'s audio scoring too:
      - **Spain:** the plural imperative `id` (`Id a casa`), `curro`/`currar`, `mola`, `guay`,
        `chaval`, `gilipollas`, `hostia`, `flipar`, `venga`, `piso` (for an apartment), `pasta`
        (for money).
      - **Latin American:** `departamento`, `rentar`, `enojado`, `apúrate`, `chamaco`, `güey`,
        `chido`.

      `id` counts only in lower case or as the first word of a cue, never as `ID`, which is
      "identification" in both variants. Which list each marker joins (strong or weak) and its
      weight are tuned in `plan.md` on the corpus. With the new markers, `110`'s three films must
      still produce exactly the verdicts `110` AC-1 to AC-3 record. If one changes, the marker
      responsible is weakened or dropped, never the `110` result.

#### In the encode

- [ ] **REQ-5 (When encode detection runs)**: The order for a subtitle inside the file is
      metadata first, then text: `031`'s `detectVariant` reads the track's title, and only a track
      it does not resolve is checked by its text. The worker runs that text check for a language
      only when all of these hold:
      - compression is on (`032`);
      - the job's effective subtitle opt-in is true (REQ-3);
      - the job's allowed subtitle languages include the language;
      - a detector is registered for the language;
      - after `031`'s selection and `102`'s content rules (C0–C3), at least one **text** subtitle
        stream of that language remains whose variant `031`'s `detectVariant` does not resolve;
      - no verdict is stored for those streams (REQ-9).

      Streams the metadata already resolves are never re-detected and never take part in the text
      check. Image subtitles (`pgs`, `vobsub`, `dvb`) are never candidates. How the unresolved
      streams are decided depends on how many there are:
      - **exactly two:** they are compared against each other (REQ-6);
      - **one, or three or more:** each is decided on its own (REQ-6b).
- [ ] **REQ-6 (Comparative decision, a pair)**: Two unresolved candidates are compared against
      each other, never against an absolute threshold. The check reads the text of the same sample
      `102` reads (the first 900 s of each track, markup stripped). The track that wins by at least
      the encode decision margin is the `es-ES` one and the other is the `es-419` one. Below the
      margin both are **undecided**.
- [ ] **REQ-6b (Absolute decision, a lone track)**: Each unresolved candidate that is not part of a
      pair is decided on its own, with the same absolute rule as a downloaded subtitle (REQ-14),
      over its 900 s sample. A sample below REQ-14's minimum word count is undecided. Three or more
      candidates may end with two decided as the same variant. Each is then titled as decided, and
      none is dropped for that.
- [ ] **REQ-7 (Verdict feeds 031)**: A decided stream is treated exactly as if its title carried
      the matching `031` marker. It takes part in `031`'s requested-variant narrowing for subtitles
      and is titled with `031`'s variant title (`Latino`, `Español (España)`). An undecided stream
      behaves exactly as today: it is unresolved, kept, and titled with the language's plain track
      title. Two undecided streams therefore both read `Español`, deliberately, as in `110` REQ-7.
      No suffix or numbering is added. The output stream's `language` tag stays `spa`.
- [ ] **REQ-8 (No duplicate verdict)**: The encode never drops a subtitle track for being the same
      as the other. That is `102` C2's job, and it runs first. A pair that reaches REQ-6 is either
      decided or undecided.
- [ ] **REQ-9 (Persistent verdict, through `111`)**: Every encode verdict, decided or undecided, is
      stored in `111`'s encode-verdict store as a new verdict kind, separate from `110`'s
      `audio-variant` and from `102`'s. It follows `111`'s rules: Redis, the `perceptor:encode:`
      namespace, a 30-day TTL, and a Redis failure counts as "no verdict". Its identity is the input
      file (path, size, modification time), the detector's `iso3` and the candidate stream indices
      (the pair for REQ-6, the single stream for REQ-6b). The opt-in and the allowed languages only gate whether detection runs, so they are
      not part of the identity. A matching stored verdict is used and detection never re-runs. That
      covers a worker restart (`054`), a stop and resume (`097`) and a retry (`065`, `095`).
- [ ] **REQ-10 (Encode failure is silent)**: If the sample cannot be read or parsed, or a
      candidate's sample is empty, the encode proceeds with the candidates unresolved, exactly as
      with the feature off. The failure is logged and **nothing** is stored, so a later run tries
      again. If storing a verdict fails, the worker still uses it for the current encode and logs
      the failure (`111` NFR-3). It never fails the encode.
- [ ] **REQ-11 (Encode cancellation)**: Encode detection honours the encode's `AbortSignal` the
      same way `102` does. A delete (`047`), stop (`097`) or discard (`095`) while the sample is
      being read terminates the read. No verdict is stored, and only `EncodeCancelledError`
      propagates.

#### In the subtitle search

- [ ] **REQ-12 (When the download check runs)**: For each downloaded candidate (`103` REQ-8, `107`)
      of a language, the variant check runs only when all of these hold:
      - the search's effective subtitle opt-in is true (REQ-3);
      - a detector is registered for the candidate's language;
      - the candidate is a text subtitle that can be read.

      The check does not depend on compression (`032`). It reads only the downloaded subtitle file,
      never the library file.
- [ ] **REQ-13 (Wanted variant)**: For each language, the search derives a **wanted variant** from
      the subtitle language tags of the owners whose preference is on (REQ-3). If those tags name
      exactly one variant of the language (only `es-419`, or only `es-ES`), that is the wanted
      variant. If they name both, or only the plain language (`es`), there is none.
- [ ] **REQ-13b (Asking the provider for the wanted variant)**: When a language has a wanted
      variant (REQ-13) and OpenSubtitles lists its own language code for that variant (the Latin
      American Spanish one for `es-419`), the search first asks the provider for that code. If that
      yields fewer usable candidates than `103`'s limit of three, after `103`/`107`'s filtering, the
      search also asks for the plain language code (`es`) and fills the remaining places from it. A
      candidate both queries return is counted once. Candidates from the variant code rank ahead
      of the plain-code ones, and each group keeps `103`'s ranking. The total stays at most **three
      candidates downloaded and tried per language**, whichever query they came from. Every
      candidate is still checked (REQ-14, REQ-15), including one the provider labels as the wanted
      variant, because uploaders mislabel. When there is no wanted variant, or the variant has no
      code of its own at the provider (`es-ES` today, whose code is the plain `es`), the search asks
      for the plain code exactly as today. `plan.md` confirms the provider's exact code from its
      language list; this spec does not guess it.
- [ ] **REQ-14 (Absolute decision)**: A downloaded candidate is scored on its own, over its whole
      text with markup stripped, with the shared markers (REQ-4). There is no second track to
      compare against. The score is a rate (markers per 1,000 words), so a film and an episode are
      judged alike. A rate at or above the Spain threshold is `es-ES`. A rate at or below the Latin
      American threshold is `es-419`. Anything in between, or a text below a minimum word count (a
      forced-only track, a near-empty file), is **undecided**. The thresholds and the minimum are
      tuned in `plan.md` against human-labelled subtitle files of each variant, whole files and
      900 s samples alike, never guessed. The same rule decides a lone track in the encode
      (REQ-6b).
      Like every scored rule here, an uncertain score resolves to undecided.
- [ ] **REQ-15 (Reject the unwanted variant)**: When a wanted variant exists (REQ-13) and a
      candidate is decided as the **other** variant, the candidate is rejected with
      `error.subtitleSearch.wrong_variant`, however good its sync result. The search then moves on
      to the language's next candidate, exactly as for any other rejection (`103` REQ-9). A rejected
      candidate still counts toward the three-candidate limit (`103` REQ-8) and has still spent its
      provider download. If every candidate is rejected, the language ends `REJECTED`, and its
      `reasonKey` is the last rejection's, as today. An **undecided** candidate, or any candidate
      when there is no wanted variant, is never rejected for its variant.
- [ ] **REQ-16 (Titling the embedded track)**: An accepted candidate whose check decided a variant
      is embedded titled with `031`'s variant title (`Latino`, `Español (España)`) instead of the
      language's plain track title. An undecided or unchecked one is embedded as today. The
      embedded track's `language` tag stays the language's `iso3`, as in REQ-7.
- [ ] **REQ-17 (Download check failure is silent)**: If the check cannot read or parse the
      candidate, or the text is empty, the candidate is treated as undecided: it is neither
      rejected nor titled for a variant, and the failure is logged. The check never fails the
      candidate, the sync check or the search on its own. A candidate that cannot be read for the
      sync check fails the way `103` already defines.
- [ ] **REQ-18 (Visible outcome)**: A language whose search ended `REJECTED` because of REQ-15
      shows `error.subtitleSearch.wrong_variant` in the existing per-language outcome
      (`SubtitleSearchStatus`, `103`). No new badge or field shows the variant of an embedded track.
      Its title already does.

#### Both

- [ ] **REQ-19 (Logging)**: The worker logs, per language and per candidate where detection ran,
      the stream index or candidate, its score and the verdict (`es-ES`, `es-419`, or undecided).
      It also logs when an encode reused a stored verdict.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One pass, no new dependency)**: The encode makes at most **one** subtitle sample
      read, shared by `102` and this feature. When `102` would read anyway, the candidates join its
      pass. When `102` does not read, because a language has a single text track or its verdict is
      stored, the same kind of pass (first 900 s, text only, nothing decoded) is made for this
      feature's candidates alone. There are never two in one encode. The download check reads only the small staged subtitle file. No
      new binary, model or image dependency is added.
- [ ] **NFR-2 (Time budget)**: Scoring adds at most about one second of wall time per encode
      language or per downloaded candidate on the reference host, on top of the sample read.
      `plan.md` records the measurement.
- [ ] **NFR-3 (Err on keeping)**: In the encode, every ambiguity resolves to undecided, keeping the
      streams. That covers a tie, a low margin, a rate between the thresholds, an empty sample, and
      a forced-only track left after `102`. A decided lone track is never dropped for being the
      variant the user did not ask for: `031`'s narrowing never empties a language (`031` REQ-5),
      so it is kept and titled with its variant, which tells the user what they got. In the search, every ambiguity resolves to undecided,
      accepting the candidate as today. A candidate is rejected only on a decided verdict against an
      explicit wanted variant.
- [ ] **NFR-4 (Quota)**: The search never downloads more than `103`'s three candidates per
      language, across both provider queries of REQ-13b. A second query is a search call, not a
      download, so it costs no download quota. A wrong-variant rejection costs the download already
      spent, nothing more. With the preference off, the search queries and downloads exactly what it
      does today.
- [ ] **NFR-5 (No backfill)**: Files already in the library are never re-examined, and subtitles
      already embedded are never retitled. The feature acts only on encodes and searches that run
      after it ships.
- [ ] **NFR-6 (Widened meaning of an existing opt-in)**: A user who turned `audioVariantDetection`
      on before this ships gets the subtitle checks too, with no notice. This is accepted. Encode
      detection only narrows or retitles tracks the user's own language preferences already select.
      The download check only rejects a subtitle in the variant the user did not ask for.

## GraphQL Contract Delta

```graphql
type UserPreferences {
  # …existing fields unchanged…
  """Gate for audio and subtitle variant detection (110 REQ-1, 118 REQ-1). False for every user until they say otherwise."""
  audioVariantDetection: Boolean!
}

type EncodeJobDetails {
  # …existing fields unchanged, audioVariantDetection included…
  """Effective opt-in for subtitle variant detection on this job (118 REQ-3)."""
  subtitleVariantDetection: Boolean!
}

type SubtitleSyncDetails {
  id: Int!
  filePath: String!
  candidatePath: String!
  """iso3 of the candidate's language when the variant check must run (118 REQ-12); null means do not run it."""
  variantDetectionIso3: String
}

type Mutation {
  subtitleSyncCompleted(
    id: Int!, offsetMs: Int!, framerateRatio: Float!,
    reference: SubtitleSyncReference!, score: Float!,
    mediaDurationMs: Int!, lastChapterStartMs: Int,
    """Variant tag the check decided (`es-ES`, `es-419`); null when undecided, failed or not run (118 REQ-14 REQ-17)."""
    variantTag: String
  ): Boolean!                                                          # service only
}
```

`Language.hasRegionalVariants`, `setAudioVariantDetection(enabled: Boolean!): UserPreferences!`,
`subtitleSyncFailed` and `SubtitleSearchLanguage` are unchanged. Only the description of
`UserPreferences.audioVariantDetection` changes. `subtitleSyncCompleted` gains one nullable argument,
and `SubtitleSyncDetails` one nullable field. The wrong-variant rejection travels in the existing
`SubtitleSearchLanguage.reasonKey`, with `outcome: REJECTED`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setAudioVariantDetection` without a session | `UnauthorizedException` (existing guard) | `error.auth.unauthenticated` (existing) |
| `setAudioVariantDetection(true)` while the user has no audio or subtitle language with variants | none: accepted and stored, inert per REQ-2/REQ-3 | none |
| `subtitleSyncCompleted` with a `variantTag` that is no registered variant of the candidate's language | none: `api` logs it and treats the candidate as undecided (REQ-17) | none |
| Every candidate of a language rejected, the last one for its variant (REQ-15) | not an error: `SubtitleSearchLanguage { outcome: REJECTED, reasonKey: "error.subtitleSearch.wrong_variant" }` | `El subtítulo encontrado es de la otra variante del idioma.` |

What each consumer does with these:

- **`web`**: error handling for `setAudioVariantDetection` is unchanged. On any error it reverts
  the checkbox and shows the error's translated key. The enabling condition (REQ-2) and the copy
  change. `SubtitleSearchStatus` translates the new `reasonKey` like any other one. An unknown key
  already falls back the way that component does today.
- **`worker`**: if `EncodeJobDetails` lacks `subtitleVariantDetection`, or `SubtitleSyncDetails`
  lacks `variantDetectionIso3`, it reads them as `false`/`null` and logs. This is the same posture
  as `audioVariantDetection`. It reports `variantTag: null` for anything other than a decided
  verdict. The encode verdict never crosses the boundary: it lives in `111`'s worker-only store
  (REQ-9).

User-facing copy, catalog-driven (`web/messages/{en,es}.json`). The three existing preference keys
keep their names. Only their values change, and one key is new:

| Key | `es` | `en` |
| :-- | :-- | :-- |
| `preferences.form.audioVariantDetectionLabel` | `Detectar la variante del español (latino o España) en audio y subtítulos` | `Detect the Spanish variant (Latin American or Spain) in audio and subtitles` |
| `preferences.form.audioVariantDetectionHelp` | `Si un archivo trae dos pistas en español, de audio o de subtítulos, sin indicar cuál es latino y cuál es de España, se compara su contenido para distinguirlas. Los subtítulos que se bajan de internet se revisan igual, y se descartan los de la variante que no elegiste. En el audio, el procesamiento tarda unos minutos más.` | `When a file carries two Spanish tracks, audio or subtitles, that do not say which is Latin American and which is from Spain, their content is compared to tell them apart. Subtitles downloaded from the internet are checked the same way, and the ones in the variant you did not pick are discarded. For audio, processing takes a few minutes longer.` |
| `preferences.form.audioVariantDetectionDisabledHint` | `Disponible cuando elegís un idioma de audio o de subtítulos con variantes regionales, como el español.` | `Available when you pick an audio or subtitle language with regional variants, such as Spanish.` |
| `error.subtitleSearch.wrong_variant` (new) | `El subtítulo encontrado es de la otra variante del idioma.` | `The subtitle found is in the other variant of the language.` |

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `SubtitleSearch` | add `wantedVariants Json?`, the subtitle opt-in and wanted variants resolved when the search starts (REQ-3, REQ-13): `null` means the check is off, an object maps an `iso3` to its wanted variant tag and omits a language with none | nullable, no default | No: `null` (check off) is true of every existing search (NFR-5) |
| `SubtitleSearchAttempt` | add `variantTag String?`, the decided variant of the candidate (REQ-14), read when it is embedded (REQ-16) | nullable, no default | No: `null` means unchecked, which is true of every existing attempt (NFR-5) |

The preference reuses `User.audioVariantDetection` (`110`). The encode verdict lives in `111`'s
Redis store (REQ-9), keyed per input file, so a season pack's episodes stay apart (`095`).

## Acceptance Criteria

The encode corpus is `110`'s three films: It Chapter Two, Interstellar and Jurassic Park III.
`plan.md`'s first step confirms which of them carry two Spanish text subtitle tracks that `031`
cannot resolve and records their stream indices. A human then reads a few cues of each to fix the
expected variant before any threshold is tuned. The download corpus is the text of those same
tracks plus OpenSubtitles Spanish subtitles for those films, each labelled by a human, enough to
place REQ-14's two thresholds with no labelled file on the wrong side. The ACs below say "the corpus
film" for the first one that qualifies.

**Encode**

- [x] **AC-1**: Given the corpus film and a user who owns it with `es-419` in their subtitle
      languages and `audioVariantDetection` on, when it is encoded, then the output keeps only the
      subtitle track the human check identified as Latin American, titled `Latino`. The worker log
      shows both indices with their scores and the verdict, and a subtitle-variant key is listed
      under `perceptor:encode:` in Redis.
- [x] **AC-2**: Given the same film and a user whose subtitle language is plain `es`, with the
      preference on, when it is encoded, then both Spanish subtitle tracks are kept, titled `Latino`
      and `Español (España)` as the human check expects.
- [x] **AC-3**: Given a file whose two Spanish text subtitle tracks are titled `Latino` and
      `Castellano`, when it is encoded with the preference on, then detection does not run (the log
      shows no subtitle-variant scoring), no subtitle-variant verdict is stored, and the selection
      is the same as with the preference off.
- [x] **AC-4 (undecided)**: Given a file whose two untitled Spanish text subtitle tracks score
      within the margin, when it is encoded, then both are kept and both are titled `Español`, with
      no suffix.
- [x] **AC-5**: Given AC-1's film with the preference off for every owner, when it is encoded, then
      no subtitle-variant scoring is logged and the subtitle tracks match today's output (both kept,
      plain `Español`).
- [ ] **AC-6**: Given a user whose audio languages are only `en` and whose subtitle languages
      include `es-419`, `/preferences` shows the checkbox **enabled**. With it on and AC-1's film
      encoded, subtitle detection runs and audio detection (`110`) does not.
- [ ] **AC-7**: Given a user with no audio or subtitle language with regional variants,
      `/preferences` shows the checkbox disabled with the new hint, in both `es` and `en`.
- [ ] **AC-8**: Given AC-1's job, when the worker is killed with `docker compose kill worker` after
      the verdict is stored and the job is recovered (`054`), then the log shows the stored
      subtitle-variant verdict reused and no scoring runs again.
- [ ] **AC-9**: Given AC-1's film with compression off (`032`), when it is processed, then no
      subtitle-variant scoring runs in the encode and no verdict is stored.
- [x] **AC-4b (lone track)**: Given a file whose only Spanish subtitle is one untitled text track
      that the human check labels Spain, and a user with `es-419` subtitles and the preference on,
      when it is encoded, then the track is kept and titled `Español (España)`, and the log shows its
      rate and verdict. The same file with an untitled Latin track reads `Latino`.
- [x] **AC-4c (`id`)**: Given a subtitle text whose only Spain marker is `ID` in upper case (`Tu ID,
      por favor`), when it is scored, then `ID` counts as no marker.
- [x] **AC-4d (110 unchanged)**: With REQ-4b's markers added, re-running `110`'s scoring on its
      three films gives the same verdicts as `110` AC-1 to AC-3.
- [ ] **AC-10**: Given a file whose two unresolved Spanish subtitle tracks are both PGS, when it is
      encoded with the preference on, then detection does not run and both are kept as today.
- [x] **AC-11 (failure)**: Given AC-1's job with Redis stopped (`docker compose stop redis`), when
      the film is encoded, then detection runs, its verdict is applied to this encode, the log shows
      the store error, and the encode delivers.
- [ ] **AC-12 (failure)**: Given AC-1's film and a worker reading `EncodeJobDetails` from an `api`
      that does not expose `subtitleVariantDetection`, when it is encoded, then the worker logs the
      missing field, treats it as `false`, runs no subtitle detection, and the encode delivers.

**Subtitle search**

- [x] **AC-13**: Given a delivered film with no Spanish subtitle, an owner with `es-419` as their
      only Spanish subtitle language and the preference on, and an OpenSubtitles candidate the human
      labelled Spain ranked first, when "Buscar subtítulos" is pressed, then the first candidate's
      attempt ends rejected with `error.subtitleSearch.wrong_variant`. The search moves to the next
      candidate. If a Latin American candidate is accepted, it is embedded titled `Latino`.
- [ ] **AC-14**: Given the same film and an owner whose Spanish subtitle language is plain `es`, with
      the preference on, when the search runs, then no candidate is rejected for its variant, and the
      accepted one is embedded titled `Latino` or `Español (España)` according to its verdict, or
      `Español` when undecided.
- [ ] **AC-15**: Given AC-13's setup with the preference off, when the search runs, then no variant
      check is logged, the first candidate that passes the sync check is embedded titled `Español`,
      and no more candidates are downloaded than today.
- [ ] **AC-16 (failure)**: Given AC-13's setup and every candidate the provider returns labelled
      Spain by the human, when the search runs, then at most three candidates are downloaded, the
      Spanish outcome reads `REJECTED` with the wrong-variant message in `/movies/<id>`, and the
      library file is not touched.
- [ ] **AC-16b**: Given AC-13's setup and a film for which the provider's Latin American code
      returns exactly one usable candidate, when the search runs, then the log shows a query for the
      Latin American code followed by one for `es`, that candidate is tried first, and at most two
      `es` candidates follow it. No more than three are downloaded in total.
- [ ] **AC-16c**: Given an owner whose Spanish subtitle language is plain `es` (no wanted variant),
      when the search runs, then the log shows only the `es` query, as today.
- [ ] **AC-16d**: Given a film already holding an embedded Spanish sidecar the user supplied and
      embedded through `113`, then no variant check ran on it, and its title is whatever `101`/`113`
      gave it.
- [ ] **AC-17 (failure)**: Given AC-13's setup with a candidate whose staged file is truncated to
      zero bytes after download, when the check runs, then the worker logs the check failure, the
      candidate is not rejected for its variant, and it follows `103`'s existing path for an
      unreadable subtitle.
- [x] **AC-18**: Scoring stays within NFR-2's budget for AC-1's encode and for one downloaded
      candidate. `plan.md` records both times.

**Verification status, recorded plainly rather than papered over**: **Live pass limited to the
encode driver and one episode.** The encode ACs ticked above (AC-1 to AC-5, AC-4b, AC-11) were
observed on 2026-11-15 on files built from OpenSubtitles text (the three `110` films hold one Spanish
subtitle track each), through the real `encodeFfmpeg` driver, not through the queue and the `api`;
AC-4c and AC-4d are the unit specs passing, and AC-13 and AC-18 were observed on Reacher S02E05 (see
`plan.md` § Live encode pass and § Live search pass). Still unticked: AC-6 and AC-7 (the
`/preferences` UI was never opened signed in), AC-8 (reuse was seen across two processes, but the
worker container was not killed and recovered by `054`), AC-9, AC-10 and AC-12 (covered only by
`encode.job.spec.ts` and `subtitle-prune.spec.ts`), and AC-14 to AC-17, of which AC-16b was not met
as written (the provider's Latin American code returned no candidate for that episode, so the
one-candidate case did not occur). The Spain side of the thresholds rests on two translations of one
film, and `SUBTITLE_DECISION_MARGIN` is extrapolated from a scaled estimate of a 900 s sample.

## Out of Scope

- **Image subtitles (PGS, VobSub, DVB).** Telling them apart needs OCR, a new dependency and a
  cost this feature exists to avoid. They stay resolved by title only (REQ-5).
- **A separate subtitle preference.** Decided against: one checkbox covers every kind of track
  (REQ-1). Renaming the `audioVariantDetection` field, column or catalog keys to something neutral
  is a cross-service rename with no codegen, and not worth doing for a name. The description says
  what it covers.
- **Searching for a missing variant.** "Missing language" stays per `iso3` (`103`/`107`). If the
  file already holds a Spain Spanish subtitle and the owner wants `es-419`, Spanish is not missing
  and nothing is searched. Making the search variant-aware changes `103`'s missing-language rule and
  is its own spec.
- **Subtitles the user supplied themselves.** A sidecar the user placed beside the file and embeds
  through `101`/`113` is always taken as the right variant. It is only synced (`113`'s automatic
  offset), never checked for its variant, never rejected and never retitled for one. This feature
  checks only what Perceptor itself downloads from OpenSubtitles.
- **A duplicate verdict in the encode.** `102` C2 already drops a track that is the same
  translation (REQ-8).
- **Elimination from one titled track.** The encode never infers "one subtitle says Latino, so the
  untitled one is from Spain", for the same reason as `110`: the untitled one may be a third
  variant or a forced track. It is checked by its own text instead (REQ-6b).
- **Pairwise comparison of three or more tracks.** Three or more unresolved tracks are each decided
  on their own (REQ-6b), never compared pairwise. Choosing the odd one out needs rules nobody has
  calibrated.
- **Using a subtitle verdict to resolve an audio track, or the reverse.** A release's subtitles and
  dubs are often authored separately, so a Latin subtitle says nothing about which audio is Latin.
  Each kind is decided from its own content only.
- **Languages other than Spanish.** The marker table is per language (`110` REQ-11), and this spec
  adds no language.
- **Files and embeds already in the library** (NFR-5).
