---
title: Subtitle Translation and Adaptation — Implementation Plan
spec_version: 0.4.0
last_updated: 2026-10-29
status: Approved
---

# PLAN: Subtitle Translation and Adaptation (`plan.md`)

## Approach

Three concerns, each reusing a seam that already exists.

1. **Provider clients in `api`** (`services/api/src/clients/llm/`), beside the TMDB / indexer /
   torrent / OpenSubtitles clients. Five provider kinds collapse into **three wire protocols**: the
   OpenAI chat-completions protocol (`OPENAI`, `OPENROUTER` and `OPENAI_COMPATIBLE` differ only in
   base URL and headers), Gemini `generateContent`, and Ollama `/api/chat`. Plain `fetch`, no SDK
   (NFR-4). One `LlmClient.complete(provider, model, prompt, text)` returns text or throws a keyed
   `LlmError`; REQ-9's mapping from status codes to keys lives in one function per protocol so each
   is testable against recorded responses. Administration (providers, models, the "Probar" test)
   is a new `llm/` module in `api`; the key is a column on `LlmProvider`, stored in clear like every
   other secret in this database (`tracker_api_key`, `media_server_api_key`) and never selected into
   a GraphQL type.

2. **The translation lifecycle in `api`** (`services/api/src/subtitle-translation/`), modelled on
   `103`'s `subtitle-search/`: a row per request, a driver, an `api`-internal BullMQ queue for the
   long step, and a staging directory under the downloads root. The driver is a small state
   machine over `QUEUED → EXTRACTING → TRANSLATING → WRITING → COMPLETED | FAILED`. **The worker
   does only the two things `api` cannot**: extract the chosen track from the `.mkv` (it has
   FFmpeg) and write the finished sidecar beside the library file (`api` mounts the library
   read-only, Article XII). Every provider call, every batch, the SRT validation and the
   media-server notification stay in `api`.

3. **Sources and naming ride on `108`'s read.** The list of translatable tracks is not computed at
   request time; `library-probe` already opens the file, so it also reports each embedded subtitle
   track (REQ-17) and `api` stores them on the title. The modal therefore opens instantly, and
   works with no media server at all. The same worker change widens the sidecar name rule shared
   with `107`, so a translated `<base>.Latino.spa.srt` / `<base>.spa.2.srt` is read back as `spa`
   instead of an unresolvable tag.

**Alternatives rejected**
- *Provider calls in the worker.* Would need the key passed over GraphQL to a second service and a
  second place that knows REQ-9's mapping. `api` already owns external HTTP clients.
- *Listing sources with a live `ffprobe` on request.* `api` has no ffprobe and the worker queue
  would sit in the request path; `108`'s stored read costs nothing at request time.
- *Settings keys for providers* (`llm_gemini_key`, …). Providers and models are a variable-length
  list, each with its own secret; the Settings catalog is a flat key/value list.

**Reused, not rewritten**
- `LibraryLocationService` + `SubtitleEmbedService.assertUsableMkv` — library path resolution and
  the `.mkv`-inside-library guard, exactly as `SubtitleSearchRequestService.resolveLibraryPath` (`106`/`107`) uses them.
- `MediaServerService.createClient` + `client.modifiedMedia` + `MediaRootsService.containerToHostPath`
  — the notification, as `SubtitleEmbedService.notifyMediaServer` does it.
- `LibraryProbeQueueService.request` — the follow-up read after a write.
- `MediaRootsService.resolveFromRoot`/`isInsideRoot('downloads', …)` — staging, as `SubtitleSearchStaging`.
- `ProcessJobsService.reconcileOrphanedEncodes` (`054`) — the worker-boot signal that fails interrupted worker-side stages.
- Worker: `getMetadata`, `runFfmpegCapture`, `deliverReport`, `normalizeIso3`, `variantTitle`
  (`ffmpeg/variants.ts`, the `Latino`/`Español (España)` titles), `embeddedLanguages`, the
  `subtitle-embed` job's ownership/writability probe.
- Web: `EmbedSubtitlesButton`/`Modal`, `SearchSubtitlesButton`, `SchedulingPanel`, `translateErrorKey`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration and the whole contract; `worker` and `web` have nothing to call or render until the schema exists. Includes the `108` changes (`libraryProbeCompleted.subtitleSources`, backfill predicate) because `worker`'s probe change is useless until `api` accepts the argument. |
| 2a | `worker` | Can start once step 1's schema is generated (`schema.gql`): the two translation jobs, the sidecar name rule, the per-track report. |
| 2b | `web` | Can start at the same moment as 2a: Settings tab, modal, button, poll. No dependency on the worker until the manual pass. |
| 3 | `orch` | Constitution Check-line patch (NFR-1), `docs/spec/graphql-contract.md` delta, `history.md`. No code. |
| 4 | verify | Full manual pass needs all three running. |

**Parallelism.** 2a and 2b are independent of each other and run in parallel after step 1. Step 1
itself is internally serial at its start (schema + migration first) but its `clients/llm/` and
`llm/` admin work does not depend on the translation lifecycle, so an implementer may build them in
either order.

**Rollout ordering at runtime** (no flag): `api` first, then `worker`. A new `api` with an old
`worker` is safe — `subtitleSources` is optional (the stored sources stay null, the modal says "not
read yet") and no translation job is consumed. A new `worker` with an old `api` fails on the unknown
argument; the three services ship under one `PERCEPTOR_TAG` anyway.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an implementer
will want to change and must not:

- **`SubtitleTranslationDetails` carries `targetTag` *and* `targetIso3`.** Looks redundant; it is
  not. The worker derives the `<title>` segment (`Latino`) from the tag with its own
  `variantTitle`, and the language segment from the ISO code `api` already resolved. The worker
  must not map tags to ISO codes itself.
- **`libraryProbeCompleted.subtitleSources` is optional.** An absent argument leaves the stored
  sources untouched. Do not make it required "since the worker always sends it".
- **`SubtitleTranslationSource.languageIso3` is nullable and `id` opaque.** A source with no
  language is listed but not requestable. `id` is built by `api`; `web` sends it back unchanged and
  never parses it.
- **`movieTranslationSources` / `episodeTranslationSources` return `null`, not `[]`, for a file that
  was never read.** `web` renders the "not read yet" line on `null` and "no translatable
  subtitles" on `[]`.
- **`subtitleTranslation(id)` exists only for REQ-16's poll.** It is not a general listing; do not
  grow it.
- **No cancel mutation, no resume, no per-batch partial results** (Out of Scope).
- **`apiKey` exists only on `LlmProviderInput`.** No output type, log line or error message may carry it.
- **Error keys that are outcomes are never thrown**, thrown keys are never stored. `web` must treat
  them accordingly (spec table).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`, `worker`
and `web` (Constitution, Article VIII).

## Migrations

Owned by `api`. One migration, `add_llm_providers_and_subtitle_translation`, via
`bin/npm api run prisma:migrate`:

1. Create `LlmProviderKind`, `SubtitleTranslationMode`, `SubtitleTranslationStatus` enums, tables
   `llm_providers`, `llm_models` (unique `providerId`+`model`, cascade on provider), and
   `subtitle_translations` (movie/episode cascade, `requestedById` and `modelId` `SetNull`, index
   on `status` for the dispatcher).
2. Add nullable `fileSubtitleSources Json?` to `movies` and `episodes`.
3. No data backfill statement. `108`'s boot pass, whose predicate this feature widens to
   `fileSubtitleSources IS NULL AND <has a file>`, fills the column for every existing title on the
   first boot after the migration. Verified in the manual pass: right after the first boot,
   `select count(*) from movies where file_path is not null and file_subtitle_sources is null`
   drains to the number of unreadable files.

Reversibility: dropping the three tables and two columns is lossless for everything except the
providers/keys an administrator typed. Nothing existing reads the new columns.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A model "helpfully" merges, splits or renumbers cues | A subtitle with the wrong cue count is written and drifts out of sync with the picture; no error anywhere | REQ-8's batch check (same count, same numbers) before a batch is accepted; the output uses the **source's** timings and numbers and only the model's text; unit tests with count-mismatch, renumbered, merged and extra-cue fixtures. |
| The model answers with prose, fenced code blocks or a preface around the SRT | Parse fails, or worse parses a cue out of the preface | The parser is strict about the block structure and the check compares numbers; fenced blocks and a leading/trailing prose line are stripped in one place and tested; anything else is `invalid_response`, never "best effort". |
| A truncated answer (token limit) looks like a complete one | Last cues missing; caught only by the count check | Provider `finish_reason`/`finishReason` of length/`MAX_TOKENS` maps to `provider_refused` *before* parsing (REQ-9), and the count check is the backstop. Batch size is sized under the smallest output limit the plan measures. |
| The API key leaks | Key in `docker compose logs`, an error message, a stored error key or a GraphQL type | The key is never an output field; `LlmError` carries a key and a short detail built from the status code only, never from the request or response body; unit test asserts a provider error body containing the key text never reaches the stored `errorKey`/logs; AC-2 greps the logs. |
| A stale worker report moves a row it no longer owns | A late `subtitleTranslationWritten` from a retried BullMQ job completes a row that was already failed `interrupted`, or writes a second file | Every worker mutation is a guarded `updateMany` on the expected status and returns `false` otherwise; the worker abandons silently on `false`. BullMQ jobs use `attempts: 1`. Tested. |
| A sidecar name the media servers read differently from `108` | The translated file is invisible to `108`/`107`, so `107` keeps searching OpenSubtitles for the language the user just produced | The shared name rule is widened in one worker function (`sidecars.ts`) used by both probes; spec lists the exact names as test cases; AC-6/7 check Jellyfin **and** Plex list the file as Spanish. If a media server reads a regional title segment differently from REQ-13, the plan's first worker task is to verify against a real server before the naming code is written. |
| Writing over an existing file | A user's own `<base>.spa.srt` is clobbered | The write is `link(part, final)` retried with `.N`, which fails with `EEXIST` rather than overwriting; tested against a real temp directory. |
| Library file replaced between request and extraction | A different file's track at that ordinal is translated | The worker re-validates ordinal + language + that it is a text, non-forced subtitle stream before extracting (REQ-11) and `api` compares the stored `libraryPath` at write time; AC-14. |
| Two translations run at once | Two long jobs hammer one local Ollama box; a worker reconcile fails the wrong row | One-at-a-time is a database invariant (the dispatcher refuses to start a QUEUED row while another is active), not a queue-concurrency accident; tested. |
| An embed or replacement runs while a translation writes | The `.mkv` is swapped under the extraction | Extraction and write both re-check the file; `file_gone`/`source_mismatch` are the outcomes. Translations do not take `101`'s busy guard (a sidecar write conflicts with nothing it protects). |
| The follow-up read never runs, so the new sidecar's language never appears | `108`'s box stays stale; `107` keeps searching | The notify step and the `library-probe` request are separate, each non-fatal; the probe's own boot pass re-reads on the next restart. |
| Spec 108's backfill predicate widened too far | Every boot re-queues a read for every unreadable file forever | The predicate stays `has a file AND sources IS NULL`; a read that fails leaves it null by design (same posture as `108` NFR-3); documented, bounded by the number of unreadable files. |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/npm worker run test
bin/cli worker npx --no tsc --noEmit
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments api && bin/comments worker && bin/comments web
bin/audit api
```

Then the manual pass, mapped to the acceptance criteria (needs one local model — Ollama on the LAN —
and ideally one hosted key):

1. Settings → Traducción (AC-1/2/3/4): create an `OLLAMA` and a `GEMINI` provider, add a model to
   each, press "Probar", break the key, break the model name, disable everything and see the
   button vanish. Grep `docker compose logs api` for the key.
2. Film with an embedded English SRT track and a PGS track (AC-5/6): button present, only the SRT
   offered, "Traducir"; leave the page and come back; `<base>.spa.srt` appears, Jellyfin lists
   Spanish, the subtitle box shows `SPA`.
3. Episode with an embedded Castilian track → `es-419` (AC-7): `<base>.Latino.spa.srt`, "Adaptar",
   Plex and Jellyfin both list it as Spanish.
4. Failure paths (AC-8 … AC-12, AC-14): second request while one runs; a stub provider answering
   with fewer cues; a pre-existing `<base>.spa.srt`; restart `api` during `TRANSLATING`, restart
   `worker` during `EXTRACTING`; stop the media server before the notification; swap the `.mkv`
   between request and extraction.
5. `select count(*) …` from Migrations step 3 after the first boot.

If an acceptance criterion in `spec.md` cannot be reached from this list, this section is the
incomplete one.
