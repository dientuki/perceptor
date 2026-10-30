---
title: Audio Variant Detection
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-10-29
last_updated: 2026-10-29
status: Approved
services: [api, web, worker]
---

# SPEC: Audio Variant Detection (`spec.md`)

## Context & Goal

Spec `031` taught the worker to tell a Spain Spanish track (`es-ES`) from a Latin American one
(`es-419`), but only from the track's own title: `worker/src/ffmpeg/variants.ts`'s `detectVariant`
looks for markers such as `latino`, `castellano` or `españa` in `tags.title`. A release whose two
Spanish tracks are both tagged `spa` and titled the same ("Español Surround 5.1") resolves to no
variant at all. Today that leaves the user who asked for `es-419` (or `es-ES`) with both Spanish
tracks kept and titled the same plain `Español` (`031` REQ-5's "no match, keep everything"). They
cannot tell which one is which until they play the file. A sweep of the current library found three
films in exactly this state: It Chapter Two, Interstellar and Jurassic Park III.

The two dubs can be told apart from the audio itself. Both translate the same script, so the same
time window of each track carries the same scene in the two dialects: "¿Lo hemos conseguido?"
against "¿Lo logramos?", "Vale, nos vamos" against "Entonces iremos", "Voy a por Richie" against
"Voy por Richie". A hand-run prototype on It Chapter Two settled the method. It took five two-minute
windows at the same proportional positions of each track, transcribed the dialogue channel with
Whisper and counted dialect markers after dropping Whisper's repeated hallucinated lines. That
separated the two tracks with a margin of 49 points on a scale where the Latin track scored −2. The
same prototype also showed the cost: openai-whisper on CPU took about 2.5 hours for 2 × 10 minutes
of audio. The engine must therefore be a CPU-efficient one, and the sampling smaller.

This feature adds that comparison as an opt-in pre-encode step in the worker's encode driver, beside
`094`'s grain detector, `098`'s dub trim and `102`'s subtitle content rules. Each user opts in from
`/preferences`. When an owner of the title has opted in and the file carries two Spanish audio
tracks that the metadata cannot resolve, the worker runs the comparison. The verdict is kept in
`111`'s persistent encode-verdict store, beside the grain, dub-trim, stream-end and subtitle
verdicts, so a stopped, crashed or retried encode reads it back instead of transcribing again. The
verdict then feeds `031`'s existing
selection and titling unchanged: the requested variant is kept and each surviving track is titled
`Latino` or `Español (España)`. This changes the Transcode stage of the root `CLAUDE.md` pipeline
table, plus the `/preferences` screen.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (User preference)**: Each user has an `audioVariantDetection` preference, default off,
      changed only by its own mutation and never inferred. No per-title override exists.
- [ ] **REQ-2 (Preference control)**: `/preferences` always shows the `audioVariantDetection`
      checkbox. It is **enabled** only while the user's audio language preferences include at least
      one language that has regional variants (REQ-3). Otherwise it is shown disabled, with a hint
      saying why. Removing the last such language does not clear the stored value. The value just
      becomes inert (REQ-4) and the checkbox reads disabled with its stored state.
- [ ] **REQ-3 (Languages with variants)**: A language "has regional variants" when the `Language`
      table holds two or more rows with a region subtag (`es-419`, `es-ES`) sharing its `iso3`. The
      rule is data-driven, never a hardcoded Spanish check. Today this makes `es`, `es-419` and
      `es-ES` qualify. A future `pt-BR`/`pt-PT` seed qualifies Portuguese with no code change in
      `web` or `api`.
- [ ] **REQ-4 (Effective opt-in per job)**: For an encode job, `api` resolves one effective
      `audioVariantDetection` boolean. It is true when at least one owner of the job's title has the
      preference on **and** that owner's audio languages for the title include a language with
      regional variants. The owner's audio languages are their global audio preference merged with
      their per-title ones, the same merge that feeds `allowedAudioLanguageTags`. Otherwise it is
      false.
- [ ] **REQ-5 (When detection runs)**: The worker runs detection on a job only when all of these
      hold:
      - compression is on (`032`);
      - the effective opt-in is true (REQ-4);
      - the job's allowed audio languages include the language;
      - the worker has a detector for that language (REQ-11);
      - the input carries exactly two audio streams of that language whose variant the metadata does
        not resolve (`031`'s `detectVariant` returns nothing for both);
      - no verdict is stored for those two streams (REQ-8).
      Streams the metadata already resolves are never re-detected and never part of the comparison.
      Any other count of unresolved streams (one, three or more) skips detection, and those streams
      stay unresolved.
- [ ] **REQ-6 (Comparative decision)**: Detection compares the two candidate streams against each
      other, never against an absolute threshold. It samples the same time windows of each, at
      proportional positions of the input's duration, from the dialogue channel (the centre channel
      when the layout has one, else a mono downmix). It transcribes them forced to the language,
      drops repeated identical lines before counting, and scores each stream on weighted dialect
      markers:
      - **Spain, strong:** `vosotros`/`os`, `-áis`/`-éis` verb forms, `a por`, `vale`, `joder`.
      - **Spain, weak:** regional vocabulary, and the present perfect (`he/hemos/ha` + participle).
      - **Latin American, against:** `ustedes`, `carajo`, `ahorita`, `carro`/`computadora`/`celular`/
        `manejar`, `qué pasó`.
      The stream that wins by at least the decision margin is `es-ES` and the other is `es-419`. A
      margin below the threshold makes both **undecided**. The exact marker lists, weights, window
      count and margin are tuned in `plan.md` against the three-film corpus (AC-1 to AC-3), never
      guessed. Before scoring, REQ-6b runs on the same transcripts.
- [ ] **REQ-6b (Same dub twice)**: When the two transcripts are the same dub (their deduplicated
      word sequences are at least as similar as the duplicate threshold), the verdict is
      **duplicate** instead of a variant. The worker then keeps **one** of the two streams and drops
      the other: the one with more channels, and on a tie the lower stream index. The kept stream is
      unresolved and titled with the language's plain track title (`Español`). A source that carries
      the same dub twice is a release error, and keeping both only repeats it. The threshold is
      tuned in `plan.md` on the corpus, never guessed: the prototype measured 0.89 on Jurassic Park
      III's identical tracks against 0.40 and 0.45 on the two films with different dubs.
- [ ] **REQ-7 (Verdict feeds 031)**: A decided stream is treated exactly as if its title carried the
      matching `031` marker. It takes part in `031`'s requested-variant narrowing (REQ-4/REQ-5 there)
      and is titled with `031`'s variant title (`Latino`, `Español (España)`). An undecided stream
      behaves exactly as today: unresolved, kept by `031` REQ-5, titled with the language's plain
      track title. The output file's own `language` tag stays `spa` either way. Two undecided streams
      therefore both read `Español` in the output, and that repetition is deliberate. It is the
      visible signal that the variant could not be told apart. No suffix, number or other
      disambiguating title is ever added to them. A **duplicate** verdict (REQ-6b) is the one case
      where an unresolved stream is dropped.
- [ ] **REQ-8 (Persistent verdict, through `111`)**: Every verdict the worker reaches, decided,
      duplicate or undecided, is stored in `111`'s encode-verdict store as one more verdict kind, under `111`'s
      rules (Redis, `perceptor:encode:` namespace, 30-day TTL, a Redis failure counts as "no
      verdict"). Its identity (`111` REQ-3) is the input file (path, size, modification time), the
      detector's `iso3` and the two candidate stream indices. The opt-in and the allowed audio
      languages only gate whether detection runs, so they are not part of the identity. When a
      stored verdict matches, the worker uses it and never re-runs detection. That covers a worker
      restart (`054`), a stopped and resumed encode (`097`), a retried job (`065`, `095`) and a
      BullMQ retry. Like `094`'s cached grain `false`, an undecided verdict is stored as well. This
      feature adds no cache of its own, in `api` or in memory (`111` NFR-6).
- [ ] **REQ-9 (Failure is silent)**: If detection fails (the engine errors, a window cannot be
      extracted, or the output is empty or unparseable), the encode proceeds with both streams
      unresolved, exactly as if the feature were off. The failure is logged, and **nothing** is
      stored, so a later run of the same job tries again. If storing a verdict fails, the worker
      still uses it for the current encode and logs the failure (`111` NFR-3). It never fails the
      encode.
- [ ] **REQ-10 (Cancellation)**: Detection honours the encode's `AbortSignal`. A delete (`047`), a
      stop (`097`) or a discard (`095`) while detection runs terminates the engine at once. The job
      then follows its existing cancelled/stopped/discarded path: no verdict is stored and only
      `EncodeCancelledError` propagates, the same posture as `102`.
- [ ] **REQ-11 (Language-extensible detectors)**: Each detector is registered per language, keyed by
      the language's `iso3` and the pair of variant tags it decides between. Spanish (`spa`,
      `es-ES` vs `es-419`) is the only one this spec registers. Adding a language means adding its
      variants to `031`'s variant table and the `Language` seed and registering a detector, with no
      change to the REQ-5 gating, the REQ-8 store, the contract or the `web` control.
- [ ] **REQ-12 (Progress)**: While detection runs, the job reads `ENCODING` with progress 0, the
      same as `100`'s disc remux, and the worker logs the start and end of detection with the
      verdict. Encode progress starts counting only once FFmpeg starts.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (CPU only, offline)**: Detection runs on CPU on every host (spec `024`: one code path,
      nothing detected at install time). It makes no network call. The engine and its model are
      baked into the worker image at build time, as `103` pins `ffsubsync` in the `base` stage, and
      are never downloaded at runtime.
- [ ] **NFR-2 (Time budget)**: On the reference host (16 cores), detection for one file, with both
      streams and window extraction included, takes at most about **10 minutes** of wall time.
      `plan.md` picks the engine (a CPU-efficient Whisper implementation, int8; openai-whisper is
      ruled out by the measurement in Context & Goal), the model size and the window count to fit
      this budget, and records the measured time.
- [ ] **NFR-3 (Image size)**: `plan.md` records the worker image size before and after. The model is
      the smallest that still decides AC-1 and AC-2, and AC-3 as duplicate, with the margin REQ-6 sets.
- [ ] **NFR-4 (No backfill)**: The new `User` column defaults to `false`. Files already in the library are never re-examined. The feature acts only on
      encodes that run after it ships.
- [ ] **NFR-5 (Err on keeping)**: Every ambiguity resolves to "undecided", meaning keep both streams
      unresolved, never to a guess. This covers a tie, a low margin, one empty transcript, an unknown
      layout or a third unresolved stream.
- [ ] **NFR-6 (Depends on `111`)**: `111` is implemented first. This feature registers its verdict
      kind in `111`'s store and writes no Redis key of its own outside it.

## GraphQL Contract Delta

```graphql
type Language {
  id: ID!
  tag: String!
  iso2: String!
  iso3: String!
  name: String!
  """Two or more region-subtagged Language rows share this iso3 (110 REQ-3)."""
  hasRegionalVariants: Boolean!
}

type UserPreferences {
  # …existing fields unchanged…
  """Gate for audio variant detection (110 REQ-1). False for every user until they say otherwise."""
  audioVariantDetection: Boolean!
}

type EncodeJobDetails {
  # …existing fields unchanged…
  """Effective opt-in for this job (110 REQ-4)."""
  audioVariantDetection: Boolean!
}

type Mutation {
  setAudioVariantDetection(enabled: Boolean!): UserPreferences!
}
```

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setAudioVariantDetection` without a session | `UnauthorizedException` (existing guard) | `error.auth.unauthenticated` (existing) |
| `setAudioVariantDetection(true)` while the user has no language with variants | none: accepted and stored, inert per REQ-2/REQ-4 | none |

What each consumer does with these:

- **`web`**: on any error from `setAudioVariantDetection`, it reverts the checkbox and shows the
  error's translated key, the same as the existing `setSubtitleSearch` control.
- **`worker`**: if `EncodeJobDetails` lacks `audioVariantDetection` (a mixed-version deployment), it
  reads it as `false` and logs, the same posture as `contentKind` and `compressionResolution`. The
  verdict never crosses the boundary: it lives in `111`'s worker-only store (REQ-8).

User-facing copy, catalog-driven (`web/messages/{en,es}.json`):

| Key | `es` | `en` |
| :-- | :-- | :-- |
| `preferences.form.audioVariantDetectionLabel` | `Detectar la variante del doblaje por el audio` | `Detect the dub variant from the audio` |
| `preferences.form.audioVariantDetectionHelp` | `Si un archivo trae dos pistas en español sin indicar cuál es latino y cuál es de España, se escucha un fragmento de cada una para distinguirlas. Hace que el procesamiento tarde unos minutos más.` | `When a file carries two Spanish tracks that do not say which is Latin American and which is from Spain, a sample of each is listened to in order to tell them apart. Processing takes a few minutes longer.` |
| `preferences.form.audioVariantDetectionDisabledHint` | `Disponible cuando elegís un idioma de audio con variantes regionales, como el español.` | `Available when you pick an audio language with regional variants, such as Spanish.` |

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | add `audioVariantDetection Boolean` | non-null, `@default(false)` | No: the default is the intended value for every existing user (NFR-4) |

The verdict is not in the database: it lives in `111`'s Redis store (REQ-8). Keying it by the input
file (path, size, modification time) keeps a season pack's episodes apart, since each is its own
file (`095`).

## Acceptance Criteria

- [ ] **AC-1**: Given It Chapter Two (2019) with its two Spanish tracks both titled
      "Español Surround 5.1", the user who owns it with `es-419` in their audio languages and
      `audioVariantDetection` on, when the film is encoded, then the output keeps only the track
      that was input stream `0:3`, titled `Latino`. The worker log reads `0:2` → `es-ES` and
      `0:3` → `es-419`, and the verdict's key is listed under `perceptor:encode:` in Redis.
- [ ] **AC-2**: Given Interstellar (2014) in the same state and the same preferences, when it is
      encoded, then the log reads `0:2` → `es-ES` and `0:3` → `es-419`, the verdict is stored, and a
      human listening to a minute of each output track confirms they match the variants.
- [ ] **AC-3 (same dub twice)**: Given Jurassic Park III (2001), whose two Spanish tracks carry the
      same dub (the prototype transcribed the same lines from both), when it is encoded with the same
      preferences, then the verdict is duplicate and stored, and the output keeps one Spanish track,
      input stream `0:2` (both are 5.1, so the lower index wins), titled `Español`.
- [ ] **AC-4**: Given a file whose two Spanish tracks are titled "Latino" and "Castellano", when it
      is encoded with the feature on, then detection does **not** run (no unresolved stream, REQ-5),
      no audio-variant verdict is stored, and the track selection is the same as with the
      feature off.
- [ ] **AC-4b (undecided)**: Given a file whose two Spanish tracks are untitled and detection is
      undecided, when it is encoded, then both tracks are kept and both are titled `Español`, with
      no suffix or numbering added.
- [ ] **AC-5**: Given AC-1's job, when the worker container is killed with `docker compose kill
      worker` after the verdict is stored but before FFmpeg finishes, and the job is recovered
      (`054`), then the worker log shows the stored verdict reused and no transcription runs a
      second time. The same holds for a Stop and Play (`097`).
- [ ] **AC-6 (failure path)**: Given AC-1's file with the detection engine made to fail (for
      example its model file removed from a throwaway container), when the film is encoded, then
      the encode completes with both Spanish tracks kept and titled plain `Español`, the worker logs
      the detection failure, and no audio-variant verdict is stored.
- [ ] **AC-7 (cancellation)**: Given AC-1's job while detection is running, when the user deletes
      the source from `/downloads`, then the detection process is gone from the worker container
      within a few seconds and no audio-variant verdict is stored.
- [ ] **AC-8**: Given a user whose audio languages are only `en`, `/preferences` shows the checkbox
      disabled with the disabled hint. When `es-419` is added, it becomes enabled. When it is
      checked, saved and the page reloaded, it reads checked.
- [ ] **AC-9**: Given AC-1's file with `audioVariantDetection` off for every owner, when it is
      encoded, then no transcription runs and the output matches today's behaviour (both tracks
      kept, plain `Español`).
- [ ] **AC-10**: Given AC-1's file with compression off (`032`), when it is processed, then no
      transcription runs and no verdict is stored.
- [ ] **AC-11**: The detection on It Chapter Two finishes within NFR-2's budget on the reference
      host, and `plan.md` records the measured time.
- [ ] **AC-12 (failure)**: Given AC-1's job with Redis stopped (`docker compose stop redis`), when
      the film is encoded, then detection runs, the verdict is applied to this encode, the log shows
      the store error, and the encode delivers (`111` NFR-3).

## Out of Scope

- **Portuguese (and every language other than Spanish).** REQ-3 and REQ-11 keep the control, the
  gating, the store and the contract language-generic, but this spec registers only the Spanish
  detector and seeds no new language. Portuguese needs `pt-BR`/`pt-PT` in the seed and `031`'s
  variant table plus its own marker lists, validated on real files the way AC-1 to AC-3 validate
  Spanish.
- **Files already in the library.** Re-examining delivered files would mean re-encoding or remuxing
  them. This spec acts only on encodes from now on (NFR-4).
- **Three or more unresolved tracks of one language.** For example España + Latino + an untitled
  audio description. Deciding these needs pairwise comparison and some way to tell a non-dub track
  apart. They stay unresolved (REQ-5, NFR-5).
- **Elimination from one titled track.** "One track says Latino, so the other must be Spain" is
  not inferred. The untitled one may be a third variant or an audio description. Only two-way
  audio evidence decides (REQ-5).
- **Subtitles.** Subtitle variants are resolved from text and titles by `031`/`102`. Transcription
  applies to audio only.
- **A per-title switch or a visible verdict in the UI.** The preference is per user only (REQ-1).
  The verdict shows up as the output track's title, never as its own field or badge.
- **A GPU path.** Ruled out by spec `024` (NFR-1).
- **Reusing one episode's verdict for the rest of a season pack.** Every file is detected on its
  own, and a season pack pays detection once per episode. Reuse would assume every file in the pack
  shares one track layout, which a mixed pack breaks, so the cost is accepted in exchange for never
  carrying a wrong verdict across files.
